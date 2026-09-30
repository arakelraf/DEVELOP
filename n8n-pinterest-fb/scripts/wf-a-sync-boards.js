/**
 * Emits workflows/A-sync-boards.json  -  "A - Sync Boards".
 *
 * Three phases, run sequentially in one execution:
 *
 *   1. read every board's RSS feed and record each pin in `pins`
 *   2. resolve pins that have no Etsy link yet by fetching the pin page
 *   3. collapse resolved pins into `items`, one row per Etsy listing
 *
 * Phase 2 exists because Pinterest's board RSS does not publish a pin's
 * outbound link - verified on a real board, 26 pins, 0 links. This whole
 * workflow is the Pinterest source layer; B/C/D never see a Pinterest field.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const T = {
  boards: 'eHP9QfDm4Ay8F0HE',
  items: 'JaT1fvUeN6R77Pg2',
  config: 'Fzx5awBGnmaDaffF',
  errors: 'VahesI6mpjXmcBX5',
  pins: 'HBshV0j15En0ZX6S',
};

const table = (id) => ({ __rl: true, mode: 'id', value: id });

/** Data-table filter helper: all conditions must match. */
const where = (pairs) => ({
  conditions: pairs.map(([keyName, keyValue], i) => ({
    id: `c${i}`, keyName, condition: 'eq', keyValue,
  })),
});

/** resourceMapper payload for insert/update/upsert column values. */
const cols = (value) => ({ mappingMode: 'defineBelow', value, matchingColumns: [], schema: [] });

/** IF node comparing an expression to a literal string. */
const ifString = (left, right) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'loose' },
    combinator: 'and',
    conditions: [{
      id: 'c0', leftValue: left, rightValue: right,
      operator: { type: 'string', operation: 'equals' },
    }],
  },
  options: {},
});

const headCheck = (urlExpr) => ({
  method: 'HEAD',
  url: urlExpr,
  sendHeaders: true,
  headerParameters: { parameters: [{
    name: 'User-Agent',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      + ' (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  }] },
  options: {
    timeout: 15000,
    response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
  },
});

const nodes = [];
const push = (n) => { nodes.push(n); return n; };

// ---------------------------------------------------------------- stickies
push({ id: 'sn-overview', name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1, position: [-620, -420], parameters: { width: 520, height: 400, color: 3,
  content: [
    '## A - Sync Boards',
    '',
    'Runs every 6 hours, or on demand. **Collects data only - never posts.**',
    '',
    '**Phase 1** read each board\'s RSS, record every pin in `pins`.',
    '**Phase 2** pins have no Etsy link in RSS, so fetch the pin page and',
    'recover it (capped by `PIN_RESOLVE_MAX_PER_RUN`).',
    '**Phase 3** collapse resolved pins into `items`, one row per listing.',
    '',
    'Every board is synced **whether enabled or not** - `enabled` controls',
    'publishing (Workflow B), not collection, so enabling a board later',
    'already has a backlog.',
    '',
    'A dead board is logged to `errors_log` and the others carry on.',
  ].join('\n') } });

push({ id: 'sn-isolation', name: 'Sticky Note1', type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1, position: [-620, 40], parameters: { width: 520, height: 260, color: 4,
  content: [
    '### Source isolation',
    '',
    'This workflow is the **only** Pinterest-aware part of the system.',
    'It writes `items` keyed on `etsy_listing_id`, and `pins` as its own',
    'private cache.',
    '',
    'Workflows B, C and D read `items`/`schedule` and never reference a pin,',
    'a board RSS URL or an i.pinimg.com address. Replacing this workflow with',
    'the Etsy API leaves them untouched.',
  ].join('\n') } });

// ------------------------------------------------------------------ phase 0
push({ id: 'trg-cron', name: 'Every 6 Hours', type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.2, position: [-40, -200],
  parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 6 }] } } });

push({ id: 'trg-manual', name: 'Manual Sync', type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1, position: [-40, -40], parameters: {} });

push({ id: 'dt-config', name: 'Load Config', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [200, -120],
  parameters: { resource: 'row', operation: 'get', dataTableId: table(T.config),
    matchType: 'allConditions', filters: {}, returnAll: true },
  alwaysOutputData: true });

