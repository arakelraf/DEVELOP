/**
 * Pinterest pin -> Etsy listing extraction.
 *
 * This is the ONLY place that knows Pinterest exists. It is kept as a plain
 * module so it can be unit-tested outside n8n; the same body is pasted into
 * Workflow A's "Parse Pins" Code node.
 *
 * Contract (the isolation boundary the rest of the system depends on):
 *   input : a raw RSS item object from the RSS Feed Read node
 *   output: { ok: true, etsy_listing_id, etsy_url, title, description,
 *             image_url, image_candidates, pin_url }
 *        or { ok: false, reason, pin_url }
 *
 * Workflows B/C/D never see a field from this file other than the ones above,
 * and key off etsy_listing_id. Swapping in the Etsy API later means replacing
 * this file and nothing else.
 */

// ---------------------------------------------------------------- HTML text

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·',
  eacute: 'é', trade: '™', reg: '®', copy: '©',
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const k = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
    });
}

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

// Pinterest boilerplate that adds nothing to a Facebook caption.
const BOILERPLATE = [
  /\b(?:this|these)\s+pins?\s+(?:was|were)\s+discovered\s+by[^.]*\.?/i,
  /\bdiscover\s+\(and\s+save!?\)\s+your\s+own\s+pins\s+on\s+pinterest\.?/i,
  /\bfind\s+this\s+pin\s+and\s+more\s+on\s+[^.|]*\s+by\s+[^.|]*\.?/i,
  /\bsaved?\s+(from|to)\s+pinterest\.?/i,
  /\bmore\s+ideas\s+about\s+[^.]*\./i,
  /\bclick\s+(the\s+)?link\s+(in\s+bio|to\s+(shop|buy|view))\b[^.]*\.?/i,
  /\bvisit\s+(my|our)\s+(etsy\s+)?shop\s+for\s+more\b[^.]*\.?/i,
];

/** Strip tags, decode entities, drop boilerplate, collapse whitespace. */
function cleanText(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Keep paragraph/line structure before tags are removed.
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  // A bare Pinterest/Etsy URL left in the body is noise; the link is appended
  // deliberately at the end of the caption by Workflow B.
  s = s.replace(/https?:\/\/(www\.)?(pinterest\.[a-z.]+|pin\.it|etsy\.com)\/\S*/gi, ' ');
  for (const re of BOILERPLATE) s = s.replace(re, ' ');
  s = s.replace(/[ \t ]+/g, ' ')
       .replace(/ ?\n ?/g, '\n')
       .replace(/\n{3,}/g, '\n\n')
       .trim();
  return s;
}

// ---------------------------------------------------------------- Etsy link

/**
 * Etsy listing URLs we accept:
 *   https://www.etsy.com/listing/1234567890/slug?utm_source=...
 *   https://etsy.com/listing/1234567890
 *   https://www.etsy.com/il-en/listing/1234567890/slug   (locale prefix)
 *   https://www.etsy.com/shop/X/listing/1234567890/slug
 * Rejected: anything without a /listing/{digits} segment.
 */
