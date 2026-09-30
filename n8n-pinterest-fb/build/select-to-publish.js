/**
 * Publish selection. Pure functions, no n8n, no clock of its own.
 *
 * Two publishing shapes, chosen per row rather than globally:
 *
 *   scheduled - hand the post to Facebook with published=false and a
 *               scheduled_publish_time, and let Facebook publish it. Fewer
 *               moving parts: n8n does not have to be alive at 10:00.
 *   immediate - publish now. Used when a row's slot has already arrived (or
 *               passed), because Facebook refuses a scheduled time that is
 *               not at least 10 minutes out.
 *
 * Source-agnostic: works from schedule rows and items keyed on
 * etsy_listing_id.
 */

const MIN_LEAD_MS = 10 * 60_000;            // Facebook's own minimum
const MAX_AHEAD_MS = 180 * 86_400_000;      // Facebook's own maximum (~6 months)

/** Statuses this workflow is allowed to act on. */
const ACTIONABLE = new Set(['queued', 'failed']);

function parseList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.map(String);
      if (typeof p === 'string') return [p];
    } catch { return [v]; }
  }
  return [];
}

/**
 * Decide what to publish this run.
 *
 * @returns {{toPublish:Array, toSkip:Array, notYet:Array, report:Object}}
 */
function selectForPublish({
  rows = [],
  items = [],
  enabledBoards = [],
  nowMs = Date.now(),
  retryDelayMinutes = 30,
  maxAttempts = 2,
  maxPerRun = 20,
  minLeadMs = MIN_LEAD_MS,
  maxAheadMs = MAX_AHEAD_MS,
} = {}) {
  const enabled = new Set(enabledBoards.map(String));
  const itemById = new Map();
  for (const it of items) {
    if (it && it.etsy_listing_id) itemById.set(String(it.etsy_listing_id), it);
  }

  const toPublish = [];
  const toSkip = [];
  const notYet = [];

  // Earliest slots first: a backlog drains in schedule order.
  const ordered = rows
    .filter((r) => r && ACTIONABLE.has(String(r.status || '')))
    .slice()
    .sort((a, b) => String(a.scheduled_at || '').localeCompare(String(b.scheduled_at || '')));

  for (const row of ordered) {
    const id = String(row.etsy_listing_id || '');
    const status = String(row.status || '');
    const attempts = Number(row.attempts) || 0;

    // --- retry gating for a row that already failed ------------------------
    if (status === 'failed') {
      if (attempts >= maxAttempts) {
        notYet.push({ row_id: row.id, etsy_listing_id: id,
          reason: 'retry_limit_reached', attempts, error: row.error || '' });
        continue;
      }
      const last = Date.parse(row.last_attempt_at || row.updatedAt || '');
      const waited = Number.isFinite(last) ? nowMs - last : Infinity;
      if (waited < retryDelayMinutes * 60_000) {
        notYet.push({ row_id: row.id, etsy_listing_id: id,
          reason: 'retry_delay_not_elapsed', attempts,
          minutes_remaining: Math.ceil((retryDelayMinutes * 60_000 - waited) / 60_000) });
        continue;
      }
    }

    // --- the item must still exist ----------------------------------------
    const item = itemById.get(id);
    if (!item) {
      toSkip.push({ row_id: row.id, etsy_listing_id: id, status: 'failed',
        reason: 'item_row_missing',
        error: `No items row for listing ${id}. It was removed, or the sync `
          + 'never produced it.' });
      continue;
    }

    // --- boards must still be enabled -------------------------------------
    const boards = parseList(item.board_slugs);
    if (!boards.some((b) => enabled.has(b))) {
      toSkip.push({ row_id: row.id, etsy_listing_id: id, status: 'skipped',
        reason: 'all_boards_disabled',
        error: `Every board for this listing is disabled (${boards.join(', ') || 'none'}).` });
      continue;
    }

    // --- there must be something to post ----------------------------------
    const image_url = String(item.image_url || '');
    if (!image_url) {
      toSkip.push({ row_id: row.id, etsy_listing_id: id, status: 'failed',
        reason: 'no_image', error: 'The items row has no image_url.' });
      continue;
    }
    const post_text = String(row.post_text || '');
    if (!post_text.trim()) {
      toSkip.push({ row_id: row.id, etsy_listing_id: id, status: 'failed',
        reason: 'no_post_text', error: 'The schedule row has an empty post_text.' });
      continue;
    }

    // --- immediate or scheduled? ------------------------------------------
    const slot = Date.parse(row.scheduled_at || '');
    if (!Number.isFinite(slot)) {
      toSkip.push({ row_id: row.id, etsy_listing_id: id, status: 'failed',
        reason: 'bad_scheduled_at',
        error: `scheduled_at is not a date: ${row.scheduled_at}` });
      continue;
    }

    const lead = slot - nowMs;
    if (lead > maxAheadMs) {
      // Beyond what Facebook will accept; a later run will pick it up.
      notYet.push({ row_id: row.id, etsy_listing_id: id,
        reason: 'beyond_facebook_scheduling_window',
        scheduled_at: row.scheduled_at,
        days_ahead: Math.round(lead / 86_400_000) });
      continue;
    }

    const mode = lead >= minLeadMs ? 'scheduled' : 'immediate';

    if (toPublish.length >= maxPerRun) {
      notYet.push({ row_id: row.id, etsy_listing_id: id,
        reason: 'max_publish_per_run', scheduled_at: row.scheduled_at });
      continue;
    }

    toPublish.push({
      row_id: row.id,
      etsy_listing_id: id,
      board_slug: row.board_slug || '',
      post_text,
      image_url,
      etsy_url: item.etsy_url || `https://www.etsy.com/listing/${id}`,
      scheduled_at: row.scheduled_at,
      mode,
      // Facebook wants whole seconds since the epoch, and only for a
      // scheduled post.
      scheduled_publish_time: mode === 'scheduled' ? Math.floor(slot / 1000) : null,
      attempts: attempts + 1,
      was_retry: status === 'failed',
    });
  }

  return {
    toPublish,
    toSkip,
    notYet,
    report: {
      actionable_rows: ordered.length,
      publishing: toPublish.length,
      scheduled: toPublish.filter((p) => p.mode === 'scheduled').length,
      immediate: toPublish.filter((p) => p.mode === 'immediate').length,
      retries: toPublish.filter((p) => p.was_retry).length,
      skipping: toSkip.length,
      deferred: notYet.length,
      skip_reasons: toSkip.reduce((a, s) => {
        a[s.reason] = (a[s.reason] || 0) + 1; return a;
      }, {}),
      defer_reasons: notYet.reduce((a, s) => {
        a[s.reason] = (a[s.reason] || 0) + 1; return a;
      }, {}),
    },
  };
}

