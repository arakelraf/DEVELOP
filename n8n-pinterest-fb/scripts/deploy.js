#!/usr/bin/env node
/**
 * Deploy workflow JSON files to the n8n instance via the public API.
 *
 *   node scripts/deploy.js workflows/00-feed-probe.json [...]
 *
 * Matches on workflow NAME: creates it if absent, updates it in place if
 * present, so re-running never leaves duplicates behind.
 *
 * Credentials are read from N8N_API_URL / N8N_API_KEY in the environment,
 * falling back to the repo's .mcp.json. The key is never printed.
 */
const fs = require('fs');
const path = require('path');

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
      } catch { /* try the next candidate */ }
    }
  }
  if (!url || !key) {
    console.error('Missing N8N_API_URL / N8N_API_KEY (env or .mcp.json).');
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ''), key };
}

const { url: BASE, key: KEY } = loadConfig();

async function api(method, route, body) {
  const res = await fetch(`${BASE}/api/v1${route}`, {
    method,
    headers: {
      'X-N8N-API-KEY': KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text.slice(0, 600);
    throw new Error(`${method} ${route} -> HTTP ${res.status}\n${detail}`);
  }
  return json;
}

/** Page through every workflow so name matching is reliable. */
async function findByName(name) {
  let cursor;
  do {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const page = await api('GET', `/workflows?${q}`);
    const hit = (page.data || []).find((w) => w.name === name);
    if (hit) return hit;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

async function deployFile(file) {
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || { executionOrder: 'v1' },
  };

  const existing = await findByName(wf.name);
  if (existing) {
    await api('PUT', `/workflows/${existing.id}`, payload);
    console.log(`updated  ${wf.name}\n         id=${existing.id}  nodes=${wf.nodes.length}`);
    return existing.id;
  }
  const created = await api('POST', '/workflows', payload);
  console.log(`created  ${wf.name}\n         id=${created.id}  nodes=${wf.nodes.length}`);
  return created.id;
}

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/deploy.js <workflow.json> [...]');
    process.exit(2);
  }
  const ids = {};
  for (const f of files) ids[path.basename(f)] = await deployFile(f);
  fs.writeFileSync(
    path.join(__dirname, '..', 'build/deployed-ids.json'),
    JSON.stringify(ids, null, 2) + '\n'
  );
})().catch((e) => { console.error('\nDEPLOY FAILED\n' + e.message); process.exit(1); });
