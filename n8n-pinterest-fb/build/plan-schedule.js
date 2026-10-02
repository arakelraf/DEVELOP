/**
 * Slot planning for the posting queue. Pure functions, no n8n, no clock of
 * their own - the caller passes `nowMs`, so every case is reproducible.
 *
 * Source-agnostic on purpose: it only sees etsy_listing_id, board_slugs and
 * text. Swapping Pinterest for the Etsy API changes nothing here.
 */

// ------------------------------------------------------------- timezone math
//
// Slots are wall-clock times in the user's timezone ("10:00 in Belgrade"),
// which is NOT a fixed UTC offset - it shifts with DST. Luxon exists inside
// n8n Code nodes but not in a plain `node` test run, so this uses Intl, which
// is available in both.

/** How far the named zone is from UTC at this instant, in ms. */
function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second)
  );
  return asIfUtc - date.getTime();
}

/**
 * The UTC instant of a wall-clock time in a zone.
 * Iterates because the offset itself depends on the instant being resolved
 * (the classic DST fixed-point problem).
 */
function zonedTimeToUtc(y, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(y, month - 1, day, hour, minute, 0);
  let ts = wall;
  for (let i = 0; i < 4; i++) {
    const next = wall - tzOffsetMs(new Date(ts), timeZone);
    if (next === ts) break;
    ts = next;
  }
  return ts;
}

/** Calendar Y/M/D as seen in the zone at this instant. */
function zonedYmd(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = dtf.format(date).split('-').map(Number);
  return { y, m, d };
}

/**
 * Every slot instant from now to the horizon, ascending, skipping any that
 * are too close to act on.
 */
function buildSlotInstants({ slots, timezone, nowMs, horizonDays, leadMinutes }) {
  const earliest = nowMs + leadMinutes * 60_000;
  const parsed = slots
    .map((s) => {
      const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour > 23 || minute > 59) return null;
      return { hour, minute };
    })
    .filter(Boolean)
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);

  if (!parsed.length) return [];

  const out = [];
  const start = zonedYmd(new Date(nowMs), timezone);
  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
    // Walk days in the zone's own calendar via a UTC-noon anchor, which never
    // lands on a DST discontinuity.
    const anchor = Date.UTC(start.y, start.m - 1, start.d + dayOffset, 12, 0, 0);
    const { y, m, d } = zonedYmd(new Date(anchor), timezone);
    for (const s of parsed) {
      const ts = zonedTimeToUtc(y, m, d, s.hour, s.minute, timezone);
      if (ts >= earliest) out.push(ts);
    }
  }
  return out.sort((a, b) => a - b);
}

// ------------------------------------------------------------------ planning

const DAY_MS = 86_400_000;

/**
 * Statuses meaning "this row is not published yet, leave it alone".
 * `scheduled` is set once Facebook has accepted the post with a
 * scheduled_publish_time - the row is handed off but not live, so it must
 * still block a second attempt at the same listing.
 */
const PENDING_STATUSES = new Set(['queued', 'posting', 'scheduled']);

/** Parse a JSON-encoded list column, tolerating a bare string or null. */
function parseList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.map(String);
      if (typeof p === 'string') return [p];
    } catch { return [v]; }
  }
  return [];
}

/**
 * Decide what to add to the queue.
 *
 * Rules enforced here:
 *  - a listing already queued is never queued twice (reported, not added)
 *  - a listing posted less than repostAfterDays ago is skipped
 *  - a listing whose every board is disabled is skipped
 *  - slots already taken by queued rows are left alone
 *  - boards rotate by priority so the same board never lands back to back
 */
