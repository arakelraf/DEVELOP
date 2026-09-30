/**
 * Board input normalization: turn whatever the user types into a username,
 * a board slug and an RSS URL.
 *
 * Used by the feed probe and by Workflow D's "add board" form, so a board
 * added through the UI and a board tested by hand always produce the same
 * rss_url. Part of the Pinterest source layer.
 *
 * The forms accept sloppy input on purpose - a pasted board URL, a profile
 * URL, an @handle, a display name - because the user fills them in by hand.
 */

const PINTEREST_HOST_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.[a-z.]+\//i;

/** "@SmartlyDigit", "pinterest.com/smartlydigit/", "SmartlyDigit" -> "smartlydigit" */
function normalizeUsername(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (PINTEREST_HOST_RE.test(s)) {
    const m = s.replace(PINTEREST_HOST_RE, '').split(/[/?#]/).filter(Boolean);
    s = m[0] || '';
  }
  s = s.replace(/^@/, '').trim().toLowerCase();
  // Pinterest usernames: letters, digits, underscore; no spaces.
  s = s.replace(/[^a-z0-9_]/g, '');
  return s;
}

/** "Printable Wall Art!" -> "printable-wall-art"; already-slug passes through. */
function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Pull username and/or slug out of a pasted Pinterest URL.
 * Returns {} when the string is not a Pinterest URL.
 */
function fromPinterestUrl(input) {
  const s = String(input || '').trim();
  if (!PINTEREST_HOST_RE.test(s)) return {};
  const parts = s.replace(PINTEREST_HOST_RE, '').split(/[?#]/)[0]
    .split('/').filter(Boolean);
  if (!parts.length) return {};
  const out = { username: normalizeUsername(parts[0]) };
  if (parts[1]) {
    // Tolerate a pasted ".../board.rss" too.
    out.board_slug = slugify(parts[1].replace(/\.rss$/i, ''));
  }
  // /pin/12345/ is a pin, not a board - do not mistake it for a slug.
  if (out.board_slug === 'pin' || /^\d+$/.test(out.board_slug || '')) {
    delete out.board_slug;
  }
  return out;
}

/**
 * Resolve the two form fields into a board definition.
 *
 * Either field may carry a full URL; a URL in the board field wins, because
 * that is what a user pasting a board link expects.
 *
 * @returns {{ok:true, username, board_slug, rss_url}|{ok:false, error}}
 */
function resolveBoard(usernameInput, boardInput) {
  const fromBoard = fromPinterestUrl(boardInput);
  const fromUser = fromPinterestUrl(usernameInput);

  const username = fromBoard.username
    || fromUser.username
    || normalizeUsername(usernameInput);

  const board_slug = fromBoard.board_slug
    || (fromBoard.username ? '' : slugify(boardInput))
    || fromUser.board_slug
    || '';

  if (!username) {
    return { ok: false, error:
      'Could not read a Pinterest username. Enter it as it appears in your '
      + 'profile URL (pinterest.com/USERNAME), or paste the profile URL.' };
  }
  if (!board_slug) {
    return { ok: false, error:
      'Could not read a board slug. Enter the last part of the board URL '
      + '(pinterest.com/username/BOARD-SLUG), or paste the board URL.' };
  }
  return { ok: true, username, board_slug, rss_url: buildRssUrl(username, board_slug) };
}

function buildRssUrl(username, board_slug) {
  return `https://www.pinterest.com/${username}/${board_slug}.rss`;
}

/**
 * Workflow D - control surface logic. Pure functions, no n8n, no clock.
 *
 * Every view and action the operator has: read the queue, look a listing up,
 * toggle a board, add one, reschedule or drop an entry, and produce the
 * copy-paste list for posting by hand when the Graph API is not available.
 *
 * Source-agnostic: works from boards / items / schedule keyed on
 * etsy_listing_id.
 */

// resolveBoard comes from the inlined board-url module above.

const DAY_MS = 86_400_000;
const PENDING = new Set(['queued', 'posting', 'scheduled']);

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

/** Accepts an Etsy URL in any shape, or a bare listing id. */
function parseListingRef(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/listing\/(\d{6,15})/i);
  if (m) return m[1];
  if (/^\d{6,15}$/.test(s)) return s;
  return '';
}

/** Wall-clock rendering in the operator's zone, for every view. */
function localTime(iso, timeZone) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso || '');
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(t)).replace(',', '');
}

function localDate(iso, timeZone) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(t));
}

function indexItems(items) {
  const byId = new Map();
  for (const it of items) {
    if (it && it.etsy_listing_id) byId.set(String(it.etsy_listing_id), it);
  }
  return byId;
}