const ETSY_LISTING_RE = /https?:\/\/(?:[a-z0-9-]+\.)?etsy\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(?:[^\s"'<>?#]*\/)?listing\/(\d{6,15})(?:[\/?#][^\s"'<>]*)?/i;

/** Pinterest wraps outbound links in a redirector; unwrap before matching. */
function unwrapRedirect(url) {
  const s = String(url || '');
  const m = s.match(/[?&](?:url|u|redirect|target|dest)=([^&]+)/i);
  if (!m) return s;
  try {
    const inner = decodeURIComponent(m[1]);
    if (/^https?:\/\//i.test(inner)) return inner;
  } catch { /* malformed escape - fall through */ }
  return s;
}

/** Collect every plausible URL from an RSS item, in order of trustworthiness. */
function linkCandidates(item) {
  const out = [];
  const push = (v) => { if (v && typeof v === 'string') out.push(v); };

  push(item.link);
  push(item.guid && (item.guid._ || item.guid.value || item.guid));
  push(item.id);
  // Some feeds put the outbound URL in an enclosure or a namespaced field.
  if (item.enclosure && item.enclosure.url) push(item.enclosure.url);
  push(item['pinterest:link']);

  const html = [
    item.description,
    item.content,
    item['content:encoded'],
    item.contentSnippet,
    item.summary,
  ].filter(Boolean).join(' ');

  // Every href/src in the HTML, plus any bare URL in the text.
  for (const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) push(m[0]);

  return out.map(unwrapRedirect);
}

/** First Etsy listing link found, normalized. null when the pin has none. */
function extractEtsy(item) {
  for (const cand of linkCandidates(item)) {
    const m = String(cand).match(ETSY_LISTING_RE);
    if (m) {
      const id = m[1];
      return { etsy_listing_id: id, etsy_url: `https://www.etsy.com/listing/${id}` };
    }
  }
  return null;
}

// ------------------------------------------------------------------- images

/**
 * Pinterest serves the same image at several sizes under a size segment:
 *   https://i.pinimg.com/236x/ab/cd/ef/abcdef123.jpg
 *   https://i.pinimg.com/originals/ab/cd/ef/abcdef123.jpg
 * /originals/ is the largest but does not always exist (and can carry a
 * different extension), so return an ordered candidate list. Workflow A
 * HEAD-checks them and stores the first that actually loads.
 */
const PINIMG_SIZE_RE = /^(https?:\/\/i\.pinimg\.com\/)([^/]+)(\/.+)$/i;
const SIZE_PREFERENCE = ['originals', '1200x', '736x', '564x', '474x', '236x'];

function imageCandidates(url) {
  const s = String(url || '').trim();
  if (!s) return [];
  const m = s.match(PINIMG_SIZE_RE);
  if (!m) return [s];
  const [, host, currentSize, path] = m;
  const out = [];
  for (const size of SIZE_PREFERENCE) {
    out.push(`${host}${size}${path}`);
    // /originals/ frequently stores a .png or .webp where the thumb was .jpg.
    if (size === 'originals') {
      const swapped = path.replace(/\.(jpe?g)$/i, '.png');
      if (swapped !== path) out.push(`${host}${size}${swapped}`);
    }
  }
  if (!SIZE_PREFERENCE.includes(currentSize.toLowerCase())) out.push(s);
  // De-duplicate, preserve order, and always keep the original as last resort.
  const seen = new Set();
  const uniq = out.filter((u) => !seen.has(u) && seen.add(u));
  if (!uniq.includes(s)) uniq.push(s);
  return uniq;
}

/** Pull the pin image out of an RSS item. */
function extractImage(item) {
  const html = [
    item.description, item.content, item['content:encoded'], item.summary,
  ].filter(Boolean).join(' ');

  // Prefer a real media field when the feed provides one.
  const media = item['media:content'] || item['media:thumbnail'];
  const mediaUrl = media && (media.url || (media.$ && media.$.url));
  if (mediaUrl) return String(mediaUrl);
  if (item.enclosure && item.enclosure.url && /^image\//i.test(item.enclosure.type || 'image/')) {
    return String(item.enclosure.url);
  }

  const img = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (img) return img[1];
  const bare = html.match(/https?:\/\/i\.pinimg\.com\/[^\s"'<>)]+\.(?:jpe?g|png|webp)/i);
  return bare ? bare[0] : '';
}

/** The pin's own Pinterest URL, for the pin_urls audit trail. */
function extractPinUrl(item) {
  const cands = [
    item.guid && (item.guid._ || item.guid.value || item.guid),
    item.link,
    item.id,
  ].filter((v) => typeof v === 'string');
  for (const c of cands) {
    const m = c.match(/https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.[a-z.]+\/pin\/\d+/i);
    if (m) return m[0];
  }
  const html = [item.description, item.content, item['content:encoded']]
    .filter(Boolean).join(' ');
  const m = html.match(/https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.[a-z.]+\/pin\/\d+/i);
  return m ? m[0] : '';
}

// ------------------------------------------------------------------- public

function parsePin(item, opts = {}) {
  const pin_url = extractPinUrl(item);
  const etsy = extractEtsy(item);
  if (!etsy) {
    return { ok: false, reason: 'no_etsy_link', pin_url,
             title: cleanText(item.title).slice(0, 120) };
  }
  const rawImage = extractImage(item);
  const cands = imageCandidates(rawImage);
  const title = cleanText(item.title);
  const description = cleanText(
    item.description || item.content || item['content:encoded'] || item.summary || ''
  );
  if (!cands.length) {
    return { ok: false, reason: 'no_image', pin_url, title,
             etsy_listing_id: etsy.etsy_listing_id };
  }
  return {
    ok: true,
    etsy_listing_id: etsy.etsy_listing_id,
    etsy_url: etsy.etsy_url,
    title,
    description,
    image_url: cands[0],          // provisional; HEAD-verified downstream
    image_candidates: cands,
    pin_url,
    board_slug: opts.board_slug || '',
  };
}

/**
 * Pin page -> destination (Etsy) URL.
 *
 * Pinterest's board RSS does not publish a pin's outbound link (verified
 * against a real board: 26/26 pins had no destination URL anywhere in the
 * feed). The link only exists on the pin page itself, inside the embedded
 * JSON blob Pinterest ships for client-side hydration.
 *
 * Part of the Pinterest source layer. Everything here disappears if the
 * source is later swapped for the Etsy API.
 */

// ETSY_LISTING_RE is provided by the inlined pin-parser above.

/** Pin id from any pinterest pin URL form. */
function pinId(url) {
  const m = String(url || '').match(/\/pin\/(\d+)/);
  return m ? m[1] : '';
}

/**
 * Pinterest ships the pin's outbound URL under several JSON keys depending on
 * which renderer served the page. Ordered most- to least-specific; the first
 * that yields an Etsy listing wins.
 */
const JSON_LINK_KEYS = [
  'link',            // canonical destination on the Pin object
  'tracked_link',    // click-tracking wrapper, still contains the target
  'domain_url',
  'seo_canonical_url',
];

/**
 * Extract every plausible destination URL from a pin page's HTML.
 * Returns them in confidence order; callers pick the first Etsy listing.
 *
 * Works on the raw HTML string - no DOM, no browser. JSON string values are
 * escaped (\/), so unescape before matching.
 */
function destinationCandidates(html) {
  const s = String(html || '');
  const out = [];
  const push = (v) => {
    if (!v) return;
    const u = String(v).replace(/\\u002F/gi, '/').replace(/\\\//g, '/').trim();
    if (/^https?:\/\//i.test(u)) out.push(u);
  };

  // 1. Explicit JSON keys, e.g.  "link":"https:\/\/www.etsy.com\/listing\/123"
  for (const key of JSON_LINK_KEYS) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'gi');
    for (const m of s.matchAll(re)) push(m[1]);
  }

  // 2. og:see_also / canonical-style meta tags sometimes carry the target.
  for (const m of s.matchAll(
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:see_also|pinterest:link)["'][^>]+content\s*=\s*["']([^"']+)["']/gi
  )) push(m[1]);

  // 3. Last resort: any Etsy listing URL anywhere in the document, including
  //    inside escaped JSON. This is what actually survives Pinterest's
  //    frequent renderer changes.
  for (const m of s.matchAll(/https?:(?:\\u002F|\\\/|\/){2}(?:[a-z0-9-]+\.)?etsy\.com(?:\\u002F|\\\/|\/)[^"'\s<>\\]*(?:(?:\\u002F|\\\/|\/)[^"'\s<>\\]*)*/gi)) {
    push(m[0]);
  }

  const seen = new Set();
  return out.filter((u) => !seen.has(u) && seen.add(u));
}

/**
 * Resolve a pin page's HTML to an Etsy listing.
 * @returns {{ok:true, etsy_listing_id, etsy_url}|{ok:false, reason, diagnostics}}
 */
function resolveEtsyFromHtml(html, opts = {}) {
  const s = String(html || '');
  const diagnostics = diagnose(s);

  for (const cand of destinationCandidates(s)) {
    const m = cand.match(ETSY_LISTING_RE);
    if (m) {
      return {
        ok: true,
        etsy_listing_id: m[1],
        etsy_url: `https://www.etsy.com/listing/${m[1]}`,
        matched_from: cand.slice(0, 200),
      };
    }
  }

  // A non-Etsy destination is a legitimate outcome (pin points elsewhere),
  // and must be distinguished from "Pinterest blocked us".
  const anyDest = destinationCandidates(s).find((u) => !/pinterest\.|pinimg\./i.test(u));
  return {
    ok: false,
    reason: diagnostics.looks_blocked ? 'blocked_or_login_wall'
      : anyDest ? 'destination_not_etsy'
      : 'no_destination_found',
    sample_destination: anyDest ? anyDest.slice(0, 200) : '',
    diagnostics,
    pin_url: opts.pin_url || '',
  };
}

/** Cheap signals for telling a real pin page from a bot wall. */
function diagnose(html) {
  const s = String(html || '');
  return {
    html_bytes: s.length,
    has_pws_data: /__PWS_(?:DATA|INITIAL_PROPS)__/.test(s),
    has_pin_json: /"pin"\s*:\s*\{|"objectType"\s*:\s*"pin"/i.test(s),
    mentions_etsy: /etsy\.com/i.test(s),
    looks_blocked:
      s.length < 20000
      || /captcha|are you a robot|unusual traffic/i.test(s)
      || (/log ?in to (?:see|continue)/i.test(s) && !/__PWS_/.test(s)),
  };
}

// ---------------------------------------------------------------- n8n glue
// Generated by scripts/build-code-nodes.js from src/pin-parser.js and
// src/pin-resolver.js - do not edit here. Mode: Run Once for All Items.

const results = [];

for (const item of $input.all()) {
  const j = item.json || {};
  const pin_url = $('Pins To Resolve').all()
    .map((i) => i.json.pin_url)[item.pairedItem?.item ?? results.length] || j.pin_url || '';

  // HTTP Request with responseFormat=text puts the body in .data. neverError
  // keeps non-2xx responses flowing so we can report the status.
  const html = typeof j.data === 'string' ? j.data
    : typeof j.body === 'string' ? j.body : '';
  const status = j.statusCode ?? j.status ?? null;

  if (!html) {
    results.push({ json: {
      ok: false, pin_url, reason: 'empty_response', http_status: status,
      note: 'No HTML came back. A 403/429 here means Pinterest blocked the '
          + 'n8n server for unauthenticated page fetches.',
      raw_keys: Object.keys(j).slice(0, 15),
    } });
    continue;
  }

  const r = resolveEtsyFromHtml(html, { pin_url });
  results.push({ json: { pin_url, http_status: status, ...r } });
}

// Leading summary item so the probe is readable at a glance.
const okCount = results.filter((r) => r.json.ok).length;
results.unshift({ json: {
  _summary: true,
  pins_tried: results.length,
  resolved_to_etsy: okCount,
  verdict: okCount > 0
    ? 'RESOLVER WORKS - pin pages expose the Etsy link; Workflow A can use this.'
    : 'RESOLVER FAILED - see reasons below before building Workflow A.',
  reasons: results.reduce((a, r) => {
    const k = r.json.ok ? 'resolved' : (r.json.reason || 'unknown');
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {}),
} });

return results;
