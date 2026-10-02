// ---------------------------------------------------------------- n8n glue
// Workflow C: decide what to publish, and how.
// Mode: Run Once for All Items.

const cfg = $('Config').first().json;
const boards = $('Load Boards').all().map((i) => i.json || {}).filter((b) => b.board_slug);
const items = $('Load Items').all().map((i) => i.json || {}).filter((r) => r.etsy_listing_id);
const rows = $('Load Queue').all().map((i) => i.json || {}).filter((r) => r.etsy_listing_id);

const enabledBoards = boards.filter((b) => b.enabled === true).map((b) => b.board_slug);
const nowMs = Date.now();

const plan = selectForPublish({
  rows,
  items,
  enabledBoards,
  nowMs,
  retryDelayMinutes: cfg._retry_delay_minutes,
  maxAttempts: 2,
  maxPerRun: cfg._max_publish,
  // Small grace so a post whose slot is a couple of minutes away still goes
  // out this run rather than waiting a whole cycle.
  dueGraceMs: 3 * 60 * 1000,
});

// In live mode the Page id comes from the OAuth login itself, so the config
// key is optional. Pick Page does not run during a dry run.
const oauthPageId = (() => {
  try {
    const p = $('Pick Page').first().json;
    return p && p.ok ? String(p.page_id) : '';
  } catch {
    return '';
  }
})();

const realPageId = String(cfg.FB_PAGE_ID || '').trim() || oauthPageId;
const apiVersion = String(cfg.FB_API_VERSION || 'v21.0').trim();
const out = [];

// A dry run never calls Facebook, so it does not need a real Page id - and
// being able to validate the whole path BEFORE obtaining a token is the
// entire point of the dry run. The placeholder is obvious on sight in the
// logged URLs.
const pageId = realPageId || (cfg._dry_run ? 'FB_PAGE_ID_NOT_SET' : '');

// Outside a dry run, a missing Page id means nothing can be published. Say so
// once, rather than failing every row with an opaque HTTP error.
if (plan.toPublish.length && !pageId) {
  out.push({ json: {
    _kind: 'report',
    workflow: 'C - Publisher',
    level: 'error',
    context: 'publish_blocked',
    created_at: new Date(nowMs).toISOString(),
    ...plan.report,
    publishing: 0,
    note: 'FB_PAGE_ID is empty in the config table, so nothing was published. '
        + `${plan.toPublish.length} row(s) are ready and waiting. Either `
        + 'connect the "Facebook OAuth (login)" credential, which supplies '
        + 'the Page id automatically, or fill FB_PAGE_ID in the config table.',
  } });
  // Skip rows still get applied - a disabled board should not wait on a token.
  for (const s of plan.toSkip) out.push({ json: { _kind: 'skip', ...s } });
  return out;
}

for (const p of plan.toPublish) {
  const calls = buildGraphCalls(p, { pageId, apiVersion });
  out.push({ json: {
    _kind: 'publish',
    ...p,
    fb_photo_url: calls.photo.url,
    fb_feed_url: calls.feed.url,
    fb_published: calls.feed.body.published,
    fb_comment_message: calls.comment_message || '',
    dry_run: cfg._dry_run,
  } });
}

for (const s of plan.toSkip) out.push({ json: { _kind: 'skip', ...s } });

out.push({ json: {
  _kind: 'report',
  workflow: 'C - Publisher',
  level: plan.toSkip.length ? 'warn' : 'info',
  context: 'publish_summary',
  created_at: new Date(nowMs).toISOString(),
  dry_run: cfg._dry_run,
  page_id_set: Boolean(realPageId),
  ...plan.report,
  deferred_examples: plan.notYet.slice(0, 5),
  note: cfg._dry_run
    ? 'DRY_RUN is on: nothing was sent to Facebook. The exact request bodies '
      + 'are in errors_log. Set DRY_RUN=false in config once the token is in.'
      + (realPageId ? '' : ' FB_PAGE_ID is still empty, so the logged URLs '
        + 'carry a placeholder.')
    : `Publishing ${plan.report.publishing} post(s): `
      + `${plan.report.scheduled} handed to Facebook as scheduled, `
      + `${plan.report.immediate} published immediately.`,
} });

return out;