// ------------------------------------------------------------------- views

/**
 * The posts due in a given local day, ready to paste by hand.
 * This is the no-API path: everything decided, nothing sent.
 */
function todaysPosts({ scheduleRows = [], items = [], timeZone = 'UTC',
                       nowMs = Date.now(), dayOffset = 0 } = {}) {
  const byId = indexItems(items);
  const target = localDate(new Date(nowMs + dayOffset * DAY_MS).toISOString(), timeZone);

  const due = scheduleRows
    .filter((r) => PENDING.has(String(r.status || '')))
    .filter((r) => localDate(r.scheduled_at, timeZone) === target)
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));

  return {
    date: target,
    timezone: timeZone,
    count: due.length,
    posts: due.map((r) => {
      const it = byId.get(String(r.etsy_listing_id)) || {};
      return {
        row_id: r.id,
        time: localTime(r.scheduled_at, timeZone).slice(-5),
        scheduled_at: r.scheduled_at,
        status: r.status,
        etsy_listing_id: r.etsy_listing_id,
        board_slug: r.board_slug,
        image_url: it.image_url || '',
        post_text: r.post_text || '',
        missing_item: !byId.has(String(r.etsy_listing_id)),
      };
    }),
  };
}

/** Grouped queue for the next N days. */
function queueView({ scheduleRows = [], items = [], timeZone = 'UTC',
                     nowMs = Date.now(), days = 7 } = {}) {
  const byId = indexItems(items);
  const until = nowMs + days * DAY_MS;

  const rows = scheduleRows
    .filter((r) => PENDING.has(String(r.status || '')))
    .filter((r) => {
      const t = Date.parse(r.scheduled_at);
      return Number.isFinite(t) && t <= until;
    })
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));

  const byDay = new Map();
  for (const r of rows) {
    const d = localDate(r.scheduled_at, timeZone);
    if (!byDay.has(d)) byDay.set(d, []);
    const it = byId.get(String(r.etsy_listing_id)) || {};
    byDay.get(d).push({
      row_id: r.id,
      time: localTime(r.scheduled_at, timeZone).slice(-5),
      status: r.status,
      etsy_listing_id: r.etsy_listing_id,
      board_slug: r.board_slug,
      title: String(it.title || '').slice(0, 70),
    });
  }

  return {
    days,
    timezone: timeZone,
    total: rows.length,
    by_day: [...byDay.entries()].map(([date, entries]) => ({ date, entries })),
  };
}

/** Everything known about one listing. */
function checkListing({ ref = '', scheduleRows = [], items = [],
                        timeZone = 'UTC' } = {}) {
  const id = parseListingRef(ref);
  if (!id) {
    return { ok: false,
      error: `Could not read a listing id from "${ref}". Paste the Etsy URL `
        + 'or just the numeric id.' };
  }

  const item = indexItems(items).get(id) || null;
  const rows = scheduleRows.filter((r) => String(r.etsy_listing_id) === id);
  const row = rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || null;

  let verdict;
  if (!row) {
    verdict = item
      ? 'not scheduled'
      : 'unknown - no items row either, so the sync has never seen this listing';
  } else if (PENDING.has(String(row.status))) {
    verdict = `already scheduled for ${localTime(row.scheduled_at, timeZone)} `
      + `(${timeZone})`
      + (row.status === 'scheduled' ? ' - already handed to Facebook' : '')
      + (row.status === 'posting' ? ' - being published right now' : '');
  } else if (row.status === 'posted') {
    verdict = `posted on ${localTime(row.posted_at || row.scheduled_at, timeZone)}`;
  } else if (row.status === 'failed') {
    verdict = `failed after ${row.attempts || 0} attempt(s): ${row.error || 'no error recorded'}`;
  } else if (row.status === 'skipped') {
    verdict = 'skipped - its boards were disabled';
  } else {
    verdict = `unknown status "${row.status}"`;
  }

  return {
    ok: true,
    etsy_listing_id: id,
    etsy_url: item ? item.etsy_url : `https://www.etsy.com/listing/${id}`,
    verdict,
    in_items: Boolean(item),
    title: item ? String(item.title || '').slice(0, 120) : '',
    boards: item ? parseList(item.board_slugs) : [],
    image_url: item ? item.image_url || '' : '',
    row: row ? {
      row_id: row.id, status: row.status,
      scheduled_at: row.scheduled_at, scheduled_local: localTime(row.scheduled_at, timeZone),
      posted_at: row.posted_at, attempts: row.attempts, error: row.error,
      fb_post_id: row.fb_post_id,
    } : null,
    can_queue_now: Boolean(item) && !row,
  };
}

