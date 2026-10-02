/**
 * Facebook caption assembly. Pure function, no n8n.
 *
 * Shaped by what the real feed contains: Pinterest puts the pin description
 * into BOTH <title> and <description>, so the two fields are usually the same
 * 600+ character block. Naively concatenating them prints everything twice.
 *
 * Modes:
 *   pinterest - use the pin's own text (default; no AI, no API key)
 *   template  - title + link only, for when the description is noise
 *   ai        - reserved: Workflow B routes to the Anthropic node instead and
 *               falls back here if that node fails
 */

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/** Compare texts ignoring case, punctuation and whitespace. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Cut to a length, preferring a sentence end, then a word end.
 * Returns the text unchanged when it already fits.
 */
function truncate(text, maxChars) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;

  const window = s.slice(0, maxChars);

  // Prefer ending on a sentence. The threshold trades budget for readability:
  // a caption that stops on a full stop reads better than one breaking
  // mid-thought with an ellipsis, so we accept losing part of the window.
  const sentence = Math.max(
    window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '),
    window.lastIndexOf('.\n'), window.lastIndexOf('… ')
  );
  if (sentence >= maxChars * 0.35) return window.slice(0, sentence + 1).trim();

  const word = window.lastIndexOf(' ');
  const cut = word >= maxChars * 0.5 ? window.slice(0, word) : window;
  return cut.replace(/[\s,;:.\-–—]+$/, '').trim() + '…';
}

/**
 * @returns {{post_text:string, text_mode:string, hashtags:string[], truncated:boolean}}
 */
function buildPostText({
  title = '',
  description = '',
  etsy_url = '',
  extraHashtags = '',
  maxChars = 600,
  mode = 'pinterest',
  maxHashtags = 5,
  // When true, the Etsy link is NOT put in the caption body - it is returned
  // separately as comment_text, to be posted as the first comment. Facebook
  // throttles posts with outbound links in the body, so moving the link to a
  // comment materially improves reach.
  linkInComment = false,
  // A short call-to-action appended to the body. Kept generic and brief on
  // purpose: a fabricated per-post "hook" across 6 posts/day would read as
  // botty. The pin's own first sentence is already benefit-led, so it serves
  // as the hook; this only nudges follow + points at the comment link.
  ctaFooter = '',
} = {}) {
  const t = String(title || '').trim();
  const d = String(description || '').trim();

  // --- pick the body ------------------------------------------------------
  let body;
  if (mode === 'template') {
    body = t || d;
  } else {
    const nt = norm(t);
    const nd = norm(d);
    if (!nt) body = d;
    else if (!nd) body = t;
    else if (nt === nd) body = t.length >= d.length ? t : d;
    // One field is a prefix/subset of the other (Pinterest truncates <title>).
    else if (nd.includes(nt)) body = d;
    else if (nt.includes(nd)) body = t;
    // Genuinely different text: title first, then description.
    else body = `${t}\n\n${d}`;
  }

  body = String(body || '').replace(/\n{3,}/g, '\n\n').trim();

  // --- hashtags -----------------------------------------------------------
  // Tags already inside the text are kept where they are only if the text is
  // short; otherwise they are collected and moved to the end, which is how
  // they read on Facebook.
  const found = [...new Set((body.match(HASHTAG_RE) || []).map((h) => h.toLowerCase()))];
  const extras = [...new Set(
    String(extraHashtags || '').split(/[\s,]+/)
      .map((h) => h.trim().toLowerCase())
      .filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h))
  )];

  let hashtags = found.slice(0, maxHashtags);
  if (hashtags.length < maxHashtags) {
    for (const e of extras) {
      if (hashtags.length >= maxHashtags) break;
      if (!hashtags.includes(e)) hashtags.push(e);
    }
  }

  // Strip inline tags from the body when they are being restated at the end,
  // so the same tag does not appear twice.
  let cleanBody = body;
  if (found.length) {
    cleanBody = body.replace(HASHTAG_RE, ' ').replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,!?])/g, '$1').replace(/\n[ \t]+/g, '\n').trim();
  }

  const beforeTruncate = cleanBody;
  cleanBody = truncate(cleanBody, maxChars);
  const truncated = cleanBody !== beforeTruncate;

  // --- assemble -----------------------------------------------------------
  const parts = [];
  if (cleanBody) parts.push(cleanBody);
  const cta = String(ctaFooter || '').trim();
  if (cta) parts.push(cta);
  if (hashtags.length) parts.push(hashtags.join(' '));
  // Link placement: in the body (legacy) or held back for the first comment.
  if (etsy_url && !linkInComment) parts.push(etsy_url);

  return {
    post_text: parts.join('\n\n'),
    comment_text: (linkInComment && etsy_url) ? String(etsy_url) : '',
    text_mode: mode,
    hashtags,
    truncated,
  };
}

module.exports = { buildPostText, truncate, norm };
