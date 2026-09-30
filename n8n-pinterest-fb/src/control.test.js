const assert = require('assert');
const C = require('./control.js');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

const TZ = 'Europe/Belgrade';
const NOW = Date.parse('2026-10-01T06:00:00Z'); // 08:00 local

const item = (id, over = {}) => ({
  etsy_listing_id: id, etsy_url: 'https://www.etsy.com/listing/' + id,
  title: 'Title ' + id, image_url: 'https://i.pinimg.com/originals/x/' + id + '.png',
  board_slugs: JSON.stringify(['a']), ...over,
});
const row = (over = {}) => ({
  id: 1, etsy_listing_id: '4100000001', board_slug: 'a', status: 'queued',
  scheduled_at: '2026-10-01T08:00:00.000Z', post_text: 'Caption here', attempts: 0,
  ...over,
});

console.log('\nparseListingRef');
t('full Etsy URL with slug and params', () => assert.strictEqual(
  C.parseListingRef('https://www.etsy.com/listing/4573408504/aging-parent?ref=x'), '4573408504'));
t('shop-subdomain URL', () => assert.strictEqual(
  C.parseListingRef('https://smartlydigit.etsy.com/listing/4573408504/thing'), '4573408504'));
t('bare numeric id', () => assert.strictEqual(C.parseListingRef('4573408504'), '4573408504'));
t('garbage returns empty', () => assert.strictEqual(C.parseListingRef('hello'), ''));
t('empty input returns empty', () => assert.strictEqual(C.parseListingRef(''), ''));

