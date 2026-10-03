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
  dueGraceMs = 0,
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

    // --- due yet? ---------------------------------------------------------
    // The post is published by n8n at its slot (not handed to Facebook's
    // scheduler), so the Etsy link can be added as the first comment right
    // after publishing. A post whose slot has not arrived simply waits.
    const slot = Date.parse(row.scheduled_at || '');
    if (!Number.isFinite(slot)) {
      toSkip.push({ row_id: row.id, etsy_listing_id: id, status: 'failed',
        reason: 'bad_scheduled_at',
        error: `scheduled_at is not a date: ${row.scheduled_at}` });
      continue;
    }

    if (slot > nowMs + dueGraceMs) {
      notYet.push({ row_id: row.id, etsy_listing_id: id,
        reason: 'not_due_yet', scheduled_at: row.scheduled_at,
        minutes_until: Math.ceil((slot - nowMs) / 60_000) });
      continue;
    }

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
      // The link to post as the first comment (Workflow B now builds post_text
      // without the link in the body when link-in-comment is on).
      comment_text: item.etsy_url || `https://www.etsy.com/listing/${id}`,
      scheduled_at: row.scheduled_at,
      mode: 'immediate',
      scheduled_publish_time: null,
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
      immediate: toPublish.length,
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
      body: { message: entry.post_text, published: true },
    },
    // Posted as the first comment right after the feed post is created, so the
    // Etsy link does not sit in the body (where Facebook throttles reach).
    // Needs the real post id: `${base}/${post_id}/comments`.
    comment_message: entry.comment_text || '',
  };
}

/**
 * Wrap a raw image URL in an on-the-fly transform so the image Facebook
 * fetches is letterboxed onto a fixed canvas and is never cropped in the feed.
 *
 * Why this exists: a single photo in the Facebook feed is shown uncropped only
 * up to a 4:5 (portrait) aspect ratio. Pinterest pins are taller than that, so
 * the feed preview clips them top and bottom. Fitting the pin inside a 1080x1350
 * (4:5) canvas with a solid background means the whole pin is always visible.
 *
 * We use images.weserv.nl - a public, sharp-based image proxy. Facebook's own
 * crawler fetches the resulting URL; n8n never downloads the bytes. The ORIGINAL
 * url is kept untouched for the binary-upload fallback, so if the proxy is ever
 * unreachable the post still goes out (with the old, cropped image) instead of
 * failing.
 *
 *   fit=contain  scale to fit inside WxH, pad the rest
 *   cbg / bg     background colour for the padded area (named or hex, no '#')
 *   output=jpg   flatten to JPEG (no alpha, Facebook-friendly)
 *
 * @param {string} imageUrl  the original (http/https) image URL
 * @param {{enabled?:boolean,w?:number,h?:number,bg?:string}} [opts]
 * @returns {string} the transform URL, or the input unchanged when disabled
 *                   or not an http(s) URL
 */
function buildDisplayImageUrl(imageUrl, opts = {}) {
  const { enabled = true, w = 1080, h = 1350, bg = 'white' } = opts;
  const u = String(imageUrl || '').trim();
  if (!enabled || !/^https?:\/\//i.test(u)) return u;

  const src = u.replace(/^https?:\/\//i, '');     // weserv wants the source schemeless
  const color = String(bg || 'white').replace(/^#/, '');
  const params = [
    'url=' + encodeURIComponent(src),
    'w=' + Math.round(w),
    'h=' + Math.round(h),
    'fit=contain',
    'cbg=' + encodeURIComponent(color),
    'bg=' + encodeURIComponent(color),
    'output=jpg',
    'q=90',
  ].join('&');
  return 'https://images.weserv.nl/?' + params;
}

/** Canvas dimensions for a supported aspect ratio (longest side 1080/1350). */
function canvasForRatio(ratio) {
  switch (String(ratio || '4:5').trim()) {
    case '1:1': return { w: 1080, h: 1080 };
    case '4:5': return { w: 1080, h: 1350 };
    default:    return { w: 1080, h: 1350 };
  }
}

module.exports = {
  selectForPublish, buildGraphCalls, parseList, buildDisplayImageUrl, canvasForRatio,
  MIN_LEAD_MS, MAX_AHEAD_MS, ACTIONABLE,
};
