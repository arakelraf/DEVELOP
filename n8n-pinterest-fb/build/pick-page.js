// Resolves the Page and its access token at run time.
//
// The OAuth credential holds a USER token (that is what the login dialog
// grants). Posting to a Page needs a PAGE token, which /me/accounts derives
// from it. Doing that on every run means:
//   - no token is ever copied by hand or stored in the config table
//   - a Page token derived from a long-lived user token does not expire
//   - FB_PAGE_ID becomes optional when the account manages one Page
// Mode: Run Once for All Items.

const cfg = $('Config').first().json;
const res = $input.first().json || {};
const body = res.body && typeof res.body === 'object' ? res.body : res;
const httpStatus = res.statusCode ?? null;

// Two different failures arrive here and must not be conflated:
//
//  1. n8n could not even send the request - almost always because the OAuth
//     credential has never been connected. The node then emits { error: ... }
//     with no statusCode, and the error object often serializes to {}.
//  2. Facebook answered with a Graph error, which has type/code/message.
const hasGraphError = body && body.error
  && (body.error.message || body.error.type || body.error.code !== undefined);

if (httpStatus == null && !hasGraphError) {
  const raw = res.error ?? body?.error;
  const detail = raw && (raw.message || raw.description || raw.reason);
  return [{ json: {
    ok: false,
    stage: 'request_not_sent',
    error: 'The call to /me/accounts never reached Facebook'
      + (detail ? `: ${detail}` : '.'),
    hint: 'This is what an unconnected login looks like. Open Credentials -> '
        + '"Facebook OAuth (login)" in n8n, fill in App ID and App Secret, '
        + 'then click "Connect my account" and approve the Facebook window. '
        + 'Re-run afterwards.',
    http_status: null,
  } }];
}

if (hasGraphError) {
  const e = body.error;
  const parts = [e.type || 'GraphError', e.code !== undefined ? `(${e.code})` : '']
    .filter(Boolean).join(' ');
  return [{ json: {
    ok: false,
    stage: 'me_accounts_failed',
    error: `${parts}: ${e.message || 'no message returned'}`
      + (e.error_user_msg ? ` - ${e.error_user_msg}` : ''),
    hint: e.code === 190
      ? 'The login has expired or been revoked. Open the "Facebook OAuth '
        + '(login)" credential and click "Connect my account" again.'
      : 'Check that the login granted pages_show_list, pages_manage_posts and '
        + 'pages_read_engagement.',
    http_status: httpStatus,
  } }];
}

const pages = Array.isArray(body && body.data) ? body.data : [];

if (!pages.length) {
  return [{ json: {
    ok: false,
    stage: 'no_pages',
    error: 'The logged-in account manages no Pages that this app can see.',
    hint: 'You must be an admin of the Page, and the login must have granted '
        + 'pages_show_list.',
    http_status: httpStatus,
  } }];
}

const wanted = String(cfg.FB_PAGE_ID || '').trim();
let page = null;

if (wanted) {
  page = pages.find((p) => String(p.id) === wanted) || null;
  if (!page) {
    return [{ json: {
      ok: false,
      stage: 'page_id_not_found',
      error: `FB_PAGE_ID is ${wanted}, but the logged-in account does not `
        + 'manage a Page with that id.',
      pages_available: pages.map((p) => ({ id: p.id, name: p.name })),
      hint: 'Fix FB_PAGE_ID in the config table, or clear it if the account '
          + 'manages exactly one Page.',
      http_status: httpStatus,
    } }];
  }
} else if (pages.length === 1) {
  page = pages[0];
} else {
  return [{ json: {
    ok: false,
    stage: 'page_id_required',
    error: `The account manages ${pages.length} Pages, so FB_PAGE_ID must say `
      + 'which one to post to.',
    pages_available: pages.map((p) => ({ id: p.id, name: p.name })),
    http_status: httpStatus,
  } }];
}

if (!page.access_token) {
  return [{ json: {
    ok: false,
    stage: 'no_page_token',
    error: `Page ${page.id} came back without an access_token.`,
    hint: 'The login did not grant pages_manage_posts for this Page.',
  } }];
}

return [{ json: {
  ok: true,
  page_id: String(page.id),
  page_name: String(page.name || ''),
  // Used as a request header by the publish nodes. Never written to a table.
  page_token: String(page.access_token),
  page_id_source: wanted ? 'config' : 'only_page_on_account',
  pages_available: pages.length,
} }];
