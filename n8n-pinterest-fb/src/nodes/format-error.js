// Turns an n8n Error Trigger payload into one errors_log row.
//
// The Error Trigger fires when any workflow that names this one as its error
// workflow fails outright - a crash, not a handled failure. Handled problems
// (a dead feed, a Graph API refusal) are logged by the workflows themselves,
// so anything arriving here is unexpected and worth reading.
// Mode: Run Once for All Items.

const e = $input.first().json || {};
const wf = e.workflow || {};
const ex = e.execution || {};
const err = ex.error || e.error || {};
const node = err.node || {};

const lines = [
  `workflow : ${wf.name || wf.id || 'unknown'}`,
  `node     : ${node.name || 'unknown'}${node.type ? ` (${node.type})` : ''}`,
  `message  : ${err.message || 'no message'}`,
];
if (err.description) lines.push(`detail   : ${err.description}`);
if (ex.lastNodeExecuted) lines.push(`last node: ${ex.lastNodeExecuted}`);
if (ex.id) lines.push(`execution: ${ex.id}`);
if (ex.url) lines.push(`open     : ${ex.url}`);
if (err.stack) {
  // The first frames are the useful part; the rest is n8n internals.
  lines.push('stack    : ' + String(err.stack).split('\n').slice(0, 3).join(' | '));
}

return [{ json: {
  workflow: String(wf.name || 'unknown'),
  level: 'error',
  context: `crash in ${node.name || 'unknown node'}`,
  message: lines.join('\n'),
  created_at: new Date().toISOString(),
} }];