push({ id: 'cd-config', name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [420, -120], parameters: { jsCode: read('build/config-map.js') },
  notes: 'Flattens the config table and applies defaults for missing keys.' });

push({ id: 'dt-boards', name: 'Load Boards', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [640, -120],
  parameters: { resource: 'row', operation: 'get', dataTableId: table(T.boards),
    matchType: 'allConditions', filters: {}, returnAll: true },
  alwaysOutputData: true,
  notes: 'All boards, enabled or not - enabled gates publishing, not collection.' });

push({ id: 'cd-boards', name: 'Boards To Sync', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [860, -120],
  parameters: { jsCode: read('build/boards-to-sync.js') } });

push({ id: 'if-boards', name: 'Have Boards?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
  position: [1080, -120], parameters: ifString('={{ $json._kind }}', 'board') });

// ------------------------------------------------------------------ phase 1
push({ id: 'loop-boards', name: 'Loop Boards', type: 'n8n-nodes-base.splitInBatches',
  typeVersion: 3, position: [1300, -220], parameters: { batchSize: 1, options: {} },
  notes: 'One board at a time, so a feed error is attributable to its board.' });

push({ id: 'cd-current', name: 'Current Board', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [1540, -220],
  parameters: { jsCode:
    '// Passthrough for the board currently being iterated.\n'
    + '//\n'
    + '// Exists so downstream nodes can reference ONE stable, single-item\n'
    + '// node instead of $(\'Loop Boards\'), which does not resolve from\n'
    + '// branches that sit behind a data-table write (item lineage is lost\n'
    + '// there, and .first() returns undefined).\n'
    + '// Mode: Run Once for All Items.\n\n'
    + 'const b = $input.first().json;\n'
    + 'return [{ json: { ...b, last_synced_at: new Date().toISOString() } }];\n' },
  notes: 'Stable single-item reference for the rest of the iteration.' });

push({ id: 'rss', name: 'Read Board RSS', type: 'n8n-nodes-base.rssFeedRead',
  typeVersion: 1.2, position: [1540, -120],
  parameters: { url: "={{ $('Current Board').first().json.rss_url }}",
    options: { ignoreSSL: false } },
  onError: 'continueRegularOutput', retryOnFail: true, maxTries: 3,
  waitBetweenTries: 3000, alwaysOutputData: true,
  notes: 'Continues on error: a renamed or secret board is logged, not fatal.' });

push({ id: 'cd-parse', name: 'Parse Pins To Rows', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [1760, -120],
  parameters: { jsCode: read('build/parse-pins-to-rows.js') },
  notes: 'RSS items -> pins rows + log rows. Only Pinterest-aware code here.' });

push({ id: 'if-kind', name: 'Pin Or Log?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
  position: [1980, -120], parameters: ifString('={{ $json._kind }}', 'pin') });

push({ id: 'dt-newpins', name: 'New Pins Only', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [2200, -220],
  parameters: { resource: 'row', operation: 'rowNotExists', dataTableId: table(T.pins),
    matchType: 'allConditions', filters: where([['pin_id', '={{ $json.pin_id }}']]) },
  notes: 'Passes through only pins we have never seen, so an already-resolved '
       + 'pin is never reset to status=new. No alwaysOutputData: zero new '
       + 'pins must mean zero inserts, not one blank row.' });

push({ id: 'dt-insertpin', name: 'Insert Pin', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [2420, -220],
  parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.pins),
    columns: cols({
      pin_id: '={{ $json.pin_id }}',
      pin_url: '={{ $json.pin_url }}',
      board_slug: '={{ $json.board_slug }}',
      title: '={{ $json.title }}',
      description: '={{ $json.description }}',
      image_url: '={{ $json.image_url }}',
      image_candidates: '={{ $json.image_candidates }}',
      etsy_listing_id: '={{ $json.etsy_listing_id }}',
      resolve_status: '={{ $json.resolve_status }}',
      resolve_error: '={{ $json.resolve_error }}',
      resolve_attempts: '={{ $json.resolve_attempts }}',
      first_seen_at: '={{ $json.first_seen_at }}',
      resolved_at: '={{ $json.resolved_at }}',
    }), options: { optimizeBulk: true } } });

