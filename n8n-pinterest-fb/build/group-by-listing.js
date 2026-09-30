// Phase 3: collapse resolved pins into one work item per Etsy listing.
//
// A listing pinned on several boards must produce ONE items row carrying all
// its board_slugs, never a duplicate per board - that is the whole point of
// keying on etsy_listing_id. Mode: Run Once for All Items.

const byListing = new Map();

for (const item of $input.all()) {
  const p = item.json || {};
  if (p.resolve_status !== 'ok' || !p.etsy_listing_id) continue;

  const id = String(p.etsy_listing_id);
  const cur = byListing.get(id) || {
    etsy_listing_id: id,
    etsy_url: `https://www.etsy.com/listing/${id}`,
    title: '',
    description: '',
    image_url: '',
    image_candidates: [],
    board_slugs: [],
    pin_urls: [],
  };

  // Prefer the richest text across the pins pointing at this listing.
  const t = String(p.title || '');
  const d = String(p.description || '');
  if (t.length > cur.title.length) cur.title = t;
  if (d.length > cur.description.length) cur.description = d;

  if (!cur.image_url && p.image_url) cur.image_url = String(p.image_url);
  if (!cur.image_candidates.length && p.image_candidates) {
    try {
      const c = typeof p.image_candidates === 'string'
        ? JSON.parse(p.image_candidates) : p.image_candidates;
      if (Array.isArray(c)) cur.image_candidates = c;
    } catch { /* keep empty; image_url still set */ }
  }
  if (p.board_slug && !cur.board_slugs.includes(p.board_slug)) cur.board_slugs.push(p.board_slug);
  if (p.pin_url && !cur.pin_urls.includes(p.pin_url)) cur.pin_urls.push(p.pin_url);

  byListing.set(id, cur);
}

const out = [...byListing.values()];
if (!out.length) {
  return [{ json: { _kind: 'none', message: 'No newly resolved listings this run.' } }];
}

// Expose an explicit candidate ladder for the HEAD-check chain downstream.
//
// Measured against real pins: /originals/*.jpg often 403s (hotlink
// protection, or the original is simply a PNG), /originals/*.png returns the
// true original (~850KB), and /1200x/ and /736x/ are byte-identical
// (~110KB). So three checks are worth making; the fourth is the safety net.
// Gaps are filled with the last known candidate so every slot is a real URL.
return out.map((v) => {
  const c = v.image_candidates.length ? v.image_candidates : [v.image_url].filter(Boolean);
  const at = (i) => c[i] || c[c.length - 1] || v.image_url || '';
  return { json: { _kind: 'listing', ...v,
    image_c1: at(0),
    image_c2: at(1),
    image_c3: at(2),
    image_c4: at(3),
  } };
});
