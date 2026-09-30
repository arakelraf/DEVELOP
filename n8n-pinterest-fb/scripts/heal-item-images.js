#!/usr/bin/env node
/**
 * Maintenance: re-verify items whose image_url is a downscaled Pinterest
 * thumbnail and upgrade it to the original when one is reachable.
 *
 * Needed because early syncs only probed two candidates and settled for
 * /736x/. Also useful any time Pinterest changes what it serves.
 *
 * Verification runs through the "02 - URL Check" workflow, because the n8n
 * server is the machine that has to be able to fetch the image - checking
 * from anywhere else proves nothing.
 *
 *   node scripts/heal-item-images.js [--apply]
 */
const { api, BASE } = require('./n8n-api.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APPLY = process.argv.includes('--apply');
const ITEMS = 'JaT1fvUeN6R77Pg2';

const upgrades = (url) => {
  const m = String(url).match(/^(https?:\/\/i\.pinimg\.com\/)([^/]+)(\/.+?)(\.[a-z]+)$/i);
  if (!m) return [];
  const [, host, size, p, ext] = m;
  if (/^originals$/i.test(size)) return [];
  return [`${host}originals${p}.png`, `${host}originals${p}${ext}`, `${host}1200x${p}${ext}`];
};

(async () => {
  const rows = (await api('GET', `/data-tables/${ITEMS}/rows?limit=100`)).data || [];
  const targets = rows
    .map((r) => ({ row: r, cands: upgrades(r.image_url) }))
    .filter((t) => t.cands.length);

  console.log(`items: ${rows.length}, downscaled: ${targets.length}`
    + (APPLY ? '' : '   (dry run - pass --apply to write)'));
  if (!targets.length) return;

  // Drive the checker workflow, restoring its active state afterwards.
  const wfs = (await api('GET', '/workflows?limit=100')).data || [];
  const checker = wfs.find((w) => w.name === '02 - URL Check');
  if (!checker) throw new Error('workflow "02 - URL Check" is not deployed');
  const wasActive = checker.active;
  if (!wasActive) { await api('POST', `/workflows/${checker.id}/activate`); await sleep(1500); }

  let fixed = 0;
  try {
    for (const t of targets) {
      const res = await fetch(`${BASE}/webhook/url-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'HEAD', urls: t.cands }),
      });
      if (!res.ok) { console.log(`  ${t.row.etsy_listing_id}: checker HTTP ${res.status}`); continue; }

      // lastNode returns only the first item, so read the execution for all.
      await sleep(400);
      const last = (await api('GET', '/executions?limit=1')).data[0];
      const ex = await api('GET', `/executions/${last.id}?includeData=true`);
      const report = ex.data?.resultData?.runData?.Report?.[0]?.data?.main?.[0] || [];
      const ok = report.map((i) => i.json).find((j) => j.status === 200);

      if (!ok) { console.log(`  ${t.row.etsy_listing_id}: no upgrade reachable, leaving as is`); continue; }
      if (ok.url === t.row.image_url) continue;

      console.log(`  ${t.row.etsy_listing_id}: ${t.row.image_url.replace(/^.*pinimg\.com/, '')}`
        + `\n      -> ${ok.url.replace(/^.*pinimg\.com/, '')}  (${ok.content_length} bytes)`);
      if (APPLY) {
        // n8n's row-update endpoint is /rows/update (plain /rows is insert-only).
        await api('PATCH', `/data-tables/${ITEMS}/rows/update`, {
          filter: { type: 'and', filters: [{ columnName: 'etsy_listing_id', condition: 'eq', value: t.row.etsy_listing_id }] },
          data: { image_url: ok.url },
        });
        fixed++;
      }
    }
  } finally {
    if (!wasActive) await api('POST', `/workflows/${checker.id}/deactivate`);
  }
  console.log(APPLY ? `\nupdated ${fixed} row(s)` : '\nnothing written (dry run)');
})().catch((e) => { console.error(e.message); process.exit(1); });
