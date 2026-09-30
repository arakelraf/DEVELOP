// Final report for a sync run. Reads the phase nodes rather than recomputing,
// and tolerates phases that did not run (no boards, nothing to resolve).
// Mode: Run Once for All Items.

const safe = (name, fn, dflt) => {
  try { return fn($(name).all().map((i) => i.json || {})); } catch { return dflt; }
};

const boards = safe('Boards To Sync', (r) => r.filter((x) => x._kind === 'board'), []);
const resolved = safe('Resolve Pin Result', (r) => r, []);
const listings = safe('Group By Listing', (r) => r.filter((x) => x._kind === 'listing'), []);
const attempted = safe('Pins To Resolve', (r) => r.filter((x) => x._kind !== 'none'), []);

const byStatus = resolved.reduce((a, r) => {
  const k = r.resolve_status || 'unknown';
  a[k] = (a[k] || 0) + 1;
  return a;
}, {});

return [{ json: {
  workflow: 'A - Sync Boards',
  finished_at: new Date().toISOString(),
  boards_synced: boards.length,
  boards: boards.map((b) => b.board_slug),
  pins_resolve_attempted: attempted.length,
  resolve_outcomes: byStatus,
  listings_upserted: listings.length,
  listings: listings.map((l) => ({
    etsy_listing_id: l.etsy_listing_id,
    title: String(l.title || '').slice(0, 70),
  })),
  note: attempted.length >= ($('Config').first().json._resolve_max || 10)
    ? 'Hit PIN_RESOLVE_MAX_PER_RUN - more pins remain queued for the next run.'
    : 'All known pins have been processed.',
} }];
