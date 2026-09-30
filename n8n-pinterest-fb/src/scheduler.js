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

module.exports = {
  planSchedule, buildSlotInstants, zonedTimeToUtc, zonedYmd, tzOffsetMs, parseList,
  PENDING_STATUSES,
};
