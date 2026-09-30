/**
 * Emits workflows/B-build-schedule.json  -  "B - Build Schedule".
 *
 * Runs daily after the sync, or on demand. Takes items belonging to at least
 * one ENABLED board, refuses to queue a listing twice, respects the repost
 * cooldown, spreads what is left over the configured slots with the boards
 * rotating by priority, writes the caption, and reports everything it chose
 * not to do.
 *
 * Source-agnostic: reads `items` and `schedule`, keyed on etsy_listing_id.
 * Knows nothing about Pinterest.
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
  errors: 'VahesI6mpjXmcBX5',
};
const table = (id) => ({ __rl: true, mode: 'id', value: id });
const cols = (value) => ({ mappingMode: 'defineBelow', value, matchingColumns: [], schema: [] });
const ifString = (left, right) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'loose' },
    combinator: 'and',
    conditions: [{ id: 'c0', leftValue: left, rightValue: right,
      operator: { type: 'string', operation: 'equals' } }],
  },
  options: {},
});

/**
 * A data-table `get` runs once per input item, so feeding it N items would
 * return the table N times. These gates collapse a branch to one item; the
 * loaded rows stay reachable through $('Load X').all().
 */
const gate = (id, name, x, y, what) => ({
  id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
  parameters: { jsCode:
    `// Collapses the branch to ONE item so the next data-table read runs\n`
    + `// once. The ${what} stay available via $('${what}').all() downstream.\n`
    + '// Mode: Run Once for All Items.\n\n'
    + `return [{ json: { loaded: $input.all().length } }];\n` },
  alwaysOutputData: true,
  notes: 'Single-item gate - keeps the next table read from running N times.',
});

const nodes = [
  { id: 'sn-b', name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-620, -320], parameters: { width: 520, height: 400, color: 6, content: [
      '## B - Build Schedule',
      '',
      'Daily at 07:47 Europe/Belgrade (after the 6-hourly sync), or on demand.',
      '',
      'Only items on an **enabled** board are considered. A listing already in',
      'the queue is reported, never queued twice. A listing posted less than',
      '`REPOST_AFTER_DAYS` ago waits.',
      '',
      'Slots come from `SLOTS` in config (now 10:00/15:00/20:00). Boards',
      'rotate by `priority` so the same board never posts back to back.',
      '',
      'Captions are built from the pin text (`TEXT_MODE=pinterest`). Pinterest',
      'puts the same block in title AND description, so they are',
      'de-duplicated, then trimmed to `POST_TEXT_MAX_CHARS` on a sentence',
      'boundary, with the Etsy link last.',
    ].join('\n') } },

  { id: 'sn-b2', name: 'Sticky Note1', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-620, 120], parameters: { width: 520, height: 220, color: 4, content: [
      '### Why the "gate" nodes exist',
      '',
      'An n8n data-table `get` executes **once per input item**. Chaining three',
      'reads directly would make the second return the table once per row of',
      'the first, and the third once per row of the second.',
      '',
      'Each gate collapses its branch to a single item. The rows stay',
      'reachable by name: `$(\'Load Items\').all()`.',
    ].join('\n') } },

  { id: 'trg-daily', name: 'Daily At 07:47', type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2, position: [-40, -200],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '47 7 * * *' }] } },
    notes: 'Off the hour on purpose: :00 is the busiest minute on any scheduler.' },

  { id: 'trg-manual', name: 'Manual Build', type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1, position: [-40, -40], parameters: {} },

  { id: 'dt-config', name: 'Load Config', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [200, -120], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: table(T.config),
      matchType: 'allConditions', filters: {}, returnAll: true } },

  { id: 'cd-config', name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [420, -120], parameters: { jsCode: read('build/config-map.js') } },

  { id: 'dt-boards', name: 'Load Boards', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [640, -120], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: table(T.boards),
      matchType: 'allConditions', filters: {}, returnAll: true } },

  gate('gt-boards', 'Boards Loaded', 860, -120, 'Load Boards'),

  { id: 'dt-items', name: 'Load Items', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [1080, -120], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: table(T.items),
      matchType: 'allConditions', filters: {}, returnAll: true } },

  gate('gt-items', 'Items Loaded', 1300, -120, 'Load Items'),

  { id: 'dt-sched', name: 'Load Schedule', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [1520, -120], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: table(T.schedule),
      matchType: 'allConditions', filters: {}, returnAll: true } },

  { id: 'cd-plan', name: 'Plan Schedule', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1740, -120], parameters: { jsCode: read('build/plan-schedule.js') },
    notes: 'All the queueing rules. Unit-tested in src/scheduler.test.js and '
         + 'src/post-text.test.js (52 cases).' },

  { id: 'if-kind', name: 'New Queue Row?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, -120], parameters: ifString('={{ $json._kind }}', 'queue'),
    notes: 'TRUE = a listing with no schedule row yet -> insert.' },

  { id: 'if-kind2', name: 'Repost Or Report?', type: 'n8n-nodes-base.if',
    typeVersion: 2.2, position: [1960, 120],
    parameters: ifString('={{ $json._kind }}', 'requeue'),
    notes: 'TRUE = a listing past its repost cooldown -> UPDATE its existing '
         + 'row. schedule.etsy_listing_id is unique, so a repost must reuse '
         + 'the row rather than add a second one.' },

  { id: 'dt-insert', name: 'Insert Queue Row', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, -220],
    parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.schedule),
      columns: cols({
        etsy_listing_id: '={{ $json.etsy_listing_id }}',
        board_slug: '={{ $json.board_slug }}',
        scheduled_at: '={{ $json.scheduled_at }}',
        status: '={{ $json.status }}',
        fb_post_id: '={{ $json.fb_post_id }}',
        post_text: '={{ $json.post_text }}',
        error: '={{ $json.error }}',
        attempts: 0,
        created_at: '={{ $json.created_at }}',
        posted_at: '={{ $json.posted_at }}',
      }), options: {} },
    notes: 'No alwaysOutputData: zero planned posts must mean zero rows.' },

  { id: 'dt-update', name: 'Update Queue Row', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 20],
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions',
      filters: { conditions: [{ id: 'c0', keyName: 'id', condition: 'eq',
        keyValue: '={{ $json.requeue_row_id }}' }] },
      columns: cols({
        board_slug: '={{ $json.board_slug }}',
        scheduled_at: '={{ $json.scheduled_at }}',
        status: '={{ $json.status }}',
        post_text: '={{ $json.post_text }}',
        fb_post_id: '',
        fb_media_id: '',
        error: '',
        attempts: 0,
        posted_at: '={{ null }}',
        last_attempt_at: '={{ null }}',
      }), options: {} },
    notes: 'Resets a served-cooldown row back to queued and clears the old '
         + 'Facebook id, error and posted_at.' },

  { id: 'dt-log', name: 'Write Build Log', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 260], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.errors),
      columns: cols({
        workflow: '={{ $json.workflow }}',
        level: '={{ $json.level }}',
        context: '={{ $json.context }}',
        message: '={{ JSON.stringify($json) }}',
        created_at: '={{ $json.created_at }}',
      }) },
    notes: 'The full report, including the explicit "already scheduled" list.' },
];

