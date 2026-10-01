#!/usr/bin/env node
/**
 * Prints (and optionally writes) the posting list for a given local day,
 * straight from the tables - the same content Workflow D's form shows, but
 * persistent and greppable.
 *
 *   node scripts/todays-posts.js            today
 *   node scripts/todays-posts.js 1          tomorrow
 *   node scripts/todays-posts.js 0 out.md   also write it to a file
 */
const fs = require('fs');
const { api } = require('./n8n-api.js');

const SCHEDULE = 'xKKcCos8oPqCFNDW';
const ITEMS = 'JaT1fvUeN6R77Pg2';
const CONFIG = 'Fzx5awBGnmaDaffF';
const PENDING = new Set(['queued', 'posting', 'scheduled']);

const dayOffset = Number(process.argv[2] || 0);
const outFile = process.argv[3] || '';

const localDate = (iso, tz) => new Intl.DateTimeFormat('en-CA',
  { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(iso));
const localHM = (iso, tz) => new Intl.DateTimeFormat('en-GB',
  { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
  .format(new Date(iso));

(async () => {
  const cfg = {};
  for (const r of (await api('GET', `/data-tables/${CONFIG}/rows?limit=100`)).data || []) {
    cfg[r.key] = r.value;
  }
  const tz = cfg.TIMEZONE || 'Europe/Belgrade';

  const rows = (await api('GET', `/data-tables/${SCHEDULE}/rows?limit=100`)).data || [];
  const items = new Map(
    ((await api('GET', `/data-tables/${ITEMS}/rows?limit=100`)).data || [])
      .map((i) => [String(i.etsy_listing_id), i])
  );

  const now = Date.now();
  const target = localDate(new Date(now + dayOffset * 86400000).toISOString(), tz);

  const due = rows
    .filter((r) => PENDING.has(String(r.status)))
    .filter((r) => localDate(r.scheduled_at, tz) === target)
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));

  const out = [];
  out.push(`# Posts for ${target} (${tz})`, '');
  if (!due.length) {
    out.push('Nothing scheduled for this day.');
  } else {
    out.push(`${due.length} post(s). Times are local. Paste each caption into`,
      'Meta Business Suite, attach the image at the IMAGE url, set the time.', '');
  }

  for (const [i, r] of due.entries()) {
    const it = items.get(String(r.etsy_listing_id)) || {};
    const slot = Date.parse(r.scheduled_at);
    const passed = slot < now;
    out.push(
      `## ${i + 1}. ${localHM(r.scheduled_at, tz)}`
        + (passed ? '  (this slot has already passed today)' : ''),
      '',
      `- entry: #${r.id}   listing: ${r.etsy_listing_id}   board: ${r.board_slug}`,
      `- image: ${it.image_url || '(MISSING - do not post this one)'}`,
      `- etsy:  ${it.etsy_url || ''}`,
      '',
      'Caption:',
      '',
      '```',
      String(r.post_text || '').trim(),
      '```',
      ''
    );
  }

  const text = out.join('\n');
  console.log(text);
  if (outFile) {
    fs.writeFileSync(outFile, text + '\n');
    console.error(`\n[written to ${outFile}]`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
