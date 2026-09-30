// Phase 3: choose the highest-resolution image URL that actually loads.
//
// Three HEAD checks run unconditionally - they carry no body, and newly
// resolved listings are rare. Measured on real pins:
//   /originals/*.jpg  often 403 (hotlink protection, or original is a PNG)
//   /originals/*.png  200, the true original (~850KB)
//   /1200x/*.jpg      200 (~110KB, byte-identical to /736x/)
// Whichever answers 200 first wins. If none do we keep the last candidate
// anyway: Workflow C can still publish it by downloading the bytes and
// uploading them to Facebook as a file.
// Mode: Run Once for All Items.

const merged = $('Merge Item').first().json;

const statusOf = (nodeName) => {
  try {
    return ($(nodeName).first().json || {}).statusCode ?? null;
  } catch {
    return null; // node did not run
  }
};

const ladder = [
  { url: merged.image_c1, status: statusOf('Verify Image 1'), label: 'originals-jpg' },
  { url: merged.image_c2, status: statusOf('Verify Image 2'), label: 'originals-png' },
  { url: merged.image_c3, status: statusOf('Verify Image 3'), label: '1200x' },
];

const hit = ladder.find((c) => c.status === 200 && c.url);

const image_url = hit ? hit.url
  : (merged.image_c4 || merged.existing_image_url || merged.image_c1 || '');

const image_check = hit
  ? `${hit.label} 200`
  : ladder.map((c) => `${c.label} ${c.status ?? 'n/a'}`).join(', ')
    + ' - unverified, Workflow C will upload the bytes instead';

return [{ json: {
  etsy_listing_id: merged.etsy_listing_id,
  etsy_url: merged.etsy_url,
  title: merged.title,
  description: merged.description,
  image_url,
  board_slugs: merged.board_slugs,
  pin_urls: merged.pin_urls,
  first_seen_at: merged.first_seen_at,
  last_seen_at: merged.last_seen_at,
  _is_new: merged.is_new,
  _image_check: image_check,
} }];
