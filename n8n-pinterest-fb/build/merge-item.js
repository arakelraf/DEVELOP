// Phase 3: merge this listing with the items row that may already exist.
//
// Data tables have no UNIQUE constraint, so "never create a duplicate" is
// enforced here plus the upsert filter on etsy_listing_id. Merging is additive:
// a listing pinned on a new board gains that slug and keeps the old ones.
// Mode: Run Once for All Items.

const listing = $('Loop Listings').first().json;
const now = new Date().toISOString();

// "Get Existing Item" has alwaysOutputData, so a miss arrives as an item with
// no etsy_listing_id rather than as zero items.
const existingRows = $input.all()
  .map((i) => i.json || {})
  .filter((r) => r.etsy_listing_id);
const existing = existingRows[0] || null;

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

const mergeUnique = (a, b) => {
  const out = [];
  const seen = new Set();
  for (const v of [...a, ...b]) {
    const s = String(v || '').trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
};

const board_slugs = mergeUnique(parseList(existing?.board_slugs), listing.board_slugs);
const pin_urls = mergeUnique(parseList(existing?.pin_urls), listing.pin_urls);

return [{ json: {
  row_id: existing?.id ?? null,
  is_new: !existing,
  etsy_listing_id: listing.etsy_listing_id,
  etsy_url: listing.etsy_url,
  // Keep existing text if the new pin has less to say.
  title: (listing.title || '').length > String(existing?.title || '').length
    ? listing.title : String(existing?.title || ''),
  description: (listing.description || '').length > String(existing?.description || '').length
    ? listing.description : String(existing?.description || ''),
  board_slugs: JSON.stringify(board_slugs),
  pin_urls: JSON.stringify(pin_urls),
  first_seen_at: existing?.first_seen_at || now,
  last_seen_at: now,
  // Carried through for the image HEAD checks downstream.
  image_c1: listing.image_c1,
  image_c2: listing.image_c2,
  image_c3: listing.image_c3,
  image_c4: listing.image_c4,
  existing_image_url: String(existing?.image_url || ''),
} }];