function planSchedule({
  items = [],
  scheduleRows = [],
  enabledBoards = [],
  priorityByBoard = {},
  slots = [],
  timezone = 'UTC',
  nowMs = Date.now(),
  horizonDays = 14,
  maxQueue = 60,
  repostAfterDays = 60,
  leadMinutes = 20,
}) {
  const enabled = new Set(enabledBoards.map(String));

  // --- index the existing queue -------------------------------------------
  //
  // schedule.etsy_listing_id is UNIQUE by design: a listing has at most ONE
  // row, ever. So any existing row blocks a fresh insert, and a repost after
  // the cooldown must UPDATE that row rather than add a second one.
  const rowByListing = new Map();
  const takenSlots = new Set();

  for (const r of scheduleRows) {
    const id = String(r.etsy_listing_id || '');
    if (!id) continue;
    // Keep the newest row if the table somehow holds more than one.
    const prev = rowByListing.get(id);
    if (!prev || String(r.id ?? '') > String(prev.id ?? '')) rowByListing.set(id, r);

    // Anything not yet published still owns its slot.
    if (PENDING_STATUSES.has(String(r.status || ''))) {
      const t = Date.parse(r.scheduled_at);
      if (Number.isFinite(t)) takenSlots.add(t);
    }
  }

  // --- classify candidates -------------------------------------------------
  const already = [];
  const skipped = [];
  const eligible = [];

  for (const it of items) {
    const id = String(it.etsy_listing_id || '');
    if (!id) continue;

    const boards = parseList(it.board_slugs);
    const activeBoards = boards.filter((b) => enabled.has(b));

    if (!activeBoards.length) {
      skipped.push({ etsy_listing_id: id, title: it.title || '',
        reason: 'all_boards_disabled', boards });
      continue;
    }
    const row = rowByListing.get(id);
    let requeueRowId = null;

    if (row) {
      const status = String(row.status || '');

      if (PENDING_STATUSES.has(status)) {
        already.push({ etsy_listing_id: id, title: it.title || '',
          status, scheduled_at: row.scheduled_at });
        continue;
      }

      if (status === 'posted') {
        const t = Date.parse(row.posted_at || row.scheduled_at);
        const postedAt = Number.isFinite(t) ? t : 0;
        if (repostAfterDays <= 0) {
          skipped.push({ etsy_listing_id: id, title: it.title || '',
            reason: 'already_posted_reposting_disabled',
            posted_at: postedAt ? new Date(postedAt).toISOString() : null });
          continue;
        }
        const ageDays = (nowMs - postedAt) / DAY_MS;
        if (ageDays < repostAfterDays) {
          skipped.push({ etsy_listing_id: id, title: it.title || '',
            reason: 'posted_recently',
            posted_at: postedAt ? new Date(postedAt).toISOString() : null,
            days_until_eligible: Math.ceil(repostAfterDays - ageDays) });
          continue;
        }
        // Cooldown served: reuse the row so the UNIQUE key still holds.
        requeueRowId = row.id ?? null;
      } else {
        // failed / skipped rows are deliberately left for a human. Re-queueing
        // a failure automatically would just fail again every run; Workflow D
        // offers reschedule, which resets the row to queued.
        skipped.push({ etsy_listing_id: id, title: it.title || '',
          reason: status === 'failed' ? 'previous_attempt_failed'
            : status === 'skipped' ? 'row_skipped_awaiting_action'
            : `unknown_status_${status || 'empty'}`,
          error: row.error || '', row_id: row.id ?? null });
        continue;
      }
    }

    // The board a listing is credited to: highest priority among its enabled
    // boards, so rotation is deterministic.
    const board_slug = activeBoards
      .slice()
      .sort((a, b) => (priorityByBoard[b] || 0) - (priorityByBoard[a] || 0)
        || a.localeCompare(b))[0];

    eligible.push({ ...it, etsy_listing_id: id, board_slug, requeueRowId });
  }

  // --- rotate boards ------------------------------------------------------
  const groups = new Map();
  for (const e of eligible) {
    if (!groups.has(e.board_slug)) groups.set(e.board_slug, []);
    groups.get(e.board_slug).push(e);
  }
  // Oldest listings first within a board, so a backlog drains fairly.
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.first_seen_at || '').localeCompare(String(b.first_seen_at || ''))
      || String(a.etsy_listing_id).localeCompare(String(b.etsy_listing_id)));
  }

  const boardOrder = [...groups.keys()].sort((a, b) =>
    (priorityByBoard[b] || 0) - (priorityByBoard[a] || 0) || a.localeCompare(b));

  const rotated = [];
  let guard = 0;
  while (rotated.length < eligible.length && guard++ < eligible.length * boardOrder.length + 10) {
    let placedThisPass = false;
    for (const b of boardOrder) {
      const list = groups.get(b);
      if (!list || !list.length) continue;
      // Never two in a row from the same board while another board still has
      // items waiting.
      const last = rotated[rotated.length - 1];
      if (last && last.board_slug === b && boardOrder.some(
        (o) => o !== b && groups.get(o) && groups.get(o).length)) continue;
      rotated.push(list.shift());
      placedThisPass = true;
    }
    if (!placedThisPass) break;
  }
  // Anything the rotation could not place (single board left) goes on the end.
  for (const b of boardOrder) for (const rest of groups.get(b) || []) rotated.push(rest);

  // --- assign slots -------------------------------------------------------
  const slotInstants = buildSlotInstants({ slots, timezone, nowMs, horizonDays, leadMinutes })
    .filter((t) => !takenSlots.has(t));

  const toInsert = [];
  const unplaced = [];
  const nowIso = new Date(nowMs).toISOString();

  for (let i = 0; i < rotated.length; i++) {
    if (toInsert.length >= maxQueue) { unplaced.push({ ...rotated[i], reason: 'max_queue_per_run' }); continue; }
    const slot = slotInstants[toInsert.length];
    if (slot === undefined) { unplaced.push({ ...rotated[i], reason: 'no_free_slot_in_horizon' }); continue; }
    toInsert.push({
      etsy_listing_id: rotated[i].etsy_listing_id,
      board_slug: rotated[i].board_slug,
      scheduled_at: new Date(slot).toISOString(),
      status: 'queued',
      created_at: nowIso,
      // Non-null means "update this row" instead of inserting a new one,
      // which is what keeps etsy_listing_id unique across reposts.
      requeue_row_id: rotated[i].requeueRowId ?? null,
      _item: rotated[i],
    });
  }

  const inserts = toInsert.filter((r) => r.requeue_row_id == null);
  const requeues = toInsert.filter((r) => r.requeue_row_id != null);

  return {
    toInsert: inserts,
    toRequeue: requeues,
    already,
    skipped,
    unplaced,
    report: {
      candidates: items.length,
      added: toInsert.length,
      inserted: inserts.length,
      requeued: requeues.length,
      already_scheduled: already.length,
      skipped: skipped.length,
      unplaced: unplaced.length,
      free_slots_in_horizon: slotInstants.length,
      slots_taken_by_existing_queue: takenSlots.size,
      enabled_boards: [...enabled],
    },
  };
}

