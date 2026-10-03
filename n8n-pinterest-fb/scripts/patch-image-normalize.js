#!/usr/bin/env node
/**
 * One-off surgical patch of the LIVE "C - Publisher" workflow for image
 * normalisation (letterbox the pin to 4:5 so the Facebook feed never crops it).
 *
 * It fetches the live workflow (keeping every node, credential and setting
 * intact), then swaps ONLY:
 *   - the "Config" Code node jsCode            -> build/config-map.js
 *   - the "Select To Publish" Code node jsCode -> build/select-to-publish.js
 *   - the "FB Upload Photo By URL" body `url`   -> fb_image_url || image_url
 * and PUTs it back. Nothing else is touched, so the page token (read at runtime
 * from the Pick Page credential) is untouched.
 *
 *   node scripts/patch-image-normalize.js          # apply
 *   node scripts/patch-image-normalize.js --dry     # show what would change
 */
const fs = require('fs');
const path = require('path');

const WF_ID = '5e40Xz6KQgc6ihqp'; // C - Publisher
const DRY = process.argv.includes('--dry');

function loadConfig() {
  let url = process.env.N8N_API_URL;
  let key = process.env.N8N_API_KEY;
  if (!url || !key) {
    for (const p of ['../.mcp.json', '.mcp.json', '../mcp.local.json']) {
      const f = path.join(__dirname, '..', p);
      if (!fs.existsSync(f)) continue;
      try {
        const env = JSON.parse(fs.readFileSync(f, 'utf8'))?.mcpServers?.['n8n-mcp']?.env;
        url = url || env?.N8N_API_URL;
        key = key || env?.N8N_API_KEY;
        if (url && key) break;
      } catch { /* next */ }
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

  const cfgNode = byName('Config');
  if (!cfgNode) throw new Error('Config node not found');
  const newCfg = read('build/config-map.js');
  if (cfgNode.parameters.jsCode !== newCfg) {
    cfgNode.parameters.jsCode = newCfg;
    changes.push('Config.jsCode');
  }

  const selNode = byName('Select To Publish');
  if (!selNode) throw new Error('Select To Publish node not found');
  const newSel = read('build/select-to-publish.js');
  if (selNode.parameters.jsCode !== newSel) {
    selNode.parameters.jsCode = newSel;
    changes.push('Select To Publish.jsCode');
  }

  const upNode = byName('FB Upload Photo By URL');
  if (!upNode) throw new Error('FB Upload Photo By URL node not found');
  const bp = upNode.parameters.bodyParameters.parameters.find((p) => p.name === 'url');
  const newVal = '={{ $json.fb_image_url || $json.image_url }}';
  if (bp.value !== newVal) { bp.value = newVal; changes.push('FB Upload Photo By URL.body.url'); }

  // sanity: new Select code must carry the transform
  if (!newSel.includes('buildDisplayImageUrl')) throw new Error('build/select-to-publish.js is stale (no buildDisplayImageUrl) - run build-code-nodes.js first');

  console.log('changes:', changes.length ? changes.join(', ') : '(none)');
  if (DRY) { console.log('--dry: not writing.'); return; }
  if (!changes.length) { console.log('nothing to do.'); return; }

  await api('PUT', `/workflows/${WF_ID}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || { executionOrder: 'v1' },
  });
  console.log(`patched  ${wf.name}  id=${WF_ID}  (${wf.nodes.length} nodes preserved)`);
})().catch((e) => { console.error('\nPATCH FAILED\n' + e.message); process.exit(1); });
