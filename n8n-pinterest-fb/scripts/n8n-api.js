/**
 * Shared n8n public-API client. Reads N8N_API_URL / N8N_API_KEY from the
 * environment, falling back to the repo's .mcp.json. The key is never logged.
 */
const fs = require('fs');
const path = require('path');

function loadConfig() {
  let url = process.env.N8N_API_URL;
  let key = process.env.N8N_API_KEY;
  if (!url || !key) {
    const candidates = ['.mcp.json', '../.mcp.json', 'mcp.local.json', '../mcp.local.json'];
    for (const rel of candidates) {
      const f = path.resolve(__dirname, '..', rel);
      if (!fs.existsSync(f)) continue;
      try {
        const env = JSON.parse(fs.readFileSync(f, 'utf8'))?.mcpServers?.['n8n-mcp']?.env;
        url = url || env?.N8N_API_URL;
        key = key || env?.N8N_API_KEY;
        if (url && key) break;
      } catch { /* next candidate */ }
    }
  }
  if (!url || !key) throw new Error('Missing N8N_API_URL / N8N_API_KEY (env or .mcp.json)');
  return { base: url.replace(/\/+$/, ''), key };
}

const { base: BASE, key: KEY } = loadConfig();

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
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new Error(`${method} ${route} -> HTTP ${res.status}\n`
      + (json ? JSON.stringify(json) : text.slice(0, 600)));
  }
  return json;
}

module.exports = { api, BASE };
