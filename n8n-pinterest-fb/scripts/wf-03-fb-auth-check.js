/**
 * Emits workflows/03-fb-auth-check.json  -  "03 - Facebook Auth Check".
 *
 * Answers one question without publishing anything: does the Facebook login
 * work, and which Page would be posted to?
 *
 * It calls /me/accounts with whichever credential AUTH_MODE selects and
 * reports the Page name, id and whether a Page token came back. Read-only:
 * no table is written and nothing is sent to the Page.
 *
 * This exists because a dry run deliberately skips Facebook entirely, so
 * before this there was no way to check the credential short of going live
 * and posting for real.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CONFIG = 'Fzx5awBGnmaDaffF';
const FB_OAUTH = { id: 'gew3mnOJy0FEybxs', name: 'Facebook OAuth (login)' };
const FB_USER_TOKEN = { id: 'k62FLo1U37qyXxOk', name: 'Facebook User Token' };

const opts = { caseSensitive: true, leftValue: '', version: 2, typeValidation: 'loose' };
const ME_ACCOUNTS =
  "={{ 'https://graph.facebook.com/' + $('Config').first().json.FB_API_VERSION"
  + " + '/me/accounts' }}";
const fbResponse = { timeout: 30000,
  response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } };

const nodes = [
  { id: 'sn', name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-40, -260], parameters: { width: 480, height: 230, color: 4, content: [
      '## 03 - Facebook Auth Check (read-only)',
      '',
      'Does the login work, and which Page would we post to?',
      '',
      'Calls `/me/accounts` with the credential `AUTH_MODE` selects and reports',
      'what came back. **Publishes nothing, writes to no table.**',
      '',
      'Run this after connecting the credential, before setting `DRY_RUN=false`.',
    ].join('\n') } },

  { id: 'wh', name: 'Check Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2.1,
    position: [220, -40],
    parameters: { httpMethod: 'POST', path: 'fb-auth-check',
                  responseMode: 'lastNode', options: {} } },

  { id: 'dt-config', name: 'Load Config', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [440, -40], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: CONFIG },
      matchType: 'allConditions', filters: {}, returnAll: true } },

  { id: 'cd-config', name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [660, -40], parameters: { jsCode: read('build/config-map.js') } },

  { id: 'if-mode', name: 'OAuth Mode?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [880, -40],
    parameters: { conditions: { options: opts, combinator: 'and', conditions: [{
      id: 'c0', leftValue: '={{ $json._auth_mode }}', rightValue: 'oauth',
      operator: { type: 'string', operation: 'equals' } }] }, options: {} } },

  { id: 'http-oauth', name: 'FB List Pages (OAuth)', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [1100, -140],
    parameters: { method: 'GET', url: ME_ACCOUNTS,
      authentication: 'genericCredentialType', genericAuthType: 'oAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'fields', value: 'id,name,access_token' }] },
      options: fbResponse },
    credentials: { oAuth2Api: FB_OAUTH },
    onError: 'continueRegularOutput', alwaysOutputData: true },

  { id: 'http-token', name: 'FB List Pages (Token)', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [1100, 60],
    parameters: { method: 'GET', url: ME_ACCOUNTS,
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'fields', value: 'id,name,access_token' }] },
      options: fbResponse },
    credentials: { httpHeaderAuth: FB_USER_TOKEN },
    onError: 'continueRegularOutput', alwaysOutputData: true },

  { id: 'cd-pick', name: 'Pick Page', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1320, -40], parameters: { jsCode: read('build/pick-page.js') } },

  { id: 'cd-report', name: 'Report', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1540, -40], parameters: { jsCode:
      '// Reports the outcome WITHOUT ever echoing the Page token.\n'
      + '// Mode: Run Once for All Items.\n\n'
      + 'const r = $input.first().json || {};\n'
      + "const cfg = $('Config').first().json;\n\n"
      + 'if (!r.ok) {\n'
      + '  return [{ json: {\n'
      + "    verdict: 'NOT WORKING',\n"
      + '    auth_mode: cfg._auth_mode,\n'
      + '    stage: r.stage, error: r.error, hint: r.hint,\n'
      + '    pages_available: r.pages_available,\n'
      + '  } }];\n'
      + '}\n\n'
      + 'return [{ json: {\n'
      + "  verdict: 'WORKING',\n"
      + '  auth_mode: cfg._auth_mode,\n'
      + '  page_id: r.page_id,\n'
      + '  page_name: r.page_name,\n'
      + '  page_id_source: r.page_id_source,\n'
      + '  pages_on_account: r.pages_available,\n'
      + '  page_token_received: Boolean(r.page_token),\n'
      + "  next: cfg._dry_run\n"
      + "    ? 'Auth is fine. Set DRY_RUN=false in config to start publishing.'\n"
      + "    : 'Auth is fine and DRY_RUN is already off - C will publish on its next run.',\n"
      + '} }];\n' },
    notes: 'Reports only that a token arrived, never the token itself.' },
];

const m = (node, index = 0) => ({ node, type: 'main', index });
const workflow = {
  name: '03 - Facebook Auth Check',
  nodes,
  connections: {
    'Check Webhook': { main: [[m('Load Config')]] },
    'Load Config': { main: [[m('Config')]] },
    Config: { main: [[m('OAuth Mode?')]] },
    'OAuth Mode?': { main: [[m('FB List Pages (OAuth)')], [m('FB List Pages (Token)')]] },
    'FB List Pages (OAuth)': { main: [[m('Pick Page')]] },
    'FB List Pages (Token)': { main: [[m('Pick Page')]] },
    'Pick Page': { main: [[m('Report')]] },
  },
  settings: { executionOrder: 'v1', timezone: 'Europe/Belgrade',
    saveDataSuccessExecution: 'all', saveManualExecutions: true },
};

fs.writeFileSync(path.join(ROOT, 'workflows/03-fb-auth-check.json'),
  JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote workflows/03-fb-auth-check.json  (${nodes.length} nodes)`);
