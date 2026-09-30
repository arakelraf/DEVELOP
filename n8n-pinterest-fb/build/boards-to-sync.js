// Normalizes the boards table into sync work items.
//
// Every board is synced whether or not it is enabled - `enabled` controls
// PUBLISHING (Workflow B), not collection. We keep accumulating pins for
// disabled boards so that enabling one later has a backlog ready.
// Mode: Run Once for All Items.

const rows = $input.all().map((i) => i.json || {}).filter((r) => r.board_slug || r.rss_url);
const now = new Date().toISOString();

const valid = [];
const bad = [];

for (const r of rows) {
  const slug = String(r.board_slug || '').trim();
  const url = String(r.rss_url || '').trim();
  if (!slug || !/^https?:\/\//i.test(url)) {
    bad.push({ slug, url });
    continue;
  }
  valid.push({
    row_id: r.id,
    board_slug: slug,
    name: String(r.name || slug),
    rss_url: url,
    enabled: r.enabled === true,
    priority: Number(r.priority) || 0,
  });
}

if (!valid.length) {
  return [{ json: {
    _kind: 'log',
    workflow: 'A - Sync Boards',
    level: 'warn',
    context: 'load_boards',
    message: rows.length
      ? `No usable boards. ${bad.length} row(s) lack a slug or a valid rss_url.`
      : 'The boards table is empty. Add a board via Workflow D or the table UI.',
    created_at: now,
  } }];
}

// Highest priority first, so a run that hits a cap does the important boards.
valid.sort((a, b) => b.priority - a.priority || a.board_slug.localeCompare(b.board_slug));
return valid.map((b) => ({ json: { _kind: 'board', ...b } }));
