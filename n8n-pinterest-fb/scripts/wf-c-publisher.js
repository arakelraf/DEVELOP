/**
 * Emits workflows/C-publisher.json  -  "C - Publisher".
 *
 * Hands queued posts to Facebook. Two shapes, chosen per row:
 *   scheduled  published=false + scheduled_publish_time; Facebook publishes it
 *   immediate  the slot has already arrived, so publish now
 *
 * A scheduled photo post is a two-step Graph operation: upload the photo
 * unpublished to get a media id, then create the feed post with that
 * attachment and the publish time.
 *
 * DRY_RUN in the config table is ON by default, so the whole path can be
 * exercised - selection, atomic claim, request building - with no token and
 * without touching the Page.
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
// The OAuth credential holds the USER token granted by the login dialog.
// It is used for exactly one call - /me/accounts - which derives the PAGE
// token that the publish calls then carry as a header.
const FB_OAUTH = { id: 'gew3mnOJy0FEybxs', name: 'Facebook OAuth (login)' };

const table = (id) => ({ __rl: true, mode: 'id', value: id });
const cols = (value) => ({ mappingMode: 'defineBelow', value, matchingColumns: [], schema: [] });
const opts = { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'loose' };

const ifString = (left, right) => ({
  conditions: { options: opts, combinator: 'and', conditions: [{ id: 'c0',
    leftValue: left, rightValue: right,
    operator: { type: 'string', operation: 'equals' } }] },
  options: {},
});
const ifTrue = (left) => ({
  conditions: { options: opts, combinator: 'and', conditions: [{ id: 'c0',
    leftValue: left, rightValue: true,
    operator: { type: 'boolean', operation: 'true', singleValue: true } }] },
  options: {},
});
const ifNotEmpty = (left) => ({
  conditions: { options: opts, combinator: 'and', conditions: [{ id: 'c0',
    leftValue: left, rightValue: '',
    operator: { type: 'string', operation: 'notEmpty', singleValue: true } }] },
  options: {},
});

const dtGet = (id, name, x, y, tableId, extra = {}) => ({
  id, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [x, y],
  alwaysOutputData: true,
  parameters: { resource: 'row', operation: 'get', dataTableId: table(tableId),
    matchType: 'allConditions', filters: {}, returnAll: true, ...extra },
});

const gate = (id, name, x, y, what) => ({
  id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
  parameters: { jsCode:
    '// Collapses the branch to ONE item so the next data-table read runs\n'
    + '// once. Rows stay reachable via $(\'' + what + '\').all().\n'
    + '// Mode: Run Once for All Items.\n\n'
    + 'return [{ json: { loaded: $input.all().length } }];\n' },
  alwaysOutputData: true,
  notes: 'Single-item gate - keeps the next table read from running N times.',
});

const logRow = (id, name, x, y, ctx, level, note) => ({
  id, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [x, y],
  alwaysOutputData: true,
  parameters: { resource: 'row', operation: 'insert', dataTableId: table(T.errors),
    columns: cols({
      workflow: 'C - Publisher', level, context: ctx,
      message: '={{ JSON.stringify($json) }}',
      created_at: '={{ $now.toISO() }}',
    }) },
  notes: note,
});

const fbOAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'oAuth2Api',
};

/**
 * The Page token resolved at run time. Publish calls send it as a plain
 * Authorization header rather than through a credential, because it is
 * derived during the execution and is never stored anywhere.
 */
const PAGE_TOKEN = "={{ 'Bearer ' + $('Pick Page').first().json.page_token }}";
const fbResponse = {
  timeout: 30000,
  response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
};

