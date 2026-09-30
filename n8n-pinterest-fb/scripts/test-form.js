/**
 * Exercises a deployed form-trigger workflow end to end: activates it,
 * submits the given payloads to its production form URL, then deactivates it
 * again (always, even if a submission throws).
 *
 *   node scripts/test-form.js <workflowId> '<json payload>' ['<json payload>' ...]
 */
const { api, BASE } = require('./n8n-api.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [id, ...payloads] = process.argv.slice(2);
  const wf = await api('GET', `/workflows/${id}`);
  const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.formTrigger');
  if (!trigger) throw new Error('no form trigger in this workflow');
  const formUrl = `${BASE}/form/${trigger.webhookId}`;
  const wasActive = wf.active;

  if (!wasActive) {
    await api('POST', `/workflows/${id}/activate`);
    console.log(`activated ${wf.name}`);
    await sleep(1500); // let the webhook register
  }

  try {
    for (const raw of payloads) {
      const body = JSON.parse(raw);
      console.log('\n--- submitting ' + JSON.stringify(body));
      // n8n's form endpoint accepts multipart/form-data only.
      const fd = new FormData();
      for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
      const res = await fetch(formUrl, { method: 'POST', body: fd });
      const text = await res.text();
      console.log(`HTTP ${res.status}`);
      console.log(text.slice(0, 2500));
    }
  } finally {
    if (!wasActive) {
      await api('POST', `/workflows/${id}/deactivate`);
      console.log('\ndeactivated again (left as it was found)');
    }
  }
})().catch((e) => { console.error('\nERROR: ' + e.message); process.exit(1); });
