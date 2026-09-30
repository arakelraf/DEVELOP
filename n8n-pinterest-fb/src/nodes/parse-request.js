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
