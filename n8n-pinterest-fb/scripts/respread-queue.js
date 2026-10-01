#!/usr/bin/env node
/**
 * Re-spread queued posts over the CURRENT slots in config.
 *
 * Changing SLOTS only affects what Workflow B queues next - entries already
 * in the queue keep the times they were given. This redistributes them onto
 * the new grid so a change to posts-per-day takes effect immediately.
 *
 * Only `queued` rows are touched. A row already handed to Facebook
 * (`scheduled`) is left alone: Facebook holds it, and moving our row would
 * not move the post.
 *
 *   node scripts/respread-queue.js           dry run
 *   node scripts/respread-queue.js --apply
 */
const { api } = require('./n8n-api.js');
const { buildSlotInstants } = require('../src/scheduler.js');

const SCHEDULE = 'xKKcCos8oPqCFNDW';
const CONFIG = 'Fzx5awBGnmaDaffF';
const APPLY = process.argv.includes('--apply');
const UNTOUCHABLE = new Set(['posted', 'scheduled', 'posting']);

const fmt = (iso, tz) => new Intl.DateTimeFormat('en-GB',
  { timeZone: tz, dateStyle: 'short', timeStyle: 'short', hour12: false })
  .format(new Date(iso));

(async () => {
  const cfg = {};
  for (const r of (await api('GET', `/data-tables/${CONFIG}/rows?limit=100`)).data || []) {
    cfg[r.key] = r.value;
  }
  const tz = cfg.TIMEZONE || 'Europe/Belgrade';
  const slots = String(cfg.SLOTS).split(',').map((s) => s.trim()).filter(Boolean);
  const horizon = Math.max(1, Number(cfg.SCHEDULE_HORIZON_DAYS) || 14);

  const rows = (await api('GET', `/data-tables/${SCHEDULE}/rows?limit=100`)).data || [];
  const queued = rows.filter((r) => r.status === 'queued')
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));

  // Slots held by rows we must not move stay occupied.
  const taken = new Set(rows.filter((r) => UNTOUCHABLE.has(r.status))
    .map((r) => Date.parse(r.scheduled_at)).filter(Number.isFinite));

  const nowMs = Date.now();
  const grid = buildSlotInstants({ slots, timezone: tz, nowMs, horizonDays: horizon,
    leadMinutes: 20 }).filter((t) => !taken.has(t));

  console.log(`slots now : ${slots.join(', ')} (${slots.length}/day, ${tz})`);
  console.log(`queued    : ${queued.length}`);
  console.log(`free slots: ${grid.length} within ${horizon} days`);
  console.log(APPLY ? '' : '\n(dry run - pass --apply to write)\n');

  if (queued.length > grid.length) {
    console.log(`WARNING: ${queued.length - grid.length} entries will not fit `
      + 'in the horizon and are left where they are.');
  }

  let moved = 0;
  for (let i = 0; i < queued.length; i++) {
    const slot = grid[i];
    if (slot === undefined) break;
    const next = new Date(slot).toISOString();
    if (next === queued[i].scheduled_at) continue;
    console.log(`  #${String(queued[i].id).padEnd(3)} `
      + `${fmt(queued[i].scheduled_at, tz)}  ->  ${fmt(next, tz)}`);
    if (APPLY) {
      await api('PATCH', `/data-tables/${SCHEDULE}/rows/update`, {
        filter: { type: 'and', filters: [
          { columnName: 'id', condition: 'eq', value: queued[i].id },
          // Guard: if C claimed or published it since we read, skip rather
          // than stamping a time onto a row that has moved on.
          { columnName: 'status', condition: 'eq', value: 'queued' },
        ] },
        data: { scheduled_at: next },
      });
    }
    moved++;
  }
  console.log(`\n${APPLY ? 'moved' : 'would move'} ${moved} entr${moved === 1 ? 'y' : 'ies'}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