/**
 * Facebook caption assembly. Pure function, no n8n.
 *
 * Shaped by what the real feed contains: Pinterest puts the pin description
 * into BOTH <title> and <description>, so the two fields are usually the same
 * 600+ character block. Naively concatenating them prints everything twice.
 *
 * Modes:
 *   pinterest - use the pin's own text (default; no AI, no API key)
 *   template  - title + link only, for when the description is noise
 *   ai        - reserved: Workflow B routes to the Anthropic node instead and
 *               falls back here if that node fails
 */

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/** Compare texts ignoring case, punctuation and whitespace. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Cut to a length, preferring a sentence end, then a word end.
 * Returns the text unchanged when it already fits.
 */
function truncate(text, maxChars) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;

  const window = s.slice(0, maxChars);

  // Prefer ending on a sentence. The threshold trades budget for readability:
  // a caption that stops on a full stop reads better than one breaking
  // mid-thought with an ellipsis, so we accept losing part of the window.
  const sentence = Math.max(
    window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '),
    window.lastIndexOf('.\n'), window.lastIndexOf('… ')
  );
  if (sentence >= maxChars * 0.35) return window.slice(0, sentence + 1).trim();

  const word = window.lastIndexOf(' ');
  const cut = word >= maxChars * 0.5 ? window.slice(0, word) : window;
  return cut.replace(/[\s,;:.\-–—]+$/, '').trim() + '…';
}

