const { api, BASE } = require('./n8n-api.js');
(async () => {
  const id = process.argv[2];
  const wf = await api('GET', `/workflows/${id}`);
  console.log(`name   : ${wf.name}`);
  console.log(`active : ${wf.active}`);
  for (const n of wf.nodes) {
    if (n.webhookId) console.log(`webhook: ${n.name} -> ${n.webhookId}`);
  }
  console.log(`base   : ${BASE}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
