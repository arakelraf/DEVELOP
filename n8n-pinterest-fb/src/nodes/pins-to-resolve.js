// Phase 2 gate: decide which pins get their page fetched this run.
//
// Each pin page is ~1MB, so this is the throttle that keeps a sync from
// turning into a scrape. Only pins with resolve_status='new' are candidates;
// 'ok', 'not_etsy' and 'failed' are terminal. Mode: Run Once for All Items.

const cfg = $('Config').first().json;
const rows = $input.all()
  .map((i) => i.json || {})
  .filter((r) => r.pin_id && r.resolve_status === 'new');

if (!rows.length) {
  return [{ json: { _kind: 'none',
    message: 'No pins awaiting resolution - every known pin is already '
           + 'resolved, parked as not_etsy, or failed past its retry limit.' } }];
}

// Oldest first, so a backlog drains in the order pins were discovered.
rows.sort((a, b) => String(a.first_seen_at || '').localeCompare(String(b.first_seen_at || '')));

return rows.slice(0, cfg._resolve_max).map((r) => ({ json: {
  pin_id: String(r.pin_id),
  pin_url: String(r.pin_url || ''),
  board_slug: String(r.board_slug || ''),
  title: String(r.title || ''),
  description: String(r.description || ''),
  image_url: String(r.image_url || ''),
  image_candidates: r.image_candidates || '[]',
  resolve_attempts: Number(r.resolve_attempts) || 0,
  resolved_at: r.resolved_at || null,
  etsy_listing_id: String(r.etsy_listing_id || ''),
} }));
