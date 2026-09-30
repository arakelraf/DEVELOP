/**
 * Board input normalization: turn whatever the user types into a username,
 * a board slug and an RSS URL.
 *
 * Used by the feed probe and by Workflow D's "add board" form, so a board
 * added through the UI and a board tested by hand always produce the same
 * rss_url. Part of the Pinterest source layer.
 *
 * The forms accept sloppy input on purpose - a pasted board URL, a profile
 * URL, an @handle, a display name - because the user fills them in by hand.
 */

const PINTEREST_HOST_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.[a-z.]+\//i;

/** "@SmartlyDigit", "pinterest.com/smartlydigit/", "SmartlyDigit" -> "smartlydigit" */
function normalizeUsername(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (PINTEREST_HOST_RE.test(s)) {
    const m = s.replace(PINTEREST_HOST_RE, '').split(/[/?#]/).filter(Boolean);
    s = m[0] || '';
  }
  s = s.replace(/^@/, '').trim().toLowerCase();
  // Pinterest usernames: letters, digits, underscore; no spaces.
  s = s.replace(/[^a-z0-9_]/g, '');
  return s;
}

/** "Printable Wall Art!" -> "printable-wall-art"; already-slug passes through. */
function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Pull username and/or slug out of a pasted Pinterest URL.
 * Returns {} when the string is not a Pinterest URL.
 */
function fromPinterestUrl(input) {
  const s = String(input || '').trim();
  if (!PINTEREST_HOST_RE.test(s)) return {};
  const parts = s.replace(PINTEREST_HOST_RE, '').split(/[?#]/)[0]
    .split('/').filter(Boolean);
  if (!parts.length) return {};
  const out = { username: normalizeUsername(parts[0]) };
  if (parts[1]) {
    // Tolerate a pasted ".../board.rss" too.
    out.board_slug = slugify(parts[1].replace(/\.rss$/i, ''));
  }
  // /pin/12345/ is a pin, not a board - do not mistake it for a slug.
  if (out.board_slug === 'pin' || /^\d+$/.test(out.board_slug || '')) {
    delete out.board_slug;
  }
  return out;
}

/**
 * Resolve the two form fields into a board definition.
 *
 * Either field may carry a full URL; a URL in the board field wins, because
 * that is what a user pasting a board link expects.
 *
 * @returns {{ok:true, username, board_slug, rss_url}|{ok:false, error}}
 */
function resolveBoard(usernameInput, boardInput) {
  const fromBoard = fromPinterestUrl(boardInput);
  const fromUser = fromPinterestUrl(usernameInput);

  const username = fromBoard.username
    || fromUser.username
    || normalizeUsername(usernameInput);

  const board_slug = fromBoard.board_slug
    || (fromBoard.username ? '' : slugify(boardInput))
    || fromUser.board_slug
    || '';

  if (!username) {
    return { ok: false, error:
      'Could not read a Pinterest username. Enter it as it appears in your '
      + 'profile URL (pinterest.com/USERNAME), or paste the profile URL.' };
  }
  if (!board_slug) {
    return { ok: false, error:
      'Could not read a board slug. Enter the last part of the board URL '
      + '(pinterest.com/username/BOARD-SLUG), or paste the board URL.' };
  }
  return { ok: true, username, board_slug, rss_url: buildRssUrl(username, board_slug) };
}

function buildRssUrl(username, board_slug) {
  return `https://www.pinterest.com/${username}/${board_slug}.rss`;
}

module.exports = {
  normalizeUsername, slugify, fromPinterestUrl, resolveBoard, buildRssUrl,
};