/**
 * @returns {{post_text:string, text_mode:string, hashtags:string[], truncated:boolean}}
 */
function buildPostText({
  title = '',
  description = '',
  etsy_url = '',
  extraHashtags = '',
  maxChars = 600,
  mode = 'pinterest',
  maxHashtags = 5,
  // When true, the Etsy link is NOT put in the caption body - it is returned
  // separately as comment_text, to be posted as the first comment. Facebook
  // throttles posts with outbound links in the body, so moving the link to a
  // comment materially improves reach.
  linkInComment = false,
  // A short call-to-action appended to the body. Kept generic and brief on
  // purpose: a fabricated per-post "hook" across 6 posts/day would read as
  // botty. The pin's own first sentence is already benefit-led, so it serves
  // as the hook; this only nudges follow + points at the comment link.
  ctaFooter = '',
} = {}) {
  const t = String(title || '').trim();
  const d = String(description || '').trim();

  // --- pick the body ------------------------------------------------------
  let body;
  if (mode === 'template') {
    body = t || d;
  } else {
    const nt = norm(t);
    const nd = norm(d);
    if (!nt) body = d;
    else if (!nd) body = t;
    else if (nt === nd) body = t.length >= d.length ? t : d;
    // One field is a prefix/subset of the other (Pinterest truncates <title>).
    else if (nd.includes(nt)) body = d;
    else if (nt.includes(nd)) body = t;
    // Genuinely different text: title first, then description.
    else body = `${t}\n\n${d}`;
  }

  body = String(body || '').replace(/\n{3,}/g, '\n\n').trim();

  // --- hashtags -----------------------------------------------------------
  // Tags already inside the text are kept where they are only if the text is
  // short; otherwise they are collected and moved to the end, which is how
  // they read on Facebook.
  const found = [...new Set((body.match(HASHTAG_RE) || []).map((h) => h.toLowerCase()))];
  const extras = [...new Set(
    String(extraHashtags || '').split(/[\s,]+/)
      .map((h) => h.trim().toLowerCase())
      .filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h))
  )];

  let hashtags = found.slice(0, maxHashtags);
  if (hashtags.length < maxHashtags) {
    for (const e of extras) {
      if (hashtags.length >= maxHashtags) break;
      if (!hashtags.includes(e)) hashtags.push(e);
    }
  }

  // Strip inline tags from the body when they are being restated at the end,
  // so the same tag does not appear twice.
  let cleanBody = body;
  if (found.length) {
    cleanBody = body.replace(HASHTAG_RE, ' ').replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,!?])/g, '$1').replace(/\n[ \t]+/g, '\n').trim();
  }

  const beforeTruncate = cleanBody;
  cleanBody = truncate(cleanBody, maxChars);
  const truncated = cleanBody !== beforeTruncate;

  // --- assemble -----------------------------------------------------------
  const parts = [];
  if (cleanBody) parts.push(cleanBody);
  const cta = String(ctaFooter || '').trim();
  if (cta) parts.push(cta);
  if (hashtags.length) parts.push(hashtags.join(' '));
  // Link placement: in the body (legacy) or held back for the first comment.
  if (etsy_url && !linkInComment) parts.push(etsy_url);

  return {
    post_text: parts.join('\n\n'),
    comment_text: (linkInComment && etsy_url) ? String(etsy_url) : '',
    text_mode: mode,
    hashtags,
    truncated,
  };
}

// ---------------------------------------------------------------- n8n glue
// Workflow B: decide what goes into the posting queue.
//
// Reads the three tables loaded upstream by name, so each data-table node
// runs exactly once (they are chained through single-item gates).
// Mode: Run Once for All Items.

const cfg = $('Config').first().json;
const boards = $('Load Boards').all().map((i) => i.json || {}).filter((b) => b.board_slug);
const items = $('Load Items').all().map((i) => i.json || {}).filter((r) => r.etsy_listing_id);
const scheduleRows = $('Load Schedule').all().map((i) => i.json || {})
  .filter((r) => r.etsy_listing_id);

