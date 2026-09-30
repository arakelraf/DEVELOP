// ---------------------------------------------------------------- n8n glue
// Phase 2: turn fetched pin pages into `pins` row updates.
//
// Input: one item per fetched pin page (HTTP Request, responseFormat=text,
// fullResponse, neverError). Pairing back to the pin is done by index, which
// is safe because the HTTP node emits exactly one item per input item.
// Mode: Run Once for All Items.

const pending = $('Pins To Resolve').all().map((i) => i.json);
const cfg = $('Config').first().json;
const maxAttempts = cfg._resolve_max_attempts;
const now = new Date().toISOString();

const out = [];
const all = $input.all();

for (let i = 0; i < all.length; i++) {
  const j = all[i].json || {};
  const pin = pending[i] || {};
  const pin_id = pin.pin_id || '';
  const attempts = (Number(pin.resolve_attempts) || 0) + 1;

  const html = typeof j.data === 'string' ? j.data
    : typeof j.body === 'string' ? j.body : '';
  const status = j.statusCode ?? null;

  let update;
  if (!html) {
    update = {
      resolve_status: attempts >= maxAttempts ? 'failed' : 'new',
      resolve_error: `empty response (http ${status ?? 'n/a'})`,
    };
  } else {
    const r = resolveEtsyFromHtml(html, { pin_url: pin.pin_url });
    if (r.ok) {
      update = {
        etsy_listing_id: r.etsy_listing_id,
        resolve_status: 'ok',
        resolve_error: '',
        resolved_at: now,
      };
    } else if (r.reason === 'destination_not_etsy') {
      // A pin pointing somewhere other than Etsy is a permanent outcome, not
      // a failure to retry.
      update = { resolve_status: 'not_etsy', resolve_error: r.sample_destination || '' };
    } else {
      update = {
        resolve_status: attempts >= maxAttempts ? 'failed' : 'new',
        resolve_error: `${r.reason} (http ${status ?? 'n/a'}, `
          + `${r.diagnostics?.html_bytes ?? 0} bytes)`,
      };
    }
  }

  out.push({ json: {
    pin_id,
    pin_url: pin.pin_url || '',
    board_slug: pin.board_slug || '',
    resolve_attempts: attempts,
    etsy_listing_id: update.etsy_listing_id ?? (pin.etsy_listing_id || ''),
    resolved_at: update.resolved_at ?? pin.resolved_at ?? null,
    resolve_status: update.resolve_status,
    resolve_error: String(update.resolve_error || '').slice(0, 500),
    http_status: status,
  } });
}

return out;
