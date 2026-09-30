const assert = require('assert');
const P = require('./publisher.js');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

const NOW = Date.parse('2026-03-10T06:00:00Z');
const inMin = (m) => new Date(NOW + m * 60_000).toISOString();

const item = (id, over = {}) => ({
  etsy_listing_id: id,
  etsy_url: 'https://www.etsy.com/listing/' + id,
  image_url: 'https://i.pinimg.com/originals/a/b/c/x.png',
  board_slugs: JSON.stringify(['a']),
  ...over,
});
const row = (over = {}) => ({
  id: 1, etsy_listing_id: '100', board_slug: 'a', status: 'queued',
  scheduled_at: inMin(120), post_text: 'Hello world\n\nhttps://etsy', attempts: 0,
  ...over,
});
const base = { enabledBoards: ['a'], nowMs: NOW, retryDelayMinutes: 30,
  maxAttempts: 2, maxPerRun: 20 };

console.log('\nscheduled vs immediate');
t('a slot two hours out is handed to Facebook as scheduled', () => {
  const r = P.selectForPublish({ ...base, rows: [row()], items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 1);
  assert.strictEqual(r.toPublish[0].mode, 'scheduled');
  assert.strictEqual(r.toPublish[0].scheduled_publish_time,
    Math.floor(Date.parse(inMin(120)) / 1000));
});
t('scheduled_publish_time is whole seconds, not milliseconds', () => {
  const r = P.selectForPublish({ ...base, rows: [row()], items: [item('100')] });
  const ts = r.toPublish[0].scheduled_publish_time;
  assert.ok(Number.isInteger(ts) && ts < 1e11, 'looks like ms: ' + ts);
});
t('a slot 5 minutes out publishes immediately (Facebook needs 10+)', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ scheduled_at: inMin(5) })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish[0].mode, 'immediate');
  assert.strictEqual(r.toPublish[0].scheduled_publish_time, null);
});
t('a slot already in the past publishes immediately, never lost', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ scheduled_at: inMin(-600) })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 1);
  assert.strictEqual(r.toPublish[0].mode, 'immediate');
});
t('exactly 10 minutes out counts as schedulable', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ scheduled_at: inMin(10) })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish[0].mode, 'scheduled');
});
t('a slot beyond the Facebook window is deferred, not failed', () => {
  const r = P.selectForPublish({ ...base,
    rows: [row({ scheduled_at: new Date(NOW + 200 * 86_400_000).toISOString() })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 0);
  assert.strictEqual(r.notYet[0].reason, 'beyond_facebook_scheduling_window');
});

console.log('\nboard re-check at publish time');
t('a listing whose boards were disabled since queueing is skipped', () => {
  const r = P.selectForPublish({ ...base, enabledBoards: [], rows: [row()],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 0);
  assert.strictEqual(r.toSkip[0].status, 'skipped');
  assert.strictEqual(r.toSkip[0].reason, 'all_boards_disabled');
});
t('still published if at least one of several boards is enabled', () => {
  const r = P.selectForPublish({ ...base, enabledBoards: ['b'], rows: [row()],
    items: [item('100', { board_slugs: JSON.stringify(['a', 'b']) })] });
  assert.strictEqual(r.toPublish.length, 1);
});

console.log('\nbad data is failed with a readable reason');
t('a missing items row fails the entry rather than crashing', () => {
  const r = P.selectForPublish({ ...base, rows: [row()], items: [] });
  assert.strictEqual(r.toSkip[0].status, 'failed');
  assert.strictEqual(r.toSkip[0].reason, 'item_row_missing');
  assert.ok(/No items row/.test(r.toSkip[0].error));
});
t('an item with no image is failed, not posted as text', () => {
  const r = P.selectForPublish({ ...base, rows: [row()],
    items: [item('100', { image_url: '' })] });
  assert.strictEqual(r.toSkip[0].reason, 'no_image');
});
t('an empty post_text is failed', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ post_text: '   ' })],
    items: [item('100')] });
  assert.strictEqual(r.toSkip[0].reason, 'no_post_text');
});
t('an unparseable scheduled_at is failed with the offending value', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ scheduled_at: 'soon' })],
    items: [item('100')] });
  assert.strictEqual(r.toSkip[0].reason, 'bad_scheduled_at');
  assert.ok(/soon/.test(r.toSkip[0].error));
});