/** Board list with what each one is actually contributing. */
function boardsView({ boards = [], items = [], scheduleRows = [] } = {}) {
  const pendingByBoard = {};
  for (const r of scheduleRows) {
    if (!PENDING.has(String(r.status || ''))) continue;
    const b = String(r.board_slug || '');
    pendingByBoard[b] = (pendingByBoard[b] || 0) + 1;
  }
  const itemsByBoard = {};
  for (const it of items) {
    for (const b of parseList(it.board_slugs)) {
      itemsByBoard[b] = (itemsByBoard[b] || 0) + 1;
    }
  }

  return {
    count: boards.length,
    boards: boards
      .slice()
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0)
        || String(a.board_slug).localeCompare(String(b.board_slug)))
      .map((b) => ({
        board_slug: b.board_slug,
        name: b.name || b.board_slug,
        enabled: b.enabled === true,
        priority: Number(b.priority) || 0,
        rss_url: b.rss_url,
        last_synced_at: b.last_synced_at || null,
        listings: itemsByBoard[b.board_slug] || 0,
        queued_now: pendingByBoard[b.board_slug] || 0,
      })),
  };
}

// ----------------------------------------------------------------- actions

/**
 * Turning a board off must not silently strand its queue, and turning it back
 * on must undo exactly that.
 *
 * Disabling: queued rows whose listing belongs ONLY to disabled boards become
 * skipped. A listing that also sits on an enabled board keeps its slot.
 * Enabling: skipped rows whose listing now has an enabled board go back to
 * queued.
 */
function planCascade({ boards = [], items = [], scheduleRows = [] } = {}) {
  const enabled = new Set(
    boards.filter((b) => b.enabled === true).map((b) => String(b.board_slug))
  );
  const byId = indexItems(items);
  const updates = [];

  for (const r of scheduleRows) {
    const status = String(r.status || '');
    const it = byId.get(String(r.etsy_listing_id));
    if (!it) continue;
    const hasEnabled = parseList(it.board_slugs).some((b) => enabled.has(b));

    if (PENDING.has(status) && !hasEnabled) {
      updates.push({ row_id: r.id, etsy_listing_id: r.etsy_listing_id,
        status: 'skipped',
        error: 'Every board for this listing is disabled.',
        reason: 'board_disabled' });
    } else if (status === 'skipped' && hasEnabled) {
      updates.push({ row_id: r.id, etsy_listing_id: r.etsy_listing_id,
        status: 'queued', error: '', reason: 'board_re_enabled' });
    }
  }

  return {
    updates,
    summary: {
      to_skip: updates.filter((u) => u.reason === 'board_disabled').length,
      to_restore: updates.filter((u) => u.reason === 'board_re_enabled').length,
      enabled_boards: [...enabled],
    },
  };
}

/** Validate an "add board" request into a row ready to insert. */
function planAddBoard({ username = '', board = '', name = '', priority = 0,
                        existing = [] } = {}) {
  const r = resolveBoard(username, board);
  if (!r.ok) return { ok: false, error: r.error };

  if (existing.some((b) => String(b.board_slug) === r.board_slug)) {
    return { ok: false,
      error: `Board "${r.board_slug}" is already in the table. Use the toggle `
        + 'action to enable or disable it.' };
  }

  return {
    ok: true,
    row: {
      board_slug: r.board_slug,
      name: String(name || '').trim() || r.board_slug,
      rss_url: r.rss_url,
      // New boards start disabled on purpose: sync collects their pins, and
      // nothing is published until you turn them on deliberately.
      enabled: false,
      priority: Number(priority) || 0,
      last_synced_at: null,
    },
    note: `Added disabled. Run "A - Sync Boards" to collect its pins, then `
      + 'enable it when you are ready to post from it.',
  };
}

