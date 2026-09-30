const assert = require('assert');
const S = require('./scheduler.js');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

const TZ = 'Europe/Belgrade';
const SLOTS = ['10:00', '15:00', '20:00'];
const iso = (ms) => new Date(ms).toISOString();

console.log('\ntimezone math');
t('10:00 Belgrade in January is 09:00 UTC (CET, +1)', () => {
  const ts = S.zonedTimeToUtc(2026, 1, 15, 10, 0, TZ);
  assert.strictEqual(iso(ts), '2026-01-15T09:00:00.000Z');
});
t('10:00 Belgrade in July is 08:00 UTC (CEST, +2)', () => {
  const ts = S.zonedTimeToUtc(2026, 7, 15, 10, 0, TZ);
  assert.strictEqual(iso(ts), '2026-07-15T08:00:00.000Z');
});
t('slots stay at local 10:00 across the autumn DST change', () => {
  // Europe/Belgrade falls back on the last Sunday of October (2026-10-25).
  const before = S.zonedTimeToUtc(2026, 10, 24, 10, 0, TZ);
  const after = S.zonedTimeToUtc(2026, 10, 26, 10, 0, TZ);
  assert.strictEqual(iso(before), '2026-10-24T08:00:00.000Z', 'before: ' + iso(before));
  assert.strictEqual(iso(after), '2026-10-26T09:00:00.000Z', 'after: ' + iso(after));
  // A naive +24h would have produced the same UTC clock time on both days.
});
t('zonedYmd reports the local calendar date, not UTC', () => {
  // 23:30 UTC on Jan 1 is already Jan 2 in Belgrade.
  const r = S.zonedYmd(new Date('2026-01-01T23:30:00Z'), TZ);
  assert.deepStrictEqual(r, { y: 2026, m: 1, d: 2 });
});

console.log('\nbuildSlotInstants');
t('produces 3 slots per day and skips slots already past', () => {
  const now = Date.parse('2026-03-10T12:00:00Z'); // 13:00 Belgrade
  const out = S.buildSlotInstants({ slots: SLOTS, timezone: TZ, nowMs: now,
    horizonDays: 1, leadMinutes: 20 });
  // Today: 10:00 gone, 15:00 and 20:00 remain. Tomorrow: all three.
  assert.strictEqual(out.length, 5, 'got ' + out.map(iso).join(', '));
  assert.strictEqual(iso(out[0]), '2026-03-10T14:00:00.000Z'); // 15:00 local
});
t('honours the lead time so nothing is scheduled too soon', () => {
  const now = Date.parse('2026-03-10T13:50:00Z'); // 14:50 local, 10 min to 15:00
  const out = S.buildSlotInstants({ slots: SLOTS, timezone: TZ, nowMs: now,
    horizonDays: 0, leadMinutes: 20 });
  assert.ok(!out.some((x) => iso(x) === '2026-03-10T14:00:00.000Z'),
    '15:00 slot was only 10 minutes away and must be skipped');
});
t('ascending order', () => {
  const out = S.buildSlotInstants({ slots: ['20:00', '10:00', '15:00'], timezone: TZ,
    nowMs: Date.parse('2026-03-10T00:00:00Z'), horizonDays: 2, leadMinutes: 20 });
  for (let i = 1; i < out.length; i++) assert.ok(out[i] > out[i - 1]);
});
t('a malformed slot is ignored, not fatal', () => {
  const out = S.buildSlotInstants({ slots: ['10:00', 'banana', '99:99'], timezone: TZ,
    nowMs: Date.parse('2026-03-10T00:00:00Z'), horizonDays: 0, leadMinutes: 20 });
  assert.strictEqual(out.length, 1);
});

console.log('\nplanSchedule - queue rules');
const base = {
  slots: SLOTS, timezone: TZ, nowMs: Date.parse('2026-03-10T06:00:00Z'),
  horizonDays: 14, maxQueue: 60, repostAfterDays: 60, leadMinutes: 20,
  enabledBoards: ['a'], priorityByBoard: { a: 10 },
};
const item = (id, boards = ['a'], extra = {}) => ({
  etsy_listing_id: id, title: 'T' + id, etsy_url: 'https://www.etsy.com/listing/' + id,
  board_slugs: JSON.stringify(boards), ...extra,
});