const nodes = [
  { id: 'sn-c', name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-660, -420], parameters: { width: 540, height: 430, color: 3, content: [
      '## C - Publisher',
      '',
      'Runs every 30 minutes (:13 and :43) or on demand.',
      '',
      '**Scheduling is handed to Facebook.** A row more than 10 minutes out is',
      'sent with `published=false` + `scheduled_publish_time`, and Facebook',
      'publishes it at the slot, so n8n need not be awake at 10:00. A row',
      'whose slot already arrived is published immediately, so nothing is',
      'lost to downtime.',
      '',
      '**Login once, then it just runs.** Open the credential *Facebook OAuth',
      '(login)*, paste the App ID and Secret, and click **Connect my account**',
      '- Facebook\'s own login window opens. Nothing else to copy: each run',
      'derives the Page token from that login via `/me/accounts`, so',
      '`FB_PAGE_ID` is optional too.',
      '',
      '**DRY_RUN is ON by default.** Everything runs except the Facebook calls,',
      'and the exact request bodies land in `errors_log`. Set `DRY_RUN=false`',
      'in config when you are ready to post.',
      '',
      'Status flow: `queued` -> `posting` (claimed) -> `scheduled` (accepted by',
      'Facebook) or `posted` (published now) / `failed` / `skipped`.',
    ].join('\n') } },

  { id: 'sn-c2', name: 'Sticky Note1', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-660, 60], parameters: { width: 540, height: 310, color: 4, content: [
      '### Double-post protection',
      '',
      '`Claim Row` updates the row **only if its status is still what we read**',
      '(both `id` and `status` must match). If another run got there first,',
      'zero rows change, `Verify Claim` sees no updated row, and this run',
      'stops without calling Facebook.',
      '',
      'That is why the claim happens first, and why every HTTP node sits',
      'behind it.',
      '',
      '### Image fallback',
      '',
      'The photo is uploaded by URL first. If Facebook cannot fetch it',
      '(Pinterest hotlink protection), the bytes are downloaded in n8n and',
      'uploaded as a file instead.',
    ].join('\n') } },

  { id: 'trg-cron', name: 'Every 30 Minutes', type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2, position: [-40, -220],
    parameters: { rule: { interval: [{ field: 'cronExpression',
      expression: '13,43 * * * *' }] } },
    notes: 'Off :00/:30 deliberately - those are the busiest scheduler minutes.' },

  { id: 'trg-manual', name: 'Manual Publish', type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1, position: [-40, -60], parameters: {} },

  dtGet('dt-config', 'Load Config', 200, -140, T.config),
  { id: 'cd-config', name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [420, -140], parameters: { jsCode: read('build/config-map.js') } },

  { id: 'if-live', name: 'Live Mode?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [620, -140], parameters: ifTrue('={{ $json._dry_run === false }}'),
    notes: 'TRUE = really posting, so a Page token is needed. A dry run skips '
         + 'the Facebook calls entirely and needs no credential.' },

  { id: 'http-pages', name: 'FB List Pages', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [840, -320],
    parameters: {
      method: 'GET',
      url: "={{ 'https://graph.facebook.com/' + $('Config').first().json.FB_API_VERSION + '/me/accounts' }}",
      ...fbOAuth,
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'fields', value: 'id,name,access_token' },
      ] },
      options: fbResponse,
    },
    credentials: { oAuth2Api: FB_OAUTH },
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'The only call that uses the OAuth login. Turns the user token into '
         + 'a Page token.' },

  { id: 'cd-pickpage', name: 'Pick Page', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1060, -320], parameters: { jsCode: read('build/pick-page.js') },
    notes: 'Chooses the Page (by FB_PAGE_ID, or the only one on the account) '
         + 'and keeps its token in memory for this execution only.' },

  { id: 'if-pageok', name: 'Page Resolved?', type: 'n8n-nodes-base.if',
    typeVersion: 2.2, position: [1280, -320], parameters: ifTrue('={{ $json.ok }}') },

  logRow('dt-authlog', 'Log Auth Problem', 1500, -460, '=auth_problem', 'error',
    'Login or Page resolution failed. The message says which, and what to do.'),

  dtGet('dt-boards', 'Load Boards', 640, -140, T.boards),
  gate('gt-boards', 'Boards Loaded', 860, -140, 'Load Boards'),
  dtGet('dt-items', 'Load Items', 1080, -140, T.items),
  gate('gt-items', 'Items Loaded', 1300, -140, 'Load Items'),
  dtGet('dt-queue', 'Load Queue', 1520, -140, T.schedule),

  { id: 'cd-select', name: 'Select To Publish', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [1740, -140],
    parameters: { jsCode: read('build/select-to-publish.js') },
    notes: 'All the selection rules. Unit-tested in src/publisher.test.js (24 cases).' },

  { id: 'if-pub', name: 'To Publish?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, -140], parameters: ifString('={{ $json._kind }}', 'publish') },

  { id: 'if-skip', name: 'To Skip?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1960, 140], parameters: ifString('={{ $json._kind }}', 'skip') },

  { id: 'dt-applyskip', name: 'Apply Skip', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2180, 60], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions',
      filters: { conditions: [{ id: 'c0', keyName: 'id', condition: 'eq',
        keyValue: '={{ $json.row_id }}' }] },
      columns: cols({
        status: '={{ $json.status }}',
        error: '={{ $json.error }}',
        last_attempt_at: '={{ $now.toISO() }}',
      }), options: {} },
    notes: 'A disabled board or broken data is recorded on the row itself, '
         + 'not just in the log.' },

  // ------------------------------------------------------------ publish loop
  { id: 'loop-pub', name: 'Loop Publish', type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3, position: [2180, -240], parameters: { batchSize: 1, options: {} },
    notes: 'One post at a time: each needs its own claim before any HTTP call.' },

  { id: 'dt-claim', name: 'Claim Row', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [2400, -140], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions',
      filters: { conditions: [
        { id: 'c0', keyName: 'id', condition: 'eq', keyValue: '={{ $json.row_id }}' },
        // Both must match: if the status moved on, this run does not own the row.
        { id: 'c1', keyName: 'status', condition: 'eq',
          keyValue: '={{ $json.was_retry ? "failed" : "queued" }}' },
      ] },
      columns: cols({
        status: 'posting',
        attempts: '={{ $json.attempts }}',
        last_attempt_at: '={{ $now.toISO() }}',
      }), options: {} },
    notes: 'ATOMIC CLAIM. Matches on id AND current status, so a row already '
         + 'taken by another run updates zero rows.' },

  { id: 'cd-verify', name: 'Verify Claim', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [2620, -140], parameters: { jsCode: read('build/verify-claim.js') } },

  { id: 'if-claimed', name: 'Claimed?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [2840, -140], parameters: ifTrue('={{ $json.claimed }}') },

  logRow('dt-lostrace', 'Log Lost Race', 3060, 40, '=claim_lost', 'warn',
    'Another run owned the row. Not an error - this is the guard working.'),

  { id: 'if-dry', name: 'Dry Run?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [3060, -240], parameters: ifTrue('={{ $json.dry_run }}') },

  logRow('dt-dryrun', 'Log Dry Run', 3280, -380, '=dry_run', 'info',
    'What WOULD have been sent to Facebook, including the exact URLs and '
    + 'the scheduled publish time.'),

  { id: 'dt-release', name: 'Release Row', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [3500, -380], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions',
      filters: { conditions: [{ id: 'c0', keyName: 'id', condition: 'eq',
        keyValue: "={{ $('Verify Claim').first().json.row_id }}" }] },
      columns: cols({
        status: 'queued',
        // A dry run must not consume a retry attempt.
        attempts: "={{ $('Verify Claim').first().json.attempts - 1 }}",
        last_attempt_at: '={{ null }}',
      }), options: {} },
    notes: 'Puts the row back exactly as it was - a dry run costs no attempt.' },

  { id: 'http-photo-url', name: 'FB Upload Photo By URL',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3280, -140],
    parameters: {
      method: 'POST',
      url: '={{ $json.fb_photo_url }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: PAGE_TOKEN },
      ] },
      sendBody: true,
      bodyParameters: { parameters: [
        { name: 'url', value: '={{ $json.image_url }}' },
        // Unpublished: this only produces a media id to attach to the post.
        { name: 'published', value: 'false' },
      ] },
      options: fbResponse,
    },
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Step 1 of 2. Facebook fetches the image itself.' },

  { id: 'if-photook', name: 'Photo Uploaded?', type: 'n8n-nodes-base.if',
    typeVersion: 2.2, position: [3500, -140],
    parameters: ifNotEmpty('={{ $json.body && $json.body.id ? $json.body.id : "" }}') },

  { id: 'http-download', name: 'Download Image', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [3500, 200],
    parameters: {
      method: 'GET',
      url: "={{ $('Verify Claim').first().json.image_url }}",
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
          + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
        { name: 'Accept', value: 'image/avif,image/webp,image/*,*/*;q=0.8' },
        { name: 'Referer', value: 'https://www.pinterest.com/' },
      ] },
      options: { timeout: 45000,
        response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
    },
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Fallback: Facebook could not fetch the URL, so we fetch the bytes.' },

  { id: 'http-photo-bin', name: 'FB Upload Photo Binary',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3720, 200],
    parameters: {
      method: 'POST',
      url: "={{ $('Verify Claim').first().json.fb_photo_url }}",
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: PAGE_TOKEN },
      ] },
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: { parameters: [
        { parameterType: 'formBinaryData', name: 'source', inputDataFieldName: 'data' },
        { parameterType: 'formData', name: 'published', value: 'false' },
      ] },
      options: fbResponse,
    },
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Uploads the downloaded bytes as a file instead of a URL.' },

  { id: 'cd-media', name: 'Media Id', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [3940, 20], parameters: { jsCode: read('build/media-id.js') },
    notes: 'Reads the photo id from whichever upload path ran.' },

  { id: 'http-post', name: 'FB Create Post', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [4160, 20],
    parameters: {
      method: 'POST',
      url: '={{ $json.fb_feed_url }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: PAGE_TOKEN },
      ] },
      sendBody: true,
      bodyParameters: { parameters: [
        { name: 'message', value: '={{ $json.post_text }}' },
        { name: 'attached_media[0]',
          value: '={{ JSON.stringify({ media_fbid: $json.media_fbid }) }}' },
        { name: 'published', value: '={{ $json.fb_published ? "true" : "false" }}' },
        { name: 'scheduled_publish_time',
          value: '={{ $json.fb_scheduled_publish_time || "" }}' },
      ] },
      options: fbResponse,
    },
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Step 2 of 2. published=false + scheduled_publish_time makes '
         + 'Facebook publish it at the slot.' },

  { id: 'cd-result', name: 'Handle Result', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [4380, 20], parameters: { jsCode: read('build/handle-publish-result.js') },
    notes: 'Maps the Graph response (or its error) onto the row update.' },

  { id: 'dt-updaterow', name: 'Update Row', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [4600, 20], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'update', dataTableId: table(T.schedule),
      matchType: 'allConditions',
      filters: { conditions: [{ id: 'c0', keyName: 'id', condition: 'eq',
        keyValue: '={{ $json.row_id }}' }] },
      columns: cols({
        status: '={{ $json.status }}',
        fb_post_id: '={{ $json.fb_post_id }}',
        fb_media_id: '={{ $json.fb_media_id }}',
        error: '={{ $json.error }}',
        attempts: '={{ $json.attempts }}',
        last_attempt_at: '={{ $json.last_attempt_at }}',
        posted_at: '={{ $json.posted_at }}',
      }), options: {} } },

  { id: 'cd-summary', name: 'Publish Summary', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [2620, -420],
    parameters: { jsCode: read('build/publish-summary.js') } },

  logRow('dt-publog', 'Write Publish Log', 2840, -420, '={{ $json.context }}',
    '={{ $json.level }}', 'The run report, including every failure with its '
    + 'Graph API error message.'),
];

