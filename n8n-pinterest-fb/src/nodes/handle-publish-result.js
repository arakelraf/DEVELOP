// Maps the Graph API response onto the schedule row update.
// Mode: Run Once for All Items.

const entry = $('Media Id').first().json;
const nowIso = new Date().toISOString();

const res = $input.first().json || {};
const body = res.body && typeof res.body === 'object' ? res.body : res;
const httpStatus = res.statusCode ?? null;

// Graph returns { id: "<page>_<post>" } on success, or { error: {...} }.
const postId = body && body.id ? String(body.id) : '';
const gErr = body && body.error ? body.error : null;

if (postId && !gErr) {
  const scheduled = entry.mode === 'scheduled';
  return [{ json: {
    row_id: entry.row_id,
    etsy_listing_id: entry.etsy_listing_id,
    // `scheduled` means Facebook accepted it and will publish at
    // scheduled_at. It is deliberately distinct from `posted` so the
    // scheduler still treats the listing as taken, and so a later
    // verification pass can tell the two apart.
    status: scheduled ? 'scheduled' : 'posted',
    fb_post_id: postId,
    fb_media_id: entry.media_fbid || '',
    error: '',
    attempts: entry.attempts,
    last_attempt_at: nowIso,
    posted_at: scheduled ? entry.scheduled_at : nowIso,
    _ok: true,
    _note: scheduled
      ? `Accepted by Facebook, will publish at ${entry.scheduled_at}.`
      : 'Published immediately.',
  } }];
}

const message = gErr
  ? `${gErr.type || 'GraphError'} ${gErr.code ?? ''}: ${gErr.message || ''}`
    + (gErr.error_user_msg ? ` (${gErr.error_user_msg})` : '')
  : entry.upload_error
    || `Facebook returned no post id (http ${httpStatus ?? 'n/a'}).`;

return [{ json: {
  row_id: entry.row_id,
  etsy_listing_id: entry.etsy_listing_id,
  status: 'failed',
  fb_post_id: '',
  fb_media_id: entry.media_fbid || '',
  error: String(message).slice(0, 500),
  attempts: entry.attempts,
  last_attempt_at: nowIso,
  posted_at: null,
  _ok: false,
  _note: entry.attempts >= 2
    ? 'Second failure - the row is parked as failed and will not be retried '
      + 'automatically. Reschedule it from Workflow D once the cause is fixed.'
    : `First failure - it will be retried after the configured delay.`,
} }];