push({ id: 'dt-noboards', name: 'Write No Boards Log', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [1300, 40],
  parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.errors),
    columns: cols({
      workflow: '={{ $json.workflow }}',
      level: '={{ $json.level }}',
      context: '={{ $json.context }}',
      message: '={{ $json.message }}',
      created_at: '={{ $json.created_at }}',
    }) },
  alwaysOutputData: true,
  notes: 'Only reached when the boards table has nothing usable. Phase 2 '
       + 'still runs, since pins may be waiting from an earlier sync.' });

push({ id: 'dt-boardlog', name: 'Write Board Log', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [2200, 20],
  parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.errors),
    columns: cols({
      workflow: '={{ $json.workflow }}',
      level: '={{ $json.level }}',
      context: '={{ $json.context }}',
      message: '={{ $json.message }}',
      created_at: '={{ $json.created_at }}',
    }) },
  alwaysOutputData: true });


push({ id: 'dt-touch', name: 'Touch Board', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [1760, -320],
  parameters: { resource: 'row', operation: 'update', dataTableId: table(T.boards),
    matchType: 'allConditions',
    filters: where([['board_slug', '={{ $json.board_slug }}']]),
    columns: cols({ last_synced_at: '={{ $json.last_synced_at }}' }), options: {} },
  alwaysOutputData: true, onError: 'continueRegularOutput' });

// ------------------------------------------------------------------ phase 2
push({ id: 'sn-phase2', name: 'Sticky Note2', type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1, position: [1280, 240], parameters: { width: 500, height: 240, color: 5,
  content: [
    '### Phase 2 - recover the Etsy link',
    '',
    'Pinterest RSS carries no outbound link, so it is read from the pin page,',
    'where Pinterest embeds it in hydration JSON.',
    '',
    'Each page is ~1MB, so only `resolve_status=new` pins are fetched, capped',
    'by `PIN_RESOLVE_MAX_PER_RUN` and spaced by `RESOLVE_THROTTLE_MS`.',
    '`ok`, `not_etsy` and `failed` are terminal - never re-fetched.',
  ].join('\n') } });

push({ id: 'dt-pending', name: 'Load Pending Pins', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [1540, 380],
  parameters: { resource: 'row', operation: 'get', dataTableId: table(T.pins),
    matchType: 'allConditions',
    filters: where([['resolve_status', 'new']]), returnAll: true },
  alwaysOutputData: true });

push({ id: 'cd-pending', name: 'Pins To Resolve', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [1760, 380],
  parameters: { jsCode: read('build/pins-to-resolve.js') } });

push({ id: 'if-resolve', name: 'Anything To Resolve?', type: 'n8n-nodes-base.if',
  typeVersion: 2.2, position: [1980, 380],
  parameters: ifString('={{ $json._kind }}', 'none'),
  notes: 'TRUE branch means nothing to do - skip straight to the summary.' });

push({ id: 'http-pin', name: 'Fetch Pin Page', type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2, position: [2200, 480],
  parameters: {
    url: '={{ $json.pin_url }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
      { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      { name: 'Accept-Language', value: 'en-US,en;q=0.9' },
    ] },
    options: {
      timeout: 25000,
      redirect: { redirect: { followRedirects: true, maxRedirects: 5 } },
      // One request at a time, spaced by the configured throttle.
      batching: { batch: { batchSize: 1,
        batchInterval: "={{ $('Config').first().json._throttle_ms }}" } },
      response: { response: { responseFormat: 'text', outputPropertyName: 'data',
        neverError: true, fullResponse: true } },
    },
  },
  onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2,
  waitBetweenTries: 5000, alwaysOutputData: true,
  notes: 'Browser-like headers; neverError so a 403/429 is recorded, not fatal.' });

push({ id: 'cd-resolve', name: 'Resolve Pin Result', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [2420, 480],
  parameters: { jsCode: read('build/resolve-pin-result.js') } });

