const assert = require('assert');
const R = require('./pin-resolver.js');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

// Pinterest embeds JSON with forward slashes escaped, so the fixtures do too.
const PAD = 'x'.repeat(25000); // clear the looks_blocked size floor

const pageWithEtsy = `<html><head><title>Pin</title></head><body>${PAD}
<script id="__PWS_DATA__">{"props":{"initialReduxState":{"pins":{"1128855462883864894":
{"id":"1128855462883864894","link":"https:\\/\\/www.etsy.com\\/listing\\/4321987650\\/offline-weight-loss-planner?click_key=abc",
"domain":"etsy.com","images":{"orig":{"url":"https:\\/\\/i.pinimg.com\\/originals\\/6c\\/99\\/f2\\/x.jpg"}}}}}}}
</script></body></html>`;

const pageUnicodeEscaped = `<html><body>${PAD}
<script>{"link":"https:\\u002F\\u002Fwww.etsy.com\\u002Flisting\\u002F5550001112\\u002Fthing"}</script>
</body></html>`;

const pageTrackedLink = `<html><body>${PAD}<script id="__PWS_DATA__">
{"pin":{"tracked_link":"https:\\/\\/www.etsy.com\\/listing\\/9998887770\\/planner?utm_source=pinterest"}}
</script></body></html>`;

const pageMetaOnly = `<html><head>${PAD}
<meta property="og:see_also" content="https://www.etsy.com/listing/1231231234/wall-art" />
</head><body></body></html>`;

const pageNonEtsyDest = `<html><body>${PAD}<script id="__PWS_DATA__">
{"pin":{"link":"https:\\/\\/someblog.example.com\\/article","objectType":"pin"}}
</script></body></html>`;

const pageBlocked = `<html><body><h1>Log in to see more</h1><p>captcha</p></body></html>`;

const pageNoDest = `<html><body>${PAD}<script id="__PWS_DATA__">
{"pin":{"id":"123","objectType":"pin","images":{}}}</script></body></html>`;

console.log('\npinId');
t('extracts id from a pin URL', () => assert.strictEqual(R.pinId('https://www.pinterest.com/pin/1128855462883864894/'), '1128855462883864894'));
t('extracts id without trailing slash', () => assert.strictEqual(R.pinId('https://pinterest.com/pin/999'), '999'));
t('empty for a non-pin URL', () => assert.strictEqual(R.pinId('https://www.pinterest.com/user/board'), ''));

console.log('\nresolveEtsyFromHtml - success paths');
t('reads the escaped "link" key and strips click_key', () => {
  const r = R.resolveEtsyFromHtml(pageWithEtsy);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etsy_listing_id, '4321987650');
  assert.strictEqual(r.etsy_url, 'https://www.etsy.com/listing/4321987650');
});
t('handles \\u002F unicode-escaped slashes', () => {
  const r = R.resolveEtsyFromHtml(pageUnicodeEscaped);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etsy_listing_id, '5550001112');
});
t('falls back to tracked_link', () => {
  const r = R.resolveEtsyFromHtml(pageTrackedLink);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etsy_listing_id, '9998887770');
});
t('falls back to og:see_also meta', () => {
  const r = R.resolveEtsyFromHtml(pageMetaOnly);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etsy_listing_id, '1231231234');
});

console.log('\nresolveEtsyFromHtml - failure paths are distinguishable');
t('a non-Etsy destination is reported as such, with a sample', () => {
  const r = R.resolveEtsyFromHtml(pageNonEtsyDest);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'destination_not_etsy');
  assert.ok(/someblog/.test(r.sample_destination), r.sample_destination);
});
t('a bot wall is reported as blocked, NOT as "no link"', () => {
  const r = R.resolveEtsyFromHtml(pageBlocked);
  assert.strictEqual(r.reason, 'blocked_or_login_wall');
});
t('a real page with no destination is no_destination_found', () => {
  const r = R.resolveEtsyFromHtml(pageNoDest);
  assert.strictEqual(r.reason, 'no_destination_found');
});
t('empty html does not throw', () => {
  assert.strictEqual(R.resolveEtsyFromHtml('').ok, false);
  assert.strictEqual(R.resolveEtsyFromHtml(null).ok, false);
});

console.log('\ndiagnose');
t('detects the PWS data blob', () => assert.strictEqual(R.diagnose(pageWithEtsy).has_pws_data, true));
t('flags a small page as blocked', () => assert.strictEqual(R.diagnose(pageBlocked).looks_blocked, true));
t('does not flag a large real page as blocked', () => assert.strictEqual(R.diagnose(pageWithEtsy).looks_blocked, false));
t('reports whether etsy is mentioned at all', () => {
  assert.strictEqual(R.diagnose(pageWithEtsy).mentions_etsy, true);
  assert.strictEqual(R.diagnose(pageNoDest).mentions_etsy, false);
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