t('a fresh listing is queued into the first free slot', () => {
  const r = S.planSchedule({ ...base, items: [item('1')], scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 1);
  assert.strictEqual(r.toInsert[0].scheduled_at, '2026-03-10T09:00:00.000Z'); // 10:00 local
  assert.strictEqual(r.toInsert[0].status, 'queued');
  assert.strictEqual(r.toInsert[0].board_slug, 'a');
});
t('a listing already queued is reported, never queued twice', () => {
  const r = S.planSchedule({ ...base, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '1', status: 'queued',
      scheduled_at: '2026-03-12T09:00:00.000Z' }] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.already.length, 1);
  assert.strictEqual(r.already[0].scheduled_at, '2026-03-12T09:00:00.000Z');
});
t('status=posting also counts as queued (mid-publish)', () => {
  const r = S.planSchedule({ ...base, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '1', status: 'posting',
      scheduled_at: '2026-03-10T09:00:00.000Z' }] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.already.length, 1);
});
t('a listing posted 10 days ago is skipped with a countdown', () => {
  const r = S.planSchedule({ ...base, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '1', status: 'posted',
      posted_at: '2026-02-28T09:00:00.000Z' }] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'posted_recently');
  // Posted 9.875 days before `now`, so 50.125 of the 60 days remain and the
  // countdown rounds UP to whole days still to wait.
  assert.strictEqual(r.skipped[0].days_until_eligible, 51);
});
t('a listing posted 70 days ago is eligible again', () => {
  const r = S.planSchedule({ ...base, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '1', status: 'posted',
      posted_at: '2025-12-25T09:00:00.000Z' }] });
  assert.strictEqual(r.toInsert.length, 1);
});
t('repostAfterDays=0 disables reposting entirely', () => {
  const r = S.planSchedule({ ...base, repostAfterDays: 0, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '1', status: 'posted',
      posted_at: '2020-01-01T00:00:00.000Z' }] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'already_posted_reposting_disabled');
});
t('a listing whose boards are all disabled is skipped', () => {
  const r = S.planSchedule({ ...base, items: [item('1', ['zzz'])], scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'all_boards_disabled');
});
t('a listing on several boards counts if ANY board is enabled', () => {
  const r = S.planSchedule({ ...base, items: [item('1', ['zzz', 'a'])], scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 1);
  assert.strictEqual(r.toInsert[0].board_slug, 'a');
});
t('a slot already taken by a queued row is not reused', () => {
  const r = S.planSchedule({ ...base, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '99', status: 'queued',
      scheduled_at: '2026-03-10T09:00:00.000Z' }] });
  assert.strictEqual(r.toInsert[0].scheduled_at, '2026-03-10T14:00:00.000Z'); // next slot
});
t('maxQueue caps a run and the rest are reported unplaced', () => {
  const items = Array.from({ length: 5 }, (_, i) => item(String(i + 1)));
  const r = S.planSchedule({ ...base, maxQueue: 2, items, scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 2);
  assert.strictEqual(r.unplaced.length, 3);
  assert.strictEqual(r.unplaced[0].reason, 'max_queue_per_run');
});
t('running out of horizon is reported, not silently dropped', () => {
  const items = Array.from({ length: 10 }, (_, i) => item(String(i + 1)));
  const r = S.planSchedule({ ...base, horizonDays: 0, items, scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 3); // only today's three slots
  assert.strictEqual(r.unplaced.length, 7);
  assert.strictEqual(r.unplaced[0].reason, 'no_free_slot_in_horizon');
});
t('nothing is ever scheduled in the past', () => {
  const items = Array.from({ length: 6 }, (_, i) => item(String(i + 1)));
  const r = S.planSchedule({ ...base, items, scheduleRows: [] });
  for (const row of r.toInsert) {
    assert.ok(Date.parse(row.scheduled_at) > base.nowMs, row.scheduled_at);
  }
});

console.log('\nplanSchedule - board rotation');
t('two boards alternate instead of running back to back', () => {
  const items = [
    item('1', ['a']), item('2', ['a']), item('3', ['a']),
    item('4', ['b']), item('5', ['b']), item('6', ['b']),
  ];
  const r = S.planSchedule({ ...base, enabledBoards: ['a', 'b'],
    priorityByBoard: { a: 10, b: 5 }, items, scheduleRows: [] });
  const seq = r.toInsert.map((x) => x.board_slug);
  assert.strictEqual(seq.length, 6);
  for (let i = 1; i < seq.length; i++) {
    assert.notStrictEqual(seq[i], seq[i - 1], 'consecutive same board: ' + seq.join(','));
  }
});
t('higher priority board goes first', () => {
  const items = [item('1', ['a']), item('2', ['b'])];
  const r = S.planSchedule({ ...base, enabledBoards: ['a', 'b'],
    priorityByBoard: { a: 1, b: 99 }, items, scheduleRows: [] });
  assert.strictEqual(r.toInsert[0].board_slug, 'b');
});
t('a single board still fills every slot (no starvation)', () => {
  const items = [item('1'), item('2'), item('3'), item('4')];
  const r = S.planSchedule({ ...base, items, scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 4);
});
t('uneven boards: leftovers from the bigger board still get placed', () => {
  const items = [item('1', ['a']), item('2', ['a']), item('3', ['a']), item('4', ['b'])];
  const r = S.planSchedule({ ...base, enabledBoards: ['a', 'b'],
    priorityByBoard: { a: 10, b: 5 }, items, scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 4, 'all four must be scheduled');
  assert.strictEqual(new Set(r.toInsert.map((x) => x.etsy_listing_id)).size, 4);
});
t('oldest first within a board', () => {
  const items = [
    item('new', ['a'], { first_seen_at: '2026-03-01T00:00:00Z' }),
    item('old', ['a'], { first_seen_at: '2026-01-01T00:00:00Z' }),
  ];
  const r = S.planSchedule({ ...base, items, scheduleRows: [] });
  assert.strictEqual(r.toInsert[0].etsy_listing_id, 'old');
});

console.log('\nplanSchedule - robustness');
t('board_slugs as a plain array works too', () => {
  const r = S.planSchedule({ ...base, items: [{ etsy_listing_id: '1', board_slugs: ['a'] }],
    scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 1);
});
t('malformed board_slugs does not throw', () => {
  const r = S.planSchedule({ ...base,
    items: [{ etsy_listing_id: '1', board_slugs: 'not json' },
            { etsy_listing_id: '2', board_slugs: null }],
    scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.skipped.length, 2);
});
t('a schedule row with an unparseable date does not block slots', () => {
  const r = S.planSchedule({ ...base, items: [item('1')],
    scheduleRows: [{ etsy_listing_id: '99', status: 'queued', scheduled_at: 'nonsense' }] });
  assert.strictEqual(r.toInsert[0].scheduled_at, '2026-03-10T09:00:00.000Z');
});
t('empty input yields an empty plan, not an error', () => {
  const r = S.planSchedule({ ...base, items: [], scheduleRows: [] });
  assert.strictEqual(r.toInsert.length, 0);
  assert.strictEqual(r.report.candidates, 0);
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
