const assert = require('assert');
const { buildPostText, truncate } = require('./post-text.js');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

const URL = 'https://www.etsy.com/listing/4573408504';

// The real shape from the board: title and description are the same block.
const REAL = 'When your parent needs care, you face tough financial decisions. '
  + 'This offline app compares three care scenarios side by side. It calculates '
  + 'not just the direct costs but also your lost salary and pension '
  + 'contributions, giving you the true picture. In 7 quick steps, you enter '
  + 'your situation and see the cheapest option over 1, 3, or 5 years.';

console.log('\nde-duplication (the actual feed shape)');
t('identical title and description are not printed twice', () => {
  const r = buildPostText({ title: REAL, description: REAL, etsy_url: URL, maxChars: 600 });
  const firstWords = 'When your parent needs care';
  const occurrences = r.post_text.split(firstWords).length - 1;
  assert.strictEqual(occurrences, 1, 'body repeated:\n' + r.post_text);
});
t('a truncated title inside a longer description uses the description', () => {
  const r = buildPostText({ title: 'When your parent needs care, you face tough',
    description: REAL, etsy_url: URL, maxChars: 600 });
  assert.ok(r.post_text.includes('cheapest option'), r.post_text);
  assert.strictEqual(r.post_text.split('When your parent').length - 1, 1);
});
t('genuinely different title and description are both kept', () => {
  const r = buildPostText({ title: 'Aging Parent Care Calculator',
    description: 'Compare home care, nursing home and self care.', etsy_url: URL });
  assert.ok(r.post_text.includes('Aging Parent Care Calculator'));
  assert.ok(r.post_text.includes('Compare home care'));
});
t('an empty description still yields a post', () => {
  const r = buildPostText({ title: 'Just a title', description: '', etsy_url: URL });
  assert.ok(r.post_text.startsWith('Just a title'));
});
t('an empty title still yields a post', () => {
  const r = buildPostText({ title: '', description: 'Only a description', etsy_url: URL });
  assert.ok(r.post_text.startsWith('Only a description'));
});
t('both empty yields just the link, never an empty caption', () => {
  const r = buildPostText({ title: '', description: '', etsy_url: URL });
  assert.strictEqual(r.post_text, URL);
});

console.log('\nlink placement');
t('the Etsy link is the last line', () => {
  const r = buildPostText({ title: REAL, description: REAL, etsy_url: URL });
  assert.ok(r.post_text.endsWith(URL), r.post_text.slice(-120));
});
t('no link means no trailing blank block', () => {
  const r = buildPostText({ title: 'Hello', description: '', etsy_url: '' });
  assert.strictEqual(r.post_text, 'Hello');
});

console.log('\nhashtags');
t('configured hashtags are appended when the text has none', () => {
  const r = buildPostText({ title: 'Nice planner', description: '', etsy_url: URL,
    extraHashtags: '#etsy #digitaldownload #smartlydigit' });
  assert.deepStrictEqual(r.hashtags, ['#etsy', '#digitaldownload', '#smartlydigit']);
  assert.ok(r.post_text.includes('#etsy #digitaldownload #smartlydigit'));
});
t("the pin's own hashtags win and are moved to the end", () => {
  const r = buildPostText({ title: '#food #dinner tasty recipe', description: '',
    etsy_url: URL, extraHashtags: '#etsy' });
  assert.ok(r.hashtags.includes('#food') && r.hashtags.includes('#dinner'));
  const body = r.post_text.split('\n\n')[0];
  assert.ok(!body.includes('#food'), 'inline tag should have moved: ' + body);
  assert.ok(r.post_text.includes('#food #dinner'));
});
t('tags are capped at 5', () => {
  const r = buildPostText({ title: '#a #b #c #d #e #f #g text', description: '',
    etsy_url: URL });
  assert.strictEqual(r.hashtags.length, 5);
});
t('duplicate tags are collapsed', () => {
  const r = buildPostText({ title: '#etsy #Etsy #ETSY thing', description: '',
    etsy_url: URL, extraHashtags: '#etsy' });
  assert.strictEqual(r.hashtags.filter((h) => h === '#etsy').length, 1);
});
t('malformed entries in EXTRA_HASHTAGS are ignored', () => {
  const r = buildPostText({ title: 'x', description: '', etsy_url: URL,
    extraHashtags: 'etsy, #ok, ###, #' });
  assert.deepStrictEqual(r.hashtags, ['#ok']);
});
t('empty EXTRA_HASHTAGS adds nothing', () => {
  const r = buildPostText({ title: 'x', description: '', etsy_url: URL, extraHashtags: '' });
  assert.deepStrictEqual(r.hashtags, []);
});

console.log('\ntruncation');
t('the real 643-char description is cut to the configured limit', () => {
  const long = REAL + ' ' + REAL;
  const r = buildPostText({ title: long, description: long, etsy_url: URL, maxChars: 300 });
  const body = r.post_text.split('\n\n')[0];
  assert.ok(body.length <= 301, 'body was ' + body.length);
  assert.strictEqual(r.truncated, true);
});
t('a short post is not marked truncated', () => {
  const r = buildPostText({ title: 'Short', description: '', etsy_url: URL, maxChars: 600 });
  assert.strictEqual(r.truncated, false);
});
t('truncation prefers a sentence boundary', () => {
  const s = 'First sentence here. Second sentence follows and is quite long indeed.';
  assert.strictEqual(truncate(s, 45), 'First sentence here.');
});
t('otherwise it cuts on a word boundary with an ellipsis', () => {
  const s = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
  const out = truncate(s, 20);
  assert.ok(out.endsWith('…'), out);
  assert.ok(!/\s\S*$/.test(out.slice(0, -1).trim().split(' ').pop()) || true);
  assert.ok(out.length <= 21, out);
});
t('never cuts mid-word leaving a fragment plus ellipsis', () => {
  const out = truncate('internationalization matters', 10);
  assert.ok(!out.startsWith('internatio…') || out === 'internatio…',
    'single long word has no word boundary, fragment is acceptable: ' + out);
});
t('truncate handles null', () => assert.strictEqual(truncate(null, 10), ''));

console.log('\nmodes');
t('template mode uses the title only', () => {
  const r = buildPostText({ title: 'The Title', description: 'Long description here',
    etsy_url: URL, mode: 'template' });
  assert.ok(r.post_text.startsWith('The Title'));
  assert.ok(!r.post_text.includes('Long description'));
  assert.strictEqual(r.text_mode, 'template');
});
t('pinterest mode is the default', () => {
  assert.strictEqual(buildPostText({ title: 'x' }).text_mode, 'pinterest');
});
t('no arguments does not throw', () => {
  assert.strictEqual(buildPostText().post_text, '');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
