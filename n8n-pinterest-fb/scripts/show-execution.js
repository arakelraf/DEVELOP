/**
 * Prints a readable per-node summary of an execution's output.
 *   node scripts/show-execution.js <executionId> [maxCharsPerNode]
 */
const { api } = require('./n8n-api.js');

(async () => {
  const id = process.argv[2];
  const cap = Number(process.argv[3] || 1200);
  const ex = await api('GET', `/executions/${id}?includeData=true`);
  console.log(`execution ${id}  status=${ex.status}  mode=${ex.mode}`);
  console.log(`workflow : ${ex.workflowData?.name}`);
  if (ex.data?.resultData?.error) {
    console.log(`\nTOP-LEVEL ERROR: ${JSON.stringify(ex.data.resultData.error).slice(0, 800)}`);
  }
  const run = ex.data?.resultData?.runData || {};
  for (const [node, runs] of Object.entries(run)) {
    const r = runs[runs.length - 1];
    console.log(`\n=== ${node}   (${r.executionStatus}${r.error ? ', ERROR' : ''})`);
    if (r.error) {
      console.log('  error: ' + String(r.error.message || JSON.stringify(r.error)).slice(0, 500));
    }
    const branches = r.data?.main || [];
    branches.forEach((items, i) => {
      if (!items) { console.log(`  [branch ${i}] (null - not taken)`); return; }
      console.log(`  [branch ${i}] ${items.length} item(s)`);
      items.slice(0, 2).forEach((it, j) => {
        const s = JSON.stringify(it.json, null, 2);
        console.log(`    item ${j}: ` + (s.length > cap ? s.slice(0, cap) + '\n    ...[truncated]' : s));
      });
    });
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