/** Validate a reschedule/remove request against the actual row. */
function planEntryAction({ action = '', rowId = '', newTime = '',
                           scheduleRows = [], timeZone = 'UTC',
                           nowMs = Date.now() } = {}) {
  const id = String(rowId || '').trim();
  const row = scheduleRows.find((r) => String(r.id) === id);
  if (!row) {
    return { ok: false,
      error: `No schedule entry with id ${id || '(empty)'}. The queue view `
        + 'lists the ids.' };
  }

  if (action === 'remove') {
    if (row.status === 'scheduled') {
      return { ok: false,
        error: `Entry ${id} was already handed to Facebook (fb_post_id `
          + `${row.fb_post_id || 'unknown'}). Removing the row here would NOT `
          + 'unpublish it - delete the scheduled post in Meta Business Suite '
          + 'first, then remove the row.' };
    }
    return { ok: true, action: 'remove', row_id: row.id,
      note: `Entry ${id} for listing ${row.etsy_listing_id} will be deleted. `
        + 'The listing becomes eligible for queueing again on the next run of '
        + 'Workflow B.' };
  }

  // reschedule
  const t = Date.parse(newTime);
  if (!Number.isFinite(t)) {
    return { ok: false,
      error: `Could not read "${newTime}" as a time. Use an ISO timestamp `
        + 'like 2026-10-05T14:00:00Z, or 2026-10-05 16:00 for local time.' };
  }
  if (t <= nowMs) {
    return { ok: false,
      error: `${localTime(new Date(t).toISOString(), timeZone)} is in the past.` };
  }
  if (row.status === 'scheduled') {
    return { ok: false,
      error: `Entry ${id} is already scheduled on Facebook. Change the time in `
        + 'Meta Business Suite, or remove it there and reschedule here.' };
  }

  return {
    ok: true,
    action: 'reschedule',
    row_id: row.id,
    scheduled_at: new Date(t).toISOString(),
    // A failed row being rescheduled is a fresh start, so clear the failure.
    status: 'queued',
    note: `Entry ${id} moved to ${localTime(new Date(t).toISOString(), timeZone)} `
      + `(${timeZone}) and reset to queued.`,
  };
}

// ---------------------------------------------------------------- n8n glue
// Workflow D: read the form, answer everything read-only immediately, and
// validate everything that writes before a single table is touched.
// Mode: Run Once for All Items.

const cfg = $('Config').first().json;
const tz = cfg.TIMEZONE;
const boards = $('Load Boards').all().map((i) => i.json || {}).filter((b) => b.board_slug);
const items = $('Load Items').all().map((i) => i.json || {}).filter((r) => r.etsy_listing_id);
const scheduleRows = $('Load Schedule').all().map((i) => i.json || {})
  .filter((r) => r.etsy_listing_id);

const f = $('Control Form').first().json;
const get = (label) => String(f[label] ?? '').trim();

const ACTIONS = {
  "Today's posts (copy-paste list)": 'today',
  "Tomorrow's posts (copy-paste list)": 'tomorrow',
  'Queue for the next 7 days': 'queue7',
  'Check a listing': 'check',
  'Boards: show all': 'boards',
  'Board: enable': 'enable',
  'Board: disable': 'disable',
  'Board: add a new one': 'addboard',
  'Entry: reschedule': 'reschedule',
  'Entry: remove': 'remove',
};

const label = get('Action');
const action = ACTIONS[label] || '';

const answer = (title, text, extra = {}) => [{ json: {
  _kind: 'answer', title, text, ...extra } }];

if (!action) {
  return answer('Pick an action',
    `"${label}" is not one of the actions. Choose one from the dropdown.`);
}

// ------------------------------------------------------- copy-paste lists
//
// This is the no-API path: everything is decided here - what, when, which
// image, what caption - and you paste it into Meta Business Suite yourself.
const renderPosts = (view, heading) => {
  if (!view.count) {
    return answer(heading,
      `Nothing scheduled for ${view.date} (${view.timezone}).\n\n`
      + 'Run "B - Build Schedule" to fill the queue, and check that at least '
      + 'one board is enabled.');
  }
  const blocks = view.posts.map((p, i) => [
    `----- ${i + 1} of ${view.count} -----`,
    `TIME (${view.timezone}): ${p.time}`,
    `IMAGE: ${p.image_url || '(none - do not post this one)'}`,
    p.missing_item ? 'WARNING: the items row for this listing is gone.' : '',
    '',
    'CAPTION (copy everything between the lines):',
    '---8<---',
    p.post_text,
    '---8<---',
    '',
    `entry id ${p.row_id} | listing ${p.etsy_listing_id} | board ${p.board_slug}`,
  ].filter(Boolean).join('\n'));

  return answer(`${heading} - ${view.count} post(s)`,
    [`${view.date} (${view.timezone})`, '',
      'Paste each caption into Meta Business Suite and attach the image at '
      + 'the IMAGE url, then set the time shown.', '',
      ...blocks,
    ].join('\n'),
    { date: view.date, count: view.count });
};

if (action === 'today') {
  return renderPosts(todaysPosts({ scheduleRows, items, timeZone: tz }), 'Posts due today');
}
if (action === 'tomorrow') {
  return renderPosts(
    todaysPosts({ scheduleRows, items, timeZone: tz, dayOffset: 1 }), 'Posts due tomorrow');
}

