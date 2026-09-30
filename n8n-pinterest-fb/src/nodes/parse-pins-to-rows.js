// ---------------------------------------------------------------- n8n glue
// Turns one board's RSS items into `pins` rows plus log rows.
//
// Note: a pin row is written even when the feed carries no Etsy link, because
// Pinterest's RSS never does - the link is recovered from the pin page in
// phase 2. resolve_status='new' marks a pin as awaiting that step.
// Mode: Run Once for All Items.

const board = $('Current Board').first().json;
const board_slug = board.board_slug;
const rss_url = board.rss_url;
const now = new Date().toISOString();

const rows = [];
const rejected = {};
let total = 0;
let feedError = null;

for (const item of $input.all()) {
  const raw = item.json || {};

  // The RSS node continues on error so one dead board cannot stop the rest;
  // a failed fetch arrives as an item carrying .error.
  if (raw.error) {
    feedError = String(raw.error.message || raw.error);
    break;
  }
  // alwaysOutputData can emit one empty placeholder item.
  if (!raw.title && !raw.link && !raw.guid && !raw.content) continue;

  total++;
  const r = parsePin(raw, { board_slug });
  const pin_url = r.pin_url || extractPinUrl(raw);
  const pin_id = (String(pin_url).match(/\/pin\/(\d+)/) || [])[1] || '';

  if (!pin_id) { rejected.no_pin_id = (rejected.no_pin_id || 0) + 1; continue; }

  const cands = r.ok && r.image_candidates.length
    ? r.image_candidates
    : imageCandidates(extractImage(raw));
  if (!cands.length) { rejected.no_image = (rejected.no_image || 0) + 1; continue; }

  rows.push({ json: {
    _kind: 'pin',
    pin_id,
    pin_url,
    board_slug,
    title: r.ok ? r.title : cleanText(raw.title),
    description: r.ok ? r.description
      : cleanText(raw.description || raw.content || raw['content:encoded'] || ''),
    image_url: cands[0],
    image_candidates: JSON.stringify(cands),
    // A feed that *does* carry the link skips the resolve step entirely.
    etsy_listing_id: r.ok ? r.etsy_listing_id : '',
    resolve_status: r.ok ? 'ok' : 'new',
    resolve_error: '',
    resolve_attempts: 0,
    first_seen_at: now,
    resolved_at: r.ok ? now : null,
  } });
}

if (feedError) {
  return [{ json: {
    _kind: 'log',
    workflow: 'A - Sync Boards',
    level: 'error',
    context: `board=${board_slug} url=${rss_url}`,
    message: `Feed fetch failed: ${feedError}`,
    created_at: now,
  } }];
}

const summary = {
  _kind: 'log',
  workflow: 'A - Sync Boards',
  level: rows.length ? 'info' : 'warn',
  context: `board=${board_slug}`,
  message: `feed_items=${total} usable_pins=${rows.length}`
    + (Object.keys(rejected).length ? ` rejected=${JSON.stringify(rejected)}` : ''),
  created_at: now,
};

return rows.length ? [...rows, { json: summary }] : [{ json: summary }];
