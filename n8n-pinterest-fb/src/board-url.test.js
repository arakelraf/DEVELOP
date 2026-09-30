const assert = require('assert');
const B = require('./board-url.js');
let pass = 0, fail = 0;
function t(n, f) { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } }

console.log('\nnormalizeUsername');
t('plain username, lowercased', () => assert.strictEqual(B.normalizeUsername('SmartlyDigit'), 'smartlydigit'));
t('@handle', () => assert.strictEqual(B.normalizeUsername('@SmartlyDigit'), 'smartlydigit'));
t('profile URL', () => assert.strictEqual(B.normalizeUsername('https://www.pinterest.com/smartlydigit/'), 'smartlydigit'));
t('regional domain', () => assert.strictEqual(B.normalizeUsername('https://pinterest.co.uk/smartlydigit'), 'smartlydigit'));
t('stray whitespace and spaces removed', () => assert.strictEqual(B.normalizeUsername('  smartly digit '), 'smartlydigit'));
t('empty input', () => assert.strictEqual(B.normalizeUsername(''), ''));
t('null input', () => assert.strictEqual(B.normalizeUsername(null), ''));

console.log('\nslugify');
t('display name to slug', () => assert.strictEqual(B.slugify('Printable Wall Art!'), 'printable-wall-art'));
t('ampersand becomes and', () => assert.strictEqual(B.slugify('Home & Decor'), 'home-and-decor'));
t('apostrophes dropped', () => assert.strictEqual(B.slugify("Mother's Day"), 'mothers-day'));
t('already a slug is unchanged', () => assert.strictEqual(B.slugify('digital-planners'), 'digital-planners'));
t('no leading/trailing dashes', () => assert.strictEqual(B.slugify('  --wall art--  '), 'wall-art'));

console.log('\nresolveBoard');
t('username + slug', () => {
  const r = B.resolveBoard('smartlydigit', 'printable-wall-art');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rss_url, 'https://www.pinterest.com/smartlydigit/printable-wall-art.rss');
});
t('username + display name gets slugified', () => {
  const r = B.resolveBoard('SmartlyDigit', 'Printable Wall Art');
  assert.strictEqual(r.rss_url, 'https://www.pinterest.com/smartlydigit/printable-wall-art.rss');
});
t('a pasted board URL in the board field supplies both parts', () => {
  const r = B.resolveBoard('', 'https://www.pinterest.com/smartlydigit/digital-planners/');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.username, 'smartlydigit');
  assert.strictEqual(r.board_slug, 'digital-planners');
});
t('a pasted board URL wins over a different typed username', () => {
  const r = B.resolveBoard('someoneelse', 'https://www.pinterest.com/smartlydigit/planners/');
  assert.strictEqual(r.username, 'smartlydigit');
});
t('a pasted .rss URL is accepted', () => {
  const r = B.resolveBoard('', 'https://www.pinterest.com/smartlydigit/planners.rss');
  assert.strictEqual(r.board_slug, 'planners');
  assert.strictEqual(r.rss_url, 'https://www.pinterest.com/smartlydigit/planners.rss');
});
t('missing username is a clear error, not a broken URL', () => {
  const r = B.resolveBoard('', 'planners');
  assert.strictEqual(r.ok, false);
  assert.ok(/username/i.test(r.error));
});
t('missing board is a clear error', () => {
  const r = B.resolveBoard('smartlydigit', '');
  assert.strictEqual(r.ok, false);
  assert.ok(/board slug/i.test(r.error));
});
t('a pasted PIN url is not mistaken for a board', () => {
  const r = B.resolveBoard('', 'https://www.pinterest.com/smartlydigit/pin/12345/');
  assert.strictEqual(r.ok, false, 'should not invent a board from a pin URL');
});
t('profile URL in the username field still needs a board', () => {
  const r = B.resolveBoard('https://www.pinterest.com/smartlydigit/', '');
  assert.strictEqual(r.ok, false);
});
t('profile URL in username field + typed board works', () => {
  const r = B.resolveBoard('https://www.pinterest.com/smartlydigit/', 'Wall Art');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rss_url, 'https://www.pinterest.com/smartlydigit/wall-art.rss');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
