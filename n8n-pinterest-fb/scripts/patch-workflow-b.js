#!/usr/bin/env node
/**
 * Surgical patch of the LIVE "B - Build Schedule" workflow so new queue rows
 * get the marketing format: Etsy link held OUT of the body (posted as the
 * first comment by Workflow C) and the CTA footer appended before hashtags.
 *
 * Swaps ONLY two Code nodes, keeping every other node, credential and setting:
 *   - "Config" jsCode        -> build/config-map.js  (adds _link_in_comment etc.)
 *   - "Plan Schedule" jsCode -> build/plan-schedule.js (link-in-comment + CTA)
 *
 *   node scripts/patch-workflow-b.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const WF_ID = 'lquFp2VbnUQck4aw'; // B - Build Schedule
const DRY = process.argv.includes('--dry');

function loadConfig() {
  let url = process.env.N8N_API_URL, key = process.env.N8N_API_KEY;
  if (!url || !key) {
    for (const p of ['../.mcp.json', '.mcp.json', '../mcp.local.json']) {
      const f = path.join(__dirname, '..', p);
      if (!fs.existsSync(f)) continue;
      try {
        const env = JSON.parse(fs.readFileSync(f, 'utf8'))?.mcpServers?.['n8n-mcp']?.env;
        url = url || env?.N8N_API_URL; key = key || env?.N8N_API_KEY;
        if (url && key) break;
      } catch {}
    }
  }
  if (!url || !key) { console.error('Missing N8N_API_URL / N8N_API_KEY.'); process.exit(2); }
  return { url: url.replace(/\/+$/, ''), key };
}
const { url: BASE, key: KEY } = loadConfig();

async function api(method, route, body) {
  const res = await fetch(`${BASE}/api/v1${route}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${method} ${route} -> HTTP ${res.status}\n${json ? JSON.stringify(json) : text.slice(0, 600)}`);
  return json;
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

(async () => {
  const wf = await api('GET', `/workflows/${WF_ID}`);
  const byName = (n) => wf.nodes.find((x) => x.name === n);
  const changes = [];

  const map = [
    ['Config', 'build/config-map.js'],
    ['Plan Schedule', 'build/plan-schedule.js'],
  ];
  for (const [name, rel] of map) {
    const node = byName(name);
    if (!node) throw new Error(`${name} node not found`);
    const code = read(rel);
    if (node.parameters.jsCode !== code) { node.parameters.jsCode = code; changes.push(name); }
  }

  const planCode = read('build/plan-schedule.js');
  if (!planCode.includes('linkInComment')) throw new Error('build/plan-schedule.js is stale - run build-code-nodes.js');

  console.log('changes:', changes.length ? changes.join(', ') : '(none)');
  if (DRY) { console.log('--dry: not writing.'); return; }
  if (!changes.length) { console.log('nothing to do.'); return; }

  await api('PUT', `/workflows/${WF_ID}`, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings || { executionOrder: 'v1' },
  });
  console.log(`patched  ${wf.name}  id=${WF_ID}  (${wf.nodes.length} nodes preserved)`);
})().catch((e) => { console.error('\nPATCH FAILED\n' + e.message); process.exit(1); });