push({ id: 'dt-updatepin', name: 'Update Pin', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [2640, 480],
  parameters: { resource: 'row', operation: 'update', dataTableId: table(T.pins),
    matchType: 'allConditions', filters: where([['pin_id', '={{ $json.pin_id }}']]),
    columns: cols({
      etsy_listing_id: '={{ $json.etsy_listing_id }}',
      resolve_status: '={{ $json.resolve_status }}',
      resolve_error: '={{ $json.resolve_error }}',
      resolve_attempts: '={{ $json.resolve_attempts }}',
      resolved_at: '={{ $json.resolved_at }}',
    }), options: {} },
  alwaysOutputData: true });

// ------------------------------------------------------------------ phase 3
push({ id: 'cd-group', name: 'Group By Listing', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [2860, 480],
  parameters: { jsCode: read('build/group-by-listing.js') },
  notes: 'One item per Etsy listing, board_slugs merged - never a duplicate.' });

push({ id: 'if-listings', name: 'Have Listings?', type: 'n8n-nodes-base.if',
  typeVersion: 2.2, position: [3080, 480],
  parameters: ifString('={{ $json._kind }}', 'listing') });

push({ id: 'loop-listings', name: 'Loop Listings', type: 'n8n-nodes-base.splitInBatches',
  typeVersion: 3, position: [3300, 380], parameters: { batchSize: 1, options: {} } });

push({ id: 'dt-getitem', name: 'Get Existing Item', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [3520, 480],
  parameters: { resource: 'row', operation: 'get', dataTableId: table(T.items),
    matchType: 'allConditions',
    filters: where([['etsy_listing_id', '={{ $json.etsy_listing_id }}']]),
    returnAll: false, limit: 1 },
  alwaysOutputData: true });

push({ id: 'cd-merge', name: 'Merge Item', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [3740, 480], parameters: { jsCode: read('build/merge-item.js') },
  notes: 'Additive merge of board_slugs and pin_urls onto any existing row.' });

// Three HEAD checks, run unconditionally. HEAD transfers no body and newly
// resolved listings are rare, so this is cheaper than branching.
// Measured on real pins: originals/*.jpg 403s, originals/*.png is the true
// original (~850KB), 1200x and 736x are byte-identical (~110KB).
[1, 2, 3].forEach((n) => {
  push({ id: `http-img${n}`, name: `Verify Image ${n}`,
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [3960 + (n - 1) * 220, 480],
    parameters: headCheck(`={{ $('Merge Item').first().json.image_c${n} }}`),
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: n === 1 ? 'HEAD only - no body transferred.' : undefined });
});

push({ id: 'cd-pick', name: 'Pick Image', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [4620, 480], parameters: { jsCode: read('build/pick-image.js') },
  notes: 'Highest resolution that answered 200.' });

push({ id: 'dt-upsertitem', name: 'Upsert Item', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [4840, 480],
  parameters: { resource: 'row', operation: 'upsert', dataTableId: table(T.items),
    matchType: 'allConditions',
    filters: where([['etsy_listing_id', '={{ $json.etsy_listing_id }}']]),
    columns: cols({
      etsy_listing_id: '={{ $json.etsy_listing_id }}',
      etsy_url: '={{ $json.etsy_url }}',
      title: '={{ $json.title }}',
      description: '={{ $json.description }}',
      image_url: '={{ $json.image_url }}',
      board_slugs: '={{ $json.board_slugs }}',
      pin_urls: '={{ $json.pin_urls }}',
      first_seen_at: '={{ $json.first_seen_at }}',
      last_seen_at: '={{ $json.last_seen_at }}',
    }), options: {} },
  alwaysOutputData: true });

// ----------------------------------------------------------------- summary
push({ id: 'cd-summary', name: 'Sync Summary', type: 'n8n-nodes-base.code',
  typeVersion: 2, position: [3520, 200],
  parameters: { jsCode: read('build/sync-summary.js') } });

push({ id: 'dt-summarylog', name: 'Write Summary Log', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: [3740, 200],
  parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.errors),
    columns: cols({
      workflow: 'A - Sync Boards',
      level: 'info',
      context: '=sync_summary',
      message: '={{ JSON.stringify($json) }}',
      created_at: '={{ $json.finished_at }}',
    }) },
  alwaysOutputData: true });

// ------------------------------------------------------------- connections
const m = (node, index = 0) => ({ node, type: 'main', index });

