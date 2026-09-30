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

const { ETSY_LISTING_RE } = require('./pin-parser.js');

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

module.exports = { pinId, destinationCandidates, resolveEtsyFromHtml, diagnose };
