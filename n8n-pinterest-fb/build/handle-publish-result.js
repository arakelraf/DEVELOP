// Maps the Graph API response onto the schedule row update.
// Mode: Run Once for All Items.

const entry = $('Media Id').first().json;
const nowIso = new Date().toISOString();

// The post result always comes from FB Create Post (the input to this node may
// be the comment response on the comment branch).
const res = $('FB Create Post').first().json || {};
const body = res.body && typeof res.body === 'object' ? res.body : res;
const httpStatus = res.statusCode ?? null;

// Graph returns { id: "<page>_<post>" } on success, or { error: {...} }.
const postId = body && body.id ? String(body.id) : '';
const gErr = body && body.error ? body.error : null;

if (postId && !gErr) {
  // Was the first-comment (Etsy link) posted? Best-effort: a failed comment
  // does not fail the post.
  let comment_ok = null;
  try {
    const c = $('FB Add Comment').first().json || {};
    const cb = c.body && typeof c.body === 'object' ? c.body : c;
    comment_ok = Boolean(cb && cb.id);
  } catch { comment_ok = null; }

  return [{ json: {
    row_id: entry.row_id,
    etsy_listing_id: entry.etsy_listing_id,
    status: 'posted',
    fb_post_id: postId,
    fb_media_id: entry.media_fbid || '',
    error: comment_ok === false ? 'published, but first-comment link failed' : '',
    attempts: entry.attempts,
    last_attempt_at: nowIso,
    posted_at: nowIso,
    _ok: true,
    _note: 'Published immediately'
      + (entry.fb_comment_message
          ? (comment_ok ? ' with the link in the first comment.'
             : comment_ok === false ? ' - but the first comment failed to post.'
             : '.')
          : '.'),
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