const connections = {
  'Every 6 Hours': { main: [[m('Load Config')]] },
  'Manual Sync': { main: [[m('Load Config')]] },
  'Load Config': { main: [[m('Config')]] },
  Config: { main: [[m('Load Boards')]] },
  'Load Boards': { main: [[m('Boards To Sync')]] },
  'Boards To Sync': { main: [[m('Have Boards?')]] },
  // true = a real board -> sync loop; false = the "no boards" log row
  'Have Boards?': { main: [[m('Loop Boards')], [m('Write No Boards Log')]] },
  'Write No Boards Log': { main: [[m('Load Pending Pins')]] },

  // splitInBatches: output 0 = done, output 1 = next batch
  'Loop Boards': { main: [[m('Load Pending Pins')], [m('Current Board')]] },
  // last_synced_at is stamped at the START of the iteration, so it records
  // the attempt even when the feed then 404s.
  'Current Board': { main: [[m('Touch Board')]] },
  'Touch Board': { main: [[m('Read Board RSS')]] },
  'Read Board RSS': { main: [[m('Parse Pins To Rows')]] },
  'Parse Pins To Rows': { main: [[m('Pin Or Log?')]] },
  'Pin Or Log?': { main: [[m('New Pins Only')], [m('Write Board Log')]] },
  'New Pins Only': { main: [[m('Insert Pin')]] },
  // Both branches loop back; the summary log row always exists, so the loop
  // advances even for a board that yielded no new pins.
  'Insert Pin': { main: [[m('Loop Boards')]] },
  'Write Board Log': { main: [[m('Loop Boards')]] },

  'Load Pending Pins': { main: [[m('Pins To Resolve')]] },
  'Pins To Resolve': { main: [[m('Anything To Resolve?')]] },
  // true = _kind is 'none' -> nothing to resolve
  'Anything To Resolve?': { main: [[m('Sync Summary')], [m('Fetch Pin Page')]] },
  'Fetch Pin Page': { main: [[m('Resolve Pin Result')]] },
  'Resolve Pin Result': { main: [[m('Update Pin')]] },
  'Update Pin': { main: [[m('Group By Listing')]] },
  'Group By Listing': { main: [[m('Have Listings?')]] },
  'Have Listings?': { main: [[m('Loop Listings')], [m('Sync Summary')]] },
  'Loop Listings': { main: [[m('Sync Summary')], [m('Get Existing Item')]] },
  'Get Existing Item': { main: [[m('Merge Item')]] },
  'Merge Item': { main: [[m('Verify Image 1')]] },
  'Verify Image 1': { main: [[m('Verify Image 2')]] },
  'Verify Image 2': { main: [[m('Verify Image 3')]] },
  'Verify Image 3': { main: [[m('Pick Image')]] },
  'Pick Image': { main: [[m('Upsert Item')]] },
  'Upsert Item': { main: [[m('Loop Listings')]] },
  'Sync Summary': { main: [[m('Write Summary Log')]] },
};

// A temporary webhook trigger, added only with --test-trigger, so the whole
// workflow can be driven deterministically from a script instead of waiting
// for the 6-hour cron. Re-deploy without the flag to remove it.
const TEST_TRIGGER = process.argv.includes('--test-trigger');
if (TEST_TRIGGER) {
  nodes.push({
    id: 'trg-test', name: 'Test Trigger', type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1, position: [-40, 120],
    parameters: { httpMethod: 'POST', path: 'sync-boards-test',
                  responseMode: 'lastNode', options: {} },
    notes: 'TEMPORARY - remove before going live.',
  });
  connections['Test Trigger'] = { main: [[m('Load Config')]] };
}

const workflow = {
  name: 'A - Sync Boards',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'Europe/Belgrade',
    // Pin pages are ~1MB each; do not persist them on scheduled runs.
    // During a test run we keep everything so the output can be inspected.
    saveDataSuccessExecution: TEST_TRIGGER ? 'all' : 'none',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
  },
};

fs.writeFileSync(path.join(ROOT, 'workflows/A-sync-boards.json'),
  JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote workflows/A-sync-boards.json  (${nodes.length} nodes, `
  + `${Object.keys(connections).length} wired)`);