/**
 * Turn a selection entry into the two Graph API calls.
 *
 * A scheduled photo post is a two-step operation: upload the photo
 * unpublished to get a media id, then create the feed post with that
 * attachment and the publish time. Posting the photo directly to /photos with
 * a scheduled time is not reliable across API versions.
 */
function buildGraphCalls(entry, { pageId, apiVersion = 'v21.0' } = {}) {
  if (!pageId) throw new Error('FB_PAGE_ID is not set in the config table.');
  const base = `https://graph.facebook.com/${apiVersion}`;
  return {
    photo: {
      url: `${base}/${pageId}/photos`,
      body: { url: entry.image_url, published: false },
    },
    // media_fbid is filled in once the upload returns.
    feed: {
      url: `${base}/${pageId}/feed`,
      body: {
        message: entry.post_text,
        published: entry.mode === 'scheduled' ? false : true,
        ...(entry.mode === 'scheduled'
          ? { scheduled_publish_time: entry.scheduled_publish_time } : {}),
      },
    },
  };
}

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
});

const realPageId = String(cfg.FB_PAGE_ID || '').trim();
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
        + `${plan.toPublish.length} row(s) are ready and waiting. Fill in the `
        + 'Page id (step 5 of docs/facebook-page-token.md) and re-run.',
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
    fb_scheduled_publish_time: calls.feed.body.scheduled_publish_time ?? null,
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