console.log('\nstatus gating');
t('only queued and failed rows are touched', () => {
  const rows = [
    row({ id: 1, status: 'queued' }),
    row({ id: 2, status: 'posted', etsy_listing_id: '200' }),
    row({ id: 3, status: 'scheduled', etsy_listing_id: '300' }),
    row({ id: 4, status: 'posting', etsy_listing_id: '400' }),
    row({ id: 5, status: 'skipped', etsy_listing_id: '500' }),
  ];
  const r = P.selectForPublish({ ...base, rows,
    items: ['100', '200', '300', '400', '500'].map((i) => item(i)) });
  assert.strictEqual(r.report.actionable_rows, 1);
  assert.strictEqual(r.toPublish[0].row_id, 1);
});
t('a posting row is left alone (another run owns it)', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ status: 'posting' })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 0);
  assert.strictEqual(r.toSkip.length, 0);
});

console.log('\nretry rules');
t('a failed row is retried once the delay has elapsed', () => {
  const r = P.selectForPublish({ ...base,
    rows: [row({ status: 'failed', attempts: 1, last_attempt_at: inMin(-45) })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 1);
  assert.strictEqual(r.toPublish[0].was_retry, true);
  assert.strictEqual(r.toPublish[0].attempts, 2);
});
t('a failed row is NOT retried before the delay, and says how long is left', () => {
  const r = P.selectForPublish({ ...base,
    rows: [row({ status: 'failed', attempts: 1, last_attempt_at: inMin(-10) })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 0);
  assert.strictEqual(r.notYet[0].reason, 'retry_delay_not_elapsed');
  assert.strictEqual(r.notYet[0].minutes_remaining, 20);
});
t('after the attempt limit it is parked, not retried forever', () => {
  const r = P.selectForPublish({ ...base,
    rows: [row({ status: 'failed', attempts: 2, last_attempt_at: inMin(-500) })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 0);
  assert.strictEqual(r.notYet[0].reason, 'retry_limit_reached');
});
t('a failed row with no timestamp at all is retried (fail open, once)', () => {
  const r = P.selectForPublish({ ...base,
    rows: [row({ status: 'failed', attempts: 1, last_attempt_at: null })],
    items: [item('100')] });
  assert.strictEqual(r.toPublish.length, 1);
});

console.log('\nordering and caps');
t('earliest slot first', () => {
  const rows = [
    row({ id: 1, etsy_listing_id: '1', scheduled_at: inMin(300) }),
    row({ id: 2, etsy_listing_id: '2', scheduled_at: inMin(60) }),
    row({ id: 3, etsy_listing_id: '3', scheduled_at: inMin(180) }),
  ];
  const r = P.selectForPublish({ ...base, rows,
    items: ['1', '2', '3'].map((i) => item(i)) });
  assert.deepStrictEqual(r.toPublish.map((p) => p.row_id), [2, 3, 1]);
});
t('maxPerRun caps the batch and defers the rest', () => {
  const rows = [1, 2, 3, 4].map((i) => row({ id: i, etsy_listing_id: String(i),
    scheduled_at: inMin(60 * i) }));
  const r = P.selectForPublish({ ...base, maxPerRun: 2, rows,
    items: ['1', '2', '3', '4'].map((i) => item(i)) });
  assert.strictEqual(r.toPublish.length, 2);
  assert.strictEqual(r.notYet.filter((n) => n.reason === 'max_publish_per_run').length, 2);
});
t('empty input is an empty plan', () => {
  const r = P.selectForPublish({ ...base, rows: [], items: [] });
  assert.strictEqual(r.toPublish.length, 0);
  assert.strictEqual(r.report.actionable_rows, 0);
});

console.log('\nbuildGraphCalls');
t('two-step call: unpublished photo then a scheduled feed post', () => {
  const r = P.selectForPublish({ ...base, rows: [row()], items: [item('100')] });
  const calls = P.buildGraphCalls(r.toPublish[0], { pageId: '123', apiVersion: 'v21.0' });
  assert.strictEqual(calls.photo.url, 'https://graph.facebook.com/v21.0/123/photos');
  assert.strictEqual(calls.photo.body.published, false);
  assert.strictEqual(calls.photo.body.url, 'https://i.pinimg.com/originals/a/b/c/x.png');
  assert.strictEqual(calls.feed.url, 'https://graph.facebook.com/v21.0/123/feed');
  assert.strictEqual(calls.feed.body.published, false);
  assert.ok(calls.feed.body.scheduled_publish_time > 0);
});
t('immediate mode publishes and sends no schedule time', () => {
  const r = P.selectForPublish({ ...base, rows: [row({ scheduled_at: inMin(-5) })],
    items: [item('100')] });
  const calls = P.buildGraphCalls(r.toPublish[0], { pageId: '123' });
  assert.strictEqual(calls.feed.body.published, true);
  assert.strictEqual('scheduled_publish_time' in calls.feed.body, false);
});
t('a missing page id is a clear error, not a malformed URL', () => {
  assert.throws(() => P.buildGraphCalls({}, { pageId: '' }), /FB_PAGE_ID/);
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