console.log('\ntodaysPosts (the no-API path)');
t('lists only entries due on the local day, in time order', () => {
  const rows = [
    row({ id: 1, scheduled_at: '2026-10-01T08:00:00.000Z' }),  // 10:00 local today
    row({ id: 2, etsy_listing_id: '4100000002', scheduled_at: '2026-10-01T17:00:00.000Z' }), // 19:00
    row({ id: 3, etsy_listing_id: '4100000003', scheduled_at: '2026-10-02T08:00:00.000Z' }), // tomorrow
  ];
  const r = C.todaysPosts({ scheduleRows: rows, items: ['4100000001','4100000002','4100000003'].map((i) => item(i)),
    timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.date, '2026-10-01');
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(r.posts.map((p) => p.time), ['10:00', '19:00']);
});
t('carries the caption and the verified image, ready to paste', () => {
  const r = C.todaysPosts({ scheduleRows: [row()], items: [item('4100000001')],
    timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.posts[0].post_text, 'Caption here');
  assert.ok(r.posts[0].image_url.includes('/originals/'));
});
t('flags an entry whose items row vanished', () => {
  const r = C.todaysPosts({ scheduleRows: [row()], items: [], timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.posts[0].missing_item, true);
});
t('posted and failed entries are not listed as due', () => {
  const rows = [row({ id: 1, status: 'posted' }), row({ id: 2, status: 'failed' })];
  const r = C.todaysPosts({ scheduleRows: rows, items: [item('4100000001')], timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.count, 0);
});
t('dayOffset reaches tomorrow', () => {
  const rows = [row({ scheduled_at: '2026-10-02T08:00:00.000Z' })];
  const r = C.todaysPosts({ scheduleRows: rows, items: [item('4100000001')],
    timeZone: TZ, nowMs: NOW, dayOffset: 1 });
  assert.strictEqual(r.date, '2026-10-02');
  assert.strictEqual(r.count, 1);
});
t('a late-evening UTC slot still counts as the right local day', () => {
  // 22:30 UTC on Oct 1 is 00:30 on Oct 2 in Belgrade.
  const rows = [row({ scheduled_at: '2026-10-01T22:30:00.000Z' })];
  const today = C.todaysPosts({ scheduleRows: rows, items: [item('4100000001')],
    timeZone: TZ, nowMs: NOW });
  assert.strictEqual(today.count, 0, 'must not appear on Oct 1 local');
  const tom = C.todaysPosts({ scheduleRows: rows, items: [item('4100000001')],
    timeZone: TZ, nowMs: NOW, dayOffset: 1 });
  assert.strictEqual(tom.count, 1, 'must appear on Oct 2 local');
});

console.log('\nqueueView');
t('groups by local day and respects the window', () => {
  const rows = [
    row({ id: 1, scheduled_at: '2026-10-01T08:00:00.000Z' }),
    row({ id: 2, etsy_listing_id: '4100000002', scheduled_at: '2026-10-02T08:00:00.000Z' }),
    row({ id: 3, etsy_listing_id: '4100000003', scheduled_at: '2026-10-20T08:00:00.000Z' }),
  ];
  const r = C.queueView({ scheduleRows: rows, items: ['4100000001','4100000002','4100000003'].map((i) => item(i)),
    timeZone: TZ, nowMs: NOW, days: 7 });
  assert.strictEqual(r.total, 2, 'the Oct 20 entry is outside 7 days');
  assert.deepStrictEqual(r.by_day.map((d) => d.date), ['2026-10-01', '2026-10-02']);
});
t('includes row ids so entries can be acted on', () => {
  const r = C.queueView({ scheduleRows: [row({ id: 42 })], items: [item('4100000001')],
    timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.by_day[0].entries[0].row_id, 42);
});

console.log('\ncheckListing');
t('already scheduled reports the local time', () => {
  const r = C.checkListing({ ref: '4100000001', scheduleRows: [row()], items: [item('4100000001')],
    timeZone: TZ });
  assert.ok(/already scheduled for/.test(r.verdict), r.verdict);
  assert.ok(/10:00/.test(r.verdict), r.verdict);
});
t('handed to Facebook is called out distinctly', () => {
  const r = C.checkListing({ ref: '4100000001', scheduleRows: [row({ status: 'scheduled' })],
    items: [item('4100000001')], timeZone: TZ });
  assert.ok(/handed to Facebook/.test(r.verdict), r.verdict);
});
t('posted reports the date', () => {
  const r = C.checkListing({ ref: '4100000001',
    scheduleRows: [row({ status: 'posted', posted_at: '2026-09-20T08:00:00Z' })],
    items: [item('4100000001')], timeZone: TZ });
  assert.ok(/^posted on 20\/09\/2026/.test(r.verdict), r.verdict);
});
t('failed reports attempts and the error', () => {
  const r = C.checkListing({ ref: '4100000001',
    scheduleRows: [row({ status: 'failed', attempts: 2, error: 'boom' })],
    items: [item('4100000001')], timeZone: TZ });
  assert.ok(/failed after 2 attempt/.test(r.verdict) && /boom/.test(r.verdict), r.verdict);
});
t('known listing with no row says not scheduled, and offers to queue it', () => {
  const r = C.checkListing({ ref: '4100000001', scheduleRows: [], items: [item('4100000001')] });
  assert.strictEqual(r.verdict, 'not scheduled');
  assert.strictEqual(r.can_queue_now, true);
});
t('unknown listing says the sync has never seen it', () => {
  const r = C.checkListing({ ref: '999999', scheduleRows: [], items: [] });
  assert.ok(/never seen/.test(r.verdict), r.verdict);
  assert.strictEqual(r.can_queue_now, false);
});
t('unreadable input is an error, not a lookup for id ""', () => {
  const r = C.checkListing({ ref: 'nonsense' });
  assert.strictEqual(r.ok, false);
  assert.ok(/Could not read a listing id/.test(r.error));
});
t('the newest row wins when several exist', () => {
  const rows = [row({ id: 1, status: 'posted', posted_at: '2026-01-01T00:00:00Z' }),
                row({ id: 2, status: 'queued' })];
  const r = C.checkListing({ ref: '4100000001', scheduleRows: rows, items: [item('4100000001')],
    timeZone: TZ });
  assert.ok(/already scheduled/.test(r.verdict), r.verdict);
});

console.log('\nboardsView');
t('reports listings and live queue per board, priority first', () => {
  const boards = [
    { board_slug: 'a', name: 'A', enabled: true, priority: 5 },
    { board_slug: 'b', name: 'B', enabled: false, priority: 10 },
  ];
  const items = [item('1'), item('2', { board_slugs: JSON.stringify(['a', 'b']) })];
  const rows = [row({ id: 1, board_slug: 'a' }), row({ id: 2, board_slug: 'a', status: 'posted' })];
  const r = C.boardsView({ boards, items, scheduleRows: rows });
  assert.deepStrictEqual(r.boards.map((x) => x.board_slug), ['b', 'a']);
  const a = r.boards.find((x) => x.board_slug === 'a');
  assert.strictEqual(a.listings, 2);
  assert.strictEqual(a.queued_now, 1, 'the posted row must not count as queued');
});

console.log('\nplanCascade (disable / re-enable)');
t('disabling a board skips queued rows whose listing has no enabled board left', () => {
  const boards = [{ board_slug: 'a', enabled: false }];
  const r = C.planCascade({ boards, items: [item('4100000001')], scheduleRows: [row()] });
  assert.strictEqual(r.summary.to_skip, 1);
  assert.strictEqual(r.updates[0].status, 'skipped');
});
t('a listing also on an enabled board keeps its slot', () => {
  const boards = [{ board_slug: 'a', enabled: false }, { board_slug: 'b', enabled: true }];
  const items = [item('4100000001', { board_slugs: JSON.stringify(['a', 'b']) })];
  const r = C.planCascade({ boards, items, scheduleRows: [row()] });
  assert.strictEqual(r.summary.to_skip, 0);
});
t('re-enabling restores exactly the rows that were skipped', () => {
  const boards = [{ board_slug: 'a', enabled: true }];
  const rows = [row({ status: 'skipped' })];
  const r = C.planCascade({ boards, items: [item('4100000001')], scheduleRows: rows });
  assert.strictEqual(r.summary.to_restore, 1);
  assert.strictEqual(r.updates[0].status, 'queued');
  assert.strictEqual(r.updates[0].error, '');
});
t('posted rows are never touched by the cascade', () => {
  const boards = [{ board_slug: 'a', enabled: false }];
  const r = C.planCascade({ boards, items: [item('4100000001')],
    scheduleRows: [row({ status: 'posted' })] });
  assert.strictEqual(r.updates.length, 0);
});
t('a row whose item is gone is left alone rather than guessed at', () => {
  const boards = [{ board_slug: 'a', enabled: false }];
  const r = C.planCascade({ boards, items: [], scheduleRows: [row()] });
  assert.strictEqual(r.updates.length, 0);
});

console.log('\nplanAddBoard');
t('builds the rss_url and starts disabled', () => {
  const r = C.planAddBoard({ username: 'irobotsvc', board: 'Useful Toolkits' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.rss_url,
    'https://www.pinterest.com/irobotsvc/useful-toolkits.rss');
  assert.strictEqual(r.row.enabled, false);
});
t('a pasted board URL works with no username typed', () => {
  const r = C.planAddBoard({ username: '', board: 'https://www.pinterest.com/x/y/' });
  assert.strictEqual(r.row.rss_url, 'https://www.pinterest.com/x/y.rss');
});
t('a duplicate slug is refused with advice', () => {
  const r = C.planAddBoard({ username: 'u', board: 'b',
    existing: [{ board_slug: 'b' }] });
  assert.strictEqual(r.ok, false);
  assert.ok(/already in the table/.test(r.error));
});
t('unreadable input is refused', () => {
  const r = C.planAddBoard({ username: '', board: '' });
  assert.strictEqual(r.ok, false);
});
t('the name falls back to the slug', () => {
  const r = C.planAddBoard({ username: 'u', board: 'my-board' });
  assert.strictEqual(r.row.name, 'my-board');
});

console.log('\nplanEntryAction');
t('remove a queued entry', () => {
  const r = C.planEntryAction({ action: 'remove', rowId: '1', scheduleRows: [row()] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row_id, 1);
});
t('removing a Facebook-scheduled entry is refused with the real consequence', () => {
  const r = C.planEntryAction({ action: 'remove', rowId: '1',
    scheduleRows: [row({ status: 'scheduled', fb_post_id: 'p_1' })] });
  assert.strictEqual(r.ok, false);
  assert.ok(/would NOT unpublish/.test(r.error), r.error);
  assert.ok(/p_1/.test(r.error));
});
t('reschedule to a future time resets the row to queued', () => {
  const r = C.planEntryAction({ action: 'reschedule', rowId: '1',
    newTime: '2026-10-05T14:00:00Z', scheduleRows: [row({ status: 'failed' })],
    timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'queued');
  assert.strictEqual(r.scheduled_at, '2026-10-05T14:00:00.000Z');
});
t('a past time is refused', () => {
  const r = C.planEntryAction({ action: 'reschedule', rowId: '1',
    newTime: '2020-01-01T00:00:00Z', scheduleRows: [row()], timeZone: TZ, nowMs: NOW });
  assert.strictEqual(r.ok, false);
  assert.ok(/in the past/.test(r.error));
});
t('an unreadable time is refused with an example', () => {
  const r = C.planEntryAction({ action: 'reschedule', rowId: '1', newTime: 'tomorrow',
    scheduleRows: [row()], nowMs: NOW });
  assert.strictEqual(r.ok, false);
  assert.ok(/2026-10-05T14:00:00Z/.test(r.error), r.error);
});
t('an unknown row id is refused', () => {
  const r = C.planEntryAction({ action: 'remove', rowId: '999', scheduleRows: [row()] });
  assert.strictEqual(r.ok, false);
  assert.ok(/No schedule entry/.test(r.error));
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
