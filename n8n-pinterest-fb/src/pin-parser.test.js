/**
 * Unit tests for the Pinterest -> Etsy extraction layer.
 * Run: node src/pin-parser.test.js      (no dependencies, no network)
 *
 * The samples mirror the shapes Pinterest board RSS actually emits: the Etsy
 * URL sometimes in <link>, sometimes only inside the description HTML,
 * sometimes behind Pinterest's outbound redirector.
 */
const assert = require('assert');
const P = require('./pin-parser.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// --- sample A: Etsy URL in <link>, tracking params, thumb image in description
const sampleA = {
  title: 'Printable Wall Art Set &amp; Boho Decor &#8212; Instant Download',
  link: 'https://www.etsy.com/listing/1234567890/printable-wall-art-set-boho?utm_source=Pinterest&utm_medium=PageTools&utm_campaign=Share',
  guid: 'https://www.pinterest.com/pin/987654321098765432/',
  description: '<a href="https://www.pinterest.com/pin/987654321098765432/"><img src="https://i.pinimg.com/236x/ab/cd/ef/abcdef1234567890.jpg"></a> Set of 3 boho printables for your living room. This Pin was discovered by SmartlyDigit. Discover (and save!) your own Pins on Pinterest.',
  pubDate: 'Mon, 29 Sep 2026 11:02:00 GMT',
};

// --- sample B: <link> is the PIN url; Etsy only inside description href
const sampleB = {
  title: 'Minimalist Resume Template',
  link: 'https://www.pinterest.com/pin/111122223333444455/',
  guid: 'https://www.pinterest.com/pin/111122223333444455/',
  'content:encoded': '<img src="https://i.pinimg.com/564x/11/22/33/112233aabbcc.jpg"/><p>Clean one-page CV.</p><p>Find this Pin and more on Templates by SmartlyDigit.</p><a href="https://etsy.com/il-en/listing/998877665/minimalist-resume-template-word">Buy now</a>',
};

// --- sample C: behind Pinterest's outbound redirector
const sampleC = {
  title: 'Digital Planner 2026',
  link: 'https://www.pinterest.com/pin/555566667777888899/',
  description: '<img src="https://i.pinimg.com/736x/aa/bb/cc/aabbccddeeff0011.jpg"> <a href="https://out.pinterest.com/url?url=https%3A%2F%2Fwww.etsy.com%2Flisting%2F5544332211%2Fdigital-planner-2026-goodnotes&e=x">source</a>',
};

// --- sample D: a pin with NO Etsy link at all (must be rejected, not crash)
const sampleD = {
  title: 'Just an inspiration pin',
  link: 'https://www.pinterest.com/pin/1212121212/',
  description: '<img src="https://i.pinimg.com/236x/zz/zz/zz/zzzz.jpg"> Some quote I liked. https://someblog.example.com/post',
};

// --- sample E: Etsy link present, but no image anywhere
const sampleE = {
  title: 'No image pin',
  link: 'https://www.etsy.com/listing/777000111/thing',
  description: 'text only, no img tag',
};

console.log('\nextractEtsy / normalization');
t('A: reads Etsy id from <link> and strips tracking params', () => {
  const r = P.parsePin(sampleA, { board_slug: 'wall-art' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etsy_listing_id, '1234567890');
  assert.strictEqual(r.etsy_url, 'https://www.etsy.com/listing/1234567890');
});
t('B: falls back to an href inside description HTML, locale prefix ok', () => {
  const r = P.parsePin(sampleB);
  assert.strictEqual(r.etsy_listing_id, '998877665');
  assert.strictEqual(r.etsy_url, 'https://www.etsy.com/listing/998877665');
});
t('C: unwraps the out.pinterest.com redirector', () => {
  const r = P.parsePin(sampleC);
  assert.strictEqual(r.etsy_listing_id, '5544332211');
});
t('D: a pin with no Etsy link is rejected with a reason, not an exception', () => {
  const r = P.parsePin(sampleD);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_etsy_link');
  assert.strictEqual(r.pin_url, 'https://www.pinterest.com/pin/1212121212');
});
t('E: Etsy link but no image is rejected as no_image', () => {
  const r = P.parsePin(sampleE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_image');
});
t('non-listing Etsy URLs are not accepted', () => {
  assert.strictEqual(P.extractEtsy({ link: 'https://www.etsy.com/shop/SmartlyDigit' }), null);
  assert.strictEqual(P.extractEtsy({ link: 'https://www.etsy.com/search?q=planner' }), null);
});
t('a 5-digit id is too short to be an Etsy listing', () => {
  assert.strictEqual(P.extractEtsy({ link: 'https://www.etsy.com/listing/12345' }), null);
});

console.log('\ncleanText');
t('decodes entities and strips tags', () => {
  const r = P.parsePin(sampleA);
  assert.ok(r.title.includes('&'), 'amp decoded: ' + r.title);
  assert.ok(r.title.includes('—'), 'mdash decoded: ' + r.title);
  assert.ok(!/</.test(r.title));
});
t('removes Pinterest boilerplate from the description', () => {
  const r = P.parsePin(sampleA);
  assert.ok(!/discovered by/i.test(r.description), 'boilerplate left: ' + r.description);
  assert.ok(!/save!/i.test(r.description), 'boilerplate left: ' + r.description);
  assert.ok(r.description.includes('Set of 3 boho printables'), 'real text lost: ' + r.description);
});
t('removes "Find this Pin and more on X by Y"', () => {
  const r = P.parsePin(sampleB);
  assert.ok(!/find this pin/i.test(r.description), r.description);
  assert.ok(r.description.includes('Clean one-page CV'), r.description);
});
t('strips bare pinterest/etsy URLs out of the body text', () => {
  const r = P.parsePin(sampleC);
  assert.ok(!/etsy\.com/i.test(r.description), r.description);
});
t('keeps a non-Pinterest URL in body text (not our business to strip)', () => {
  // parsePin intentionally omits description for rejected pins, so assert on
  // the cleaner directly.
  const out = P.cleanText(sampleD.description);
  assert.ok(/someblog\.example\.com/.test(out), out);
});
t('rejected pins carry no description field (contract)', () => {
  const r = P.parsePin(sampleD);
  assert.strictEqual(r.description, undefined);
});
t('handles null/undefined without throwing', () => {
  assert.strictEqual(P.cleanText(null), '');
  assert.strictEqual(P.cleanText(undefined), '');
  const r = P.parsePin({});
  assert.strictEqual(r.ok, false);
});

console.log('\nimageCandidates (resolution upgrade)');
t('236x thumb is upgraded to /originals/ first', () => {
  const c = P.imageCandidates('https://i.pinimg.com/236x/ab/cd/ef/abcdef1234567890.jpg');
  assert.strictEqual(c[0], 'https://i.pinimg.com/originals/ab/cd/ef/abcdef1234567890.jpg');
});
t('a .png variant of /originals/ is also offered', () => {
  const c = P.imageCandidates('https://i.pinimg.com/236x/ab/cd/ef/x.jpg');
  assert.ok(c.includes('https://i.pinimg.com/originals/ab/cd/ef/x.png'), c.join('\n'));
});
t('736x is in the fallback chain below originals', () => {
  const c = P.imageCandidates('https://i.pinimg.com/236x/ab/cd/ef/x.jpg');
  const io = c.indexOf('https://i.pinimg.com/originals/ab/cd/ef/x.jpg');
  const i7 = c.indexOf('https://i.pinimg.com/736x/ab/cd/ef/x.jpg');
  assert.ok(io >= 0 && i7 > io, 'order wrong: ' + c.join(', '));
});
t('the original URL is always retained as last resort', () => {
  const src = 'https://i.pinimg.com/236x/ab/cd/ef/x.jpg';
  assert.ok(P.imageCandidates(src).includes(src));
});
t('a non-pinimg image URL is passed through untouched', () => {
  const c = P.imageCandidates('https://cdn.example.com/photo.jpg');
  assert.deepStrictEqual(c, ['https://cdn.example.com/photo.jpg']);
});
t('no duplicates in the candidate list', () => {
  const c = P.imageCandidates('https://i.pinimg.com/originals/ab/cd/ef/x.jpg');
  assert.strictEqual(new Set(c).size, c.length, c.join(', '));
});
t('empty image input yields no candidates', () => {
  assert.deepStrictEqual(P.imageCandidates(''), []);
});

console.log('\npin_url audit trail');
t('pin url is taken from guid when link points at Etsy', () => {
  const r = P.parsePin(sampleA);
  assert.strictEqual(r.pin_url, 'https://www.pinterest.com/pin/987654321098765432');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
