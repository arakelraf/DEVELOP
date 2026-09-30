/**
 * Emits workflows/D-control.json  -  "D - Control".
 *
 * One n8n Form is the whole control surface: the copy-paste posting list for
 * when the Graph API is not available, the 7-day queue, a listing lookup,
 * board management, and reschedule/remove.
 *
 * Read-only actions are answered by Parse Request directly. Actions that
 * write are validated there first, so no table is touched on bad input.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const T = {
  boards: 'eHP9QfDm4Ay8F0HE',
  items: 'JaT1fvUeN6R77Pg2',
  schedule: 'xKKcCos8oPqCFNDW',
  config: 'Fzx5awBGnmaDaffF',
};
const table = (id) => ({ __rl: true, mode: 'id', value: id });
const cols = (value) => ({ mappingMode: 'defineBelow', value, matchingColumns: [], schema: [] });
const opts = { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'loose' };
const ifString = (left, right) => ({
  conditions: { options: opts, combinator: 'and', conditions: [{ id: 'c0',
    leftValue: left, rightValue: right,
    operator: { type: 'string', operation: 'equals' } }] },
  options: {},
});
const dtGet = (id, name, x, y, tableId) => ({
  id, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [x, y],
  alwaysOutputData: true,
  parameters: { resource: 'row', operation: 'get', dataTableId: table(tableId),
    matchType: 'allConditions', filters: {}, returnAll: true },
});
const gate = (id, name, x, y, what) => ({
  id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
  parameters: { jsCode:
    '// Collapses the branch to ONE item so the next data-table read runs\n'
    + "// once. Rows stay reachable via $('" + what + "').all().\n"
    + '// Mode: Run Once for All Items.\n\n'
    + 'return [{ json: { loaded: $input.all().length } }];\n' },
  alwaysOutputData: true,
  notes: 'Single-item gate - keeps the next table read from running N times.',
});
const byRowId = (expr) => ({ conditions: [{ id: 'c0', keyName: 'id',
  condition: 'eq', keyValue: expr }] });

const ACTION_OPTIONS = [
  "Today's posts (copy-paste list)",
  "Tomorrow's posts (copy-paste list)",
  'Queue for the next 7 days',
  'Check a listing',
  'Boards: show all',
  'Board: enable',
  'Board: disable',
  'Board: add a new one',
  'Entry: reschedule',
  'Entry: remove',
];

const nodes = [
  { id: 'sn-d', name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-660, -420], parameters: { width: 540, height: 400, color: 6, content: [
      '## D - Control',
      '',
      'Click **Execute workflow**, open the form link, pick an action.',
      '',
      '**Today\'s / Tomorrow\'s posts** is the no-API path: caption, image URL',
      'and time for each post, ready to paste into Meta Business Suite. The',
      'hard part - what to post, when, with which image, no repeats, boards',
      'rotating - is already decided.',
      '',
      '**Queue for the next 7 days** shows entry ids (the `#`), which',
      'reschedule and remove take.',
      '',
      'Read-only actions answer straight away. Anything that writes is',
      'validated first, so a typo never half-applies.',
    ].join('\n') } },

  { id: 'sn-d2', name: 'Sticky Note1', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-660, 20], parameters: { width: 540, height: 280, color: 4, content: [
      '### Enabling and disabling a board',
      '',
      '`enabled` controls **publishing**, never collection - a disabled board',
      'keeps accumulating pins so that turning it on later has a backlog.',
      '',
      'Disabling moves queued entries to `skipped`, but **only** those whose',
      'listing belongs to no other enabled board. A listing pinned on two',
      'boards keeps its slot while either one is on.',
      '',
      'Enabling restores exactly the entries that were skipped.',
    ].join('\n') } },

  { id: 'trg-form', name: 'Control Form', type: 'n8n-nodes-base.formTrigger',
    typeVersion: 2.6, position: [-40, -120],
    parameters: {
      formTitle: 'Pinterest to Facebook - control',
      formDescription:
        'Pick an action. Only the fields that action needs have to be filled; '
        + 'leave the rest empty.',
      formFields: { values: [
        { fieldLabel: 'Action', fieldType: 'dropdown', requiredField: true,
          fieldOptions: { values: ACTION_OPTIONS.map((option) => ({ option })) } },
        { fieldLabel: 'Etsy URL or listing id', fieldType: 'text',
          placeholder: 'https://www.etsy.com/listing/4573408504/... or 4573408504' },
        { fieldLabel: 'Board slug (for enable / disable)', fieldType: 'text',
          placeholder: 'usefull-toolskits' },
        { fieldLabel: 'New board: Pinterest username', fieldType: 'text',
          placeholder: 'irobotsvc  (or leave empty and paste a board URL below)' },
        { fieldLabel: 'New board: slug, name or pasted URL', fieldType: 'text',
          placeholder: 'printable-wall-art' },
        { fieldLabel: 'New board: display name', fieldType: 'text',
          placeholder: 'Printable Wall Art' },
        { fieldLabel: 'New board: priority', fieldType: 'number',
          placeholder: '10 - higher goes first in the rotation' },
        { fieldLabel: 'Entry id (the # from the queue view)', fieldType: 'text',
          placeholder: '7' },
        { fieldLabel: 'New time (e.g. 2026-10-05T14:00:00Z)', fieldType: 'text',
          placeholder: '2026-10-05T14:00:00Z' },
      ] },
      responseMode: 'lastNode',
    } },

  dtGet('dt-config', 'Load Config', 200, -120, T.config),
  { id: 'cd-config', name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [420, -120], parameters: { jsCode: read('build/config-map.js') } },
  dtGet('dt-boards', 'Load Boards', 640, -120, T.boards),
  gate('gt-boards', 'Boards Loaded', 860, -120, 'Load Boards'),
  dtGet('dt-items', 'Load Items', 1080, -120, T.items),
  gate('gt-items', 'Items Loaded', 1300, -120, 'Load Items'),
  dtGet('dt-sched', 'Load Schedule', 1520, -120, T.schedule),

  { id: 'cd-parse', name: 'Parse Request', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1740, -120], parameters: { jsCode: read('build/parse-request.js') },
    notes: 'Answers read-only actions here; validates writes before any table '
         + 'is touched. Logic unit-tested in src/control.test.js (38 cases).' },

  { id: 'if-answer', name: 'Answer?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, -120], parameters: ifString('={{ $json._kind }}', 'answer'),
    notes: 'TRUE = a read-only answer, or a validation error. Nothing to write.' },

  { id: 'if-toggle', name: 'Toggle?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, 140], parameters: ifString('={{ $json._kind }}', 'toggle') },

  { id: 'dt-toggle', name: 'Update Board Enabled', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 60], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.boards),
      matchType: 'allConditions',
      filters: { conditions: [{ id: 'c0', keyName: 'board_slug', condition: 'eq',
        keyValue: '={{ $json.board_slug }}' }] },
      columns: cols({ enabled: '={{ $json.enabled }}' }), options: {} } },

  { id: 'cd-cascade', name: 'Cascade Plan', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [2400, 60], parameters: { jsCode: read('build/cascade-plan.js') },
    notes: 'Applies the toggle in memory first, because Load Boards holds the '
         + 'pre-update state.' },

  { id: 'if-cascade', name: 'Any Cascade?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [2620, 60], parameters: ifString('={{ $json._kind }}', 'cascade') },

  { id: 'dt-cascade', name: 'Apply Cascade', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2840, -20], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions', filters: byRowId('={{ $json.row_id }}'),
      columns: cols({
        status: '={{ $json.status }}',
        error: '={{ $json.error }}',
      }), options: {} } },

  { id: 'cd-toggleres', name: 'Toggle Result', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [3060, 60], parameters: { jsCode: read('build/toggle-result.js') } },

  { id: 'if-add', name: 'Add Board?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, 400], parameters: ifString('={{ $json._kind }}', 'addboard') },

  { id: 'dt-add', name: 'Insert Board', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 320], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.boards),
      columns: cols({
        board_slug: '={{ $json.board_slug }}',
        name: '={{ $json.name }}',
        rss_url: '={{ $json.rss_url }}',
        enabled: '={{ false }}',
        priority: '={{ $json.priority }}',
        last_synced_at: '={{ null }}',
      }), options: {} },
    notes: 'New boards start disabled by design.' },

  { id: 'if-resched', name: 'Reschedule?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, 640], parameters: ifString('={{ $json._kind }}', 'reschedule') },

  { id: 'dt-resched', name: 'Update Entry', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 560], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions', filters: byRowId('={{ $json.row_id }}'),
      columns: cols({
        scheduled_at: '={{ $json.scheduled_at }}',
        status: '={{ $json.status }}',
        error: '',
        attempts: 0,
        last_attempt_at: '={{ null }}',
      }), options: {} },
    notes: 'A reschedule is a fresh start, so the old failure and attempt '
         + 'count are cleared.' },

  { id: 'dt-remove', name: 'Delete Entry', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 780], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'deleteRows',
      dataTableId: table(T.schedule), matchType: 'allConditions',
      filters: byRowId('={{ $json.row_id }}'), options: {} },
    notes: 'The listing becomes eligible again on the next run of Workflow B.' },

  { id: 'cd-writeres', name: 'Write Result', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [2620, 560], parameters: { jsCode: read('build/write-result.js') } },

  { id: 'form-answer', name: 'Show Answer', type: 'n8n-nodes-base.form',
    typeVersion: 2.5, position: [3300, -120],
    parameters: { operation: 'completion', respondWith: 'text',
      completionTitle: '={{ $json.title }}',
      completionMessage: '={{ $json.text }}',
      options: {} } },
];

const m = (node, index = 0) => ({ node, type: 'main', index });
const connections = {
  'Control Form': { main: [[m('Load Config')]] },
  'Load Config': { main: [[m('Config')]] },
  Config: { main: [[m('Load Boards')]] },
  'Load Boards': { main: [[m('Boards Loaded')]] },
  'Boards Loaded': { main: [[m('Load Items')]] },
  'Load Items': { main: [[m('Items Loaded')]] },
  'Items Loaded': { main: [[m('Load Schedule')]] },
  'Load Schedule': { main: [[m('Parse Request')]] },
  'Parse Request': { main: [[m('Answer?')]] },

  // A chain of IFs rather than a Switch: each branch stays readable on the
  // canvas, and an unmatched kind falls through to the remove branch, which
  // is the only kind left by then.
  'Answer?': { main: [[m('Show Answer')], [m('Toggle?')]] },
  'Toggle?': { main: [[m('Update Board Enabled')], [m('Add Board?')]] },
  'Update Board Enabled': { main: [[m('Cascade Plan')]] },
  'Cascade Plan': { main: [[m('Any Cascade?')]] },
  'Any Cascade?': { main: [[m('Apply Cascade')], [m('Toggle Result')]] },
  'Apply Cascade': { main: [[m('Toggle Result')]] },
  'Toggle Result': { main: [[m('Show Answer')]] },

  'Add Board?': { main: [[m('Insert Board')], [m('Reschedule?')]] },
  'Insert Board': { main: [[m('Write Result')]] },
  'Reschedule?': { main: [[m('Update Entry')], [m('Delete Entry')]] },
  'Update Entry': { main: [[m('Write Result')]] },
  'Delete Entry': { main: [[m('Write Result')]] },
  'Write Result': { main: [[m('Show Answer')]] },
};

const workflow = {
  name: 'D - Control',
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'Europe/Belgrade',
    saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all',
    saveManualExecutions: true },
};

fs.writeFileSync(path.join(ROOT, 'workflows/D-control.json'),
  JSON.stringify(workflow, null, 2) + '\n');

const names = new Set(nodes.map((n) => n.name));
const dangling = [];
for (const [src, c] of Object.entries(connections)) {
  if (!names.has(src)) dangling.push('source ' + src);
  for (const br of c.main) for (const tgt of br || []) {
    if (!names.has(tgt.node)) dangling.push(src + ' -> ' + tgt.node);
  }
}
if (dangling.length) {
  console.error('DANGLING CONNECTIONS:\n  ' + dangling.join('\n  '));
  process.exit(1);
}
console.log(`wrote workflows/D-control.json  (${nodes.length} nodes, `
  + `${Object.keys(connections).length} wired, graph intact)`);