const m = (node, index = 0) => ({ node, type: 'main', index });
const connections = {
  'Daily At 07:47': { main: [[m('Load Config')]] },
  'Manual Build': { main: [[m('Load Config')]] },
  'Load Config': { main: [[m('Config')]] },
  Config: { main: [[m('Load Boards')]] },
  'Load Boards': { main: [[m('Boards Loaded')]] },
  'Boards Loaded': { main: [[m('Load Items')]] },
  'Load Items': { main: [[m('Items Loaded')]] },
  'Items Loaded': { main: [[m('Load Schedule')]] },
  'Load Schedule': { main: [[m('Plan Schedule')]] },
  'Plan Schedule': { main: [[m('New Queue Row?')]] },
  'New Queue Row?': { main: [[m('Insert Queue Row')], [m('Repost Or Report?')]] },
  'Repost Or Report?': { main: [[m('Update Queue Row')], [m('Write Build Log')]] },
};

const TEST_TRIGGER = process.argv.includes('--test-trigger');
if (TEST_TRIGGER) {
  nodes.push({ id: 'trg-test', name: 'Test Trigger', type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1, position: [-40, 120],
    parameters: { httpMethod: 'POST', path: 'build-schedule-test',
                  responseMode: 'lastNode', options: {} },
    notes: 'TEMPORARY - removed when deployed without --test-trigger.' });
  connections['Test Trigger'] = { main: [[m('Load Config')]] };
}

const workflow = {
  name: 'B - Build Schedule',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1', timezone: 'Europe/Belgrade',
    // Crashes go to "E - Error Handler", which writes them to errors_log.
    errorWorkflow: 'PvlehC1HppyNUe9b',
    saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all',
    saveManualExecutions: true },
};

fs.writeFileSync(path.join(ROOT, 'workflows/B-build-schedule.json'),
  JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote workflows/B-build-schedule.json  (${nodes.length} nodes)`);