const m = (node, index = 0) => ({ node, type: 'main', index });
const connections = {
  'Every 30 Minutes': { main: [[m('Load Config')]] },
  'Manual Publish': { main: [[m('Load Config')]] },
  'Load Config': { main: [[m('Config')]] },
  // Live runs resolve a Page token first; a dry run goes straight on.
  Config: { main: [[m('Live Mode?')]] },
  'Live Mode?': { main: [[m('FB List Pages')], [m('Load Boards')]] },
  'FB List Pages': { main: [[m('Pick Page')]] },
  'Pick Page': { main: [[m('Page Resolved?')]] },
  'Page Resolved?': { main: [[m('Load Boards')], [m('Log Auth Problem')]] },
  'Load Boards': { main: [[m('Boards Loaded')]] },
  'Boards Loaded': { main: [[m('Load Items')]] },
  'Load Items': { main: [[m('Items Loaded')]] },
  'Items Loaded': { main: [[m('Load Queue')]] },
  'Load Queue': { main: [[m('Select To Publish')]] },
  'Select To Publish': { main: [[m('To Publish?')]] },
  'To Publish?': { main: [[m('Loop Publish')], [m('To Skip?')]] },
  'To Skip?': { main: [[m('Apply Skip')], [m('Write Publish Log')]] },

  // splitInBatches: 0 = done, 1 = next batch
  'Loop Publish': { main: [[m('Publish Summary')], [m('Claim Row')]] },
  'Claim Row': { main: [[m('Verify Claim')]] },
  'Verify Claim': { main: [[m('Claimed?')]] },
  'Claimed?': { main: [[m('Dry Run?')], [m('Log Lost Race')]] },
  'Log Lost Race': { main: [[m('Loop Publish')]] },
  'Dry Run?': { main: [[m('Log Dry Run')], [m('FB Upload Photo By URL')]] },
  'Log Dry Run': { main: [[m('Release Row')]] },
  'Release Row': { main: [[m('Loop Publish')]] },
  'FB Upload Photo By URL': { main: [[m('Photo Uploaded?')]] },
  'Photo Uploaded?': { main: [[m('Media Id')], [m('Download Image')]] },
  'Download Image': { main: [[m('FB Upload Photo Binary')]] },
  'FB Upload Photo Binary': { main: [[m('Media Id')]] },
  'Media Id': { main: [[m('FB Create Post')]] },
  'FB Create Post': { main: [[m('Handle Result')]] },
  'Handle Result': { main: [[m('Update Row')]] },
  'Update Row': { main: [[m('Loop Publish')]] },
  'Publish Summary': { main: [[m('Write Publish Log')]] },
};

const TEST_TRIGGER = process.argv.includes('--test-trigger');
if (TEST_TRIGGER) {
  nodes.push({ id: 'trg-test', name: 'Test Trigger', type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1, position: [-40, 100],
    parameters: { httpMethod: 'POST', path: 'publisher-test',
                  responseMode: 'lastNode', options: {} },
    notes: 'TEMPORARY - removed when deployed without --test-trigger.' });
  connections['Test Trigger'] = { main: [[m('Load Config')]] };
}

const workflow = {
  name: 'C - Publisher',
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'Europe/Belgrade',
    saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all',
    saveManualExecutions: true },
};

fs.writeFileSync(path.join(ROOT, 'workflows/C-publisher.json'),
  JSON.stringify(workflow, null, 2) + '\n');

// Fail loudly rather than deploying a graph with a dangling edge.
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
console.log(`wrote workflows/C-publisher.json  (${nodes.length} nodes, `
  + `${Object.keys(connections).length} wired, graph intact)`);