if (action === 'queue7') {
  const v = queueView({ scheduleRows, items, timeZone: tz, days: 7 });
  if (!v.total) {
    return answer('Queue is empty',
      'Nothing is queued for the next 7 days. Run "B - Build Schedule", and '
      + 'check that a board is enabled.');
  }
  const lines = v.by_day.map((d) => [
    `${d.date}`,
    ...d.entries.map((e) =>
      `   ${e.time}  #${e.row_id}  ${e.status.padEnd(9)} ${e.etsy_listing_id}  `
      + `[${e.board_slug}]  ${e.title}`),
  ].join('\n'));
  return answer(`Queue - ${v.total} entr${v.total === 1 ? 'y' : 'ies'} in 7 days`,
    [`All times ${v.timezone}. The # is the entry id, for reschedule/remove.`,
      '', ...lines].join('\n'));
}

if (action === 'check') {
  const r = checkListing({ ref: get('Etsy URL or listing id'), scheduleRows, items,
    timeZone: tz });
  if (!r.ok) return answer('Could not read that listing', r.error);
  return answer(`Listing ${r.etsy_listing_id}`,
    [`${r.verdict.toUpperCase()}`, '',
      `Etsy:   ${r.etsy_url}`,
      `Title:  ${r.title || '(not in items)'}`,
      `Boards: ${r.boards.join(', ') || '(none)'}`,
      `Image:  ${r.image_url || '(none)'}`,
      '',
      r.row
        ? `Entry #${r.row.row_id} | status ${r.row.status}`
          + ` | slot ${r.row.scheduled_local}`
          + (r.row.attempts ? ` | attempts ${r.row.attempts}` : '')
          + (r.row.error ? `\nError: ${r.row.error}` : '')
          + (r.row.fb_post_id ? `\nFacebook post id: ${r.row.fb_post_id}` : '')
        : r.can_queue_now
          ? 'No schedule entry. The next run of "B - Build Schedule" will '
            + 'queue it, provided one of its boards is enabled.'
          : 'Not in items either - run "A - Sync Boards" first.',
    ].join('\n'));
}

if (action === 'boards') {
  const v = boardsView({ boards, items, scheduleRows });
  if (!v.count) {
    return answer('No boards yet', 'Use "Board: add a new one" to add the first.');
  }
  const lines = v.boards.map((b) =>
    `${b.enabled ? '[ON ]' : '[off]'} ${b.board_slug}`
    + `\n        name ${b.name} | priority ${b.priority}`
    + `\n        ${b.listings} listing(s) | ${b.queued_now} queued now`
    + `\n        last sync ${b.last_synced_at ? localTime(b.last_synced_at, tz) : 'never'}`
    + `\n        ${b.rss_url}`);
  return answer(`Boards - ${v.count}`,
    ['[ON] means its listings may be published. [off] still collects pins.',
      '', ...lines].join('\n'));
}

// -------------------------------------------------------- write actions
// Validated here; the write itself happens in the branch downstream.

if (action === 'enable' || action === 'disable') {
  const slug = get('Board slug (for enable / disable)');
  if (!slug) {
    return answer('Which board?',
      'Fill in "Board slug (for enable / disable)". Use "Boards: show all" to '
      + 'see the slugs.');
  }
  const board = boards.find((b) => String(b.board_slug) === slug);
  if (!board) {
    return answer('No such board',
      `There is no board "${slug}". Existing: `
      + boards.map((b) => b.board_slug).join(', ') || '(none)');
  }
  const want = action === 'enable';
  if (board.enabled === want) {
    return answer('Nothing to change',
      `Board "${slug}" is already ${want ? 'enabled' : 'disabled'}.`);
  }
  return [{ json: {
    _kind: 'toggle', board_slug: slug, enabled: want,
    board_name: board.name || slug,
  } }];
}

if (action === 'addboard') {
  const plan = planAddBoard({
    username: get('New board: Pinterest username'),
    board: get('New board: slug, name or pasted URL'),
    name: get('New board: display name'),
    priority: get('New board: priority'),
    existing: boards,
  });
  if (!plan.ok) return answer('Could not add that board', plan.error);
  return [{ json: { _kind: 'addboard', ...plan.row, note: plan.note } }];
}

if (action === 'reschedule' || action === 'remove') {
  const plan = planEntryAction({
    action,
    rowId: get('Entry id (the # from the queue view)'),
    newTime: get('New time (e.g. 2026-10-05T14:00:00Z)'),
    scheduleRows, timeZone: tz,
  });
  if (!plan.ok) return answer('Could not do that', plan.error);
  return [{ json: { _kind: plan.action, ...plan } }];
}

return answer('Not implemented', `Action "${action}" has no handler.`);