const enabledBoards = boards.filter((b) => b.enabled === true).map((b) => b.board_slug);
const priorityByBoard = {};
for (const b of boards) priorityByBoard[b.board_slug] = Number(b.priority) || 0;

const nowMs = Date.now();

const plan = planSchedule({
  items,
  scheduleRows,
  enabledBoards,
  priorityByBoard,
  slots: cfg._slots,
  timezone: cfg.TIMEZONE,
  nowMs,
  horizonDays: cfg._horizon_days,
  maxQueue: cfg._max_queue,
  repostAfterDays: cfg._repost_after_days,
  // Facebook rejects a scheduled_publish_time less than 10 minutes out, so
  // never hand it something that close.
  leadMinutes: 20,
});

const out = [];

// Inserts and requeues share the same caption logic; only the write differs.
// A requeue carries requeue_row_id so Workflow B UPDATES that row, which is
// what keeps schedule.etsy_listing_id unique across reposts.
for (const row of [...plan.toInsert, ...plan.toRequeue]) {
  const it = row._item || {};
  const text = buildPostText({
    title: it.title,
    description: it.description,
    etsy_url: it.etsy_url || `https://www.etsy.com/listing/${row.etsy_listing_id}`,
    extraHashtags: cfg.EXTRA_HASHTAGS,
    maxChars: cfg._text_max,
    mode: cfg.TEXT_MODE,
    linkInComment: cfg._link_in_comment,
    ctaFooter: cfg.CTA_FOOTER,
  });

  out.push({ json: {
    _kind: row.requeue_row_id == null ? 'queue' : 'requeue',
    requeue_row_id: row.requeue_row_id ?? null,
    etsy_listing_id: row.etsy_listing_id,
    board_slug: row.board_slug,
    scheduled_at: row.scheduled_at,
    status: 'queued',
    post_text: text.post_text,
    fb_post_id: '',
    error: '',
    created_at: row.created_at,
    posted_at: null,
    // Diagnostics, not stored - visible in the execution view.
    _title: String(it.title || '').slice(0, 80),
    _image_url: it.image_url || '',
    _hashtags: text.hashtags,
    _truncated: text.truncated,
  } });
}

// The report the spec asks for: counts plus the explicit "already scheduled"
// list, so nothing is silently dropped.
const report = {
  _kind: 'report',
  workflow: 'B - Build Schedule',
  level: plan.report.added ? 'info' : 'warn',
  context: 'build_summary',
  created_at: new Date(nowMs).toISOString(),
  added: plan.report.added,
  inserted: plan.report.inserted,
  requeued: plan.report.requeued,
  already_scheduled: plan.report.already_scheduled,
  skipped: plan.report.skipped,
  unplaced: plan.report.unplaced,
  enabled_boards: plan.report.enabled_boards,
  free_slots_in_horizon: plan.report.free_slots_in_horizon,
  text_mode: cfg.TEXT_MODE,
  already_list: plan.already.map((a) =>
    `Listing ${a.etsy_listing_id} "${String(a.title).slice(0, 60)}" `
    + `is already scheduled for ${a.scheduled_at}`
    + (a.status && a.status !== 'queued' ? ` (status: ${a.status})` : '')),
  skipped_breakdown: plan.skipped.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {}),
  skipped_examples: plan.skipped.slice(0, 5).map((s) => ({
    etsy_listing_id: s.etsy_listing_id, reason: s.reason,
    days_until_eligible: s.days_until_eligible,
  })),
  unplaced_breakdown: plan.unplaced.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {}),
  note: !enabledBoards.length
    ? 'No board is enabled, so nothing can be queued. Enable a board in the '
      + 'boards table or via Workflow D.'
    : plan.report.added
      ? `Queued ${plan.report.added} post(s) across slots ${cfg.SLOTS} `
        + `${cfg.TIMEZONE} (${plan.report.inserted} new, `
        + `${plan.report.requeued} reposted after the cooldown).`
      : 'Nothing new to queue - every eligible listing is already scheduled, '
        + 'posted recently, or its boards are disabled.',
};

// Report last so the queue rows lead the output and read naturally.
out.push({ json: report });
return out;
