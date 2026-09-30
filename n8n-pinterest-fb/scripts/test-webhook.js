/**
 * Activates a webhook workflow, POSTs a JSON body to it, then restores its
 * original active state.
 *   node scripts/test-webhook.js <workflowId> '<json body>'
 */
const { api, BASE } = require('./n8n-api.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [id, bodyRaw] = process.argv.slice(2);
  const wf = await api('GET', `/workflows/${id}`);
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (!hook) throw new Error('no webhook trigger in this workflow');
  const url = `${BASE}/webhook/${hook.parameters.path}`;
  const wasActive = wf.active;

  if (!wasActive) {
    await api('POST', `/workflows/${id}/activate`);
    console.log(`activated ${wf.name}`);
    await sleep(1500);
  }
  try {
    console.log(`POST ${url}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyRaw,
    });
    const text = await res.text();
    console.log(`HTTP ${res.status}\n`);
    try { console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 6000)); }
    catch { console.log(text.slice(0, 3000)); }
  } finally {
    if (!wasActive) {
      await api('POST', `/workflows/${id}/deactivate`);
      console.log('\ndeactivated again');
    }
  }
})().catch((e) => { console.error('\nERROR: ' + e.message); process.exit(1); });
