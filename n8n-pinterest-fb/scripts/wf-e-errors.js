/**
 * Emits workflows/E-error-handler.json  -  "E - Error Handler".
 *
 * Named as the error workflow of A/B/C/D. It catches outright CRASHES; the
 * failures each workflow expects (a dead board feed, a Graph API refusal, a
 * lost claim) are logged by those workflows themselves with far more context.
 * So anything that lands here is unexpected, and the row says which node
 * broke and how to open the execution.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ERRORS = 'VahesI6mpjXmcBX5';

const nodes = [
  { id: 'sn-e', name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-60, -260], parameters: { width: 460, height: 240, color: 2, content: [
      '## E - Error Handler',
      '',
      'Set as the **error workflow** of A, B, C and D.',
      '',
      'It catches outright crashes. Expected failures - a 404 board feed, a',
      'Graph API refusal, a lost claim - are logged by those workflows with',
      'much more context, so anything appearing here is genuinely unexpected.',
      '',
      'Read it with **D -> Boards** or straight from the `errors_log` table.',
    ].join('\n') } },

  { id: 'trg-err', name: 'On Workflow Error', type: 'n8n-nodes-base.errorTrigger',
    typeVersion: 1, position: [220, -40], parameters: {} },

  { id: 'cd-fmt', name: 'Format Error', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [440, -40], parameters: { jsCode: read('build/format-error.js') } },

  { id: 'dt-log', name: 'Write Error Log', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [660, -40], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: ERRORS },
      columns: { mappingMode: 'defineBelow', matchingColumns: [], schema: [],
        value: {
          workflow: '={{ $json.workflow }}',
          level: '={{ $json.level }}',
          context: '={{ $json.context }}',
          message: '={{ $json.message }}',
          created_at: '={{ $json.created_at }}',
        } } } },
];

const workflow = {
  name: 'E - Error Handler',
  nodes,
  connections: {
    'On Workflow Error': { main: [[{ node: 'Format Error', type: 'main', index: 0 }]] },
    'Format Error': { main: [[{ node: 'Write Error Log', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', timezone: 'Europe/Belgrade',
    saveDataErrorExecution: 'all', saveManualExecutions: true },
};

fs.writeFileSync(path.join(ROOT, 'workflows/E-error-handler.json'),
  JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote workflows/E-error-handler.json  (${nodes.length} nodes)`);
