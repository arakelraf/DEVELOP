// ---------------------------------------------------------------- n8n glue
// After a board is toggled, decide which queue rows must follow.
//
// $('Load Boards') still holds the state from BEFORE the update, so the
// toggle is applied in memory first - otherwise the cascade would be computed
// against stale data.
// Mode: Run Once for All Items.

const req = $('Parse Request').first().json;
const items = $('Load Items').all().map((i) => i.json || {}).filter((r) => r.etsy_listing_id);
const scheduleRows = $('Load Schedule').all().map((i) => i.json || {})
  .filter((r) => r.etsy_listing_id);

const boards = $('Load Boards').all().map((i) => ({ ...(i.json || {}) }))
  .filter((b) => b.board_slug)
  .map((b) => String(b.board_slug) === String(req.board_slug)
    ? { ...b, enabled: req.enabled } : b);

const plan = planCascade({ boards, items, scheduleRows });

if (!plan.updates.length) {
  return [{ json: { _kind: 'cascade_none', ...plan.summary,
    board_slug: req.board_slug, enabled: req.enabled } }];
}

return plan.updates.map((u) => ({ json: {
  _kind: 'cascade', ...u,
  board_slug: req.board_slug, enabled: req.enabled,
} }));
