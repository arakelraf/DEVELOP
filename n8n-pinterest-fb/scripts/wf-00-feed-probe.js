/**
 * Emits workflows/00-feed-probe.json.
 *
 * Purpose: prove the Pinterest RSS -> Etsy extraction works against YOUR real
 * boards before any of the storage or publishing logic is built. It writes
 * nothing to any table - it is a read-only diagnostic you can re-run any time
 * a board looks wrong.
 *
 * You type the username and board into an n8n Form, so nothing is hardcoded.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const nodes = [
  {
    id: 'sticky-overview',
    name: 'Sticky Note',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-260, -200],
    parameters: {
      width: 460,
      height: 300,
      content: [
        '## 00 - Feed Probe (read-only)',
        '',
        '**Run this first.** It proves the Pinterest -> Etsy extraction works',
        'against your real boards before anything is stored or posted.',
        '',
        'Click **Execute workflow**, open the form link n8n shows you, and type:',
        '- your Pinterest username (or paste your profile URL)',
        '- one board (slug, display name, or paste the board URL)',
        '',
        'It **writes nothing to any table**. Safe to re-run whenever a board',
        'looks wrong.',
        '',
        '_The Code nodes are generated from `src/` by',
        '`scripts/build-code-nodes.js` - edit there, not here._',
      ].join('\n'),
    },
  },
  {
    id: 'form-ask-board',
    name: 'Ask For Board',
    type: 'n8n-nodes-base.formTrigger',
    typeVersion: 2.6,
    position: [260, -40],
    parameters: {
      formTitle: 'Test a Pinterest board feed',
      formDescription:
        'Read-only check. Nothing is saved and nothing is posted. '
        + 'You can paste a full board URL into the second field and leave the '
        + 'first one empty.',
      formFields: {
        values: [
          {
            fieldLabel: 'Pinterest username',
            fieldType: 'text',
            placeholder: 'smartlydigit  (or paste your profile URL)',
            requiredField: false,
          },
          {
            fieldLabel: 'Board (slug, name, or pasted board URL)',
            fieldType: 'text',
            placeholder: 'printable-wall-art',
            requiredField: true,
          },
        ],
      },
      responseMode: 'lastNode',
    },
  },
  {
    id: 'code-build-url',
    name: 'Build Feed URL',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [500, -40],
    parameters: { jsCode: read('build/build-feed-url.js') },
    notes: 'Normalizes the typed input into https://www.pinterest.com/{user}/{board}.rss',
  },
  {
    id: 'if-input-ok',
    name: 'Input Valid?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [740, -40],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', version: 2,
                   typeValidation: 'strict' },
        combinator: 'and',
        conditions: [
          {
            id: 'c-ok',
            leftValue: '={{ $json.ok }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
      },
      options: {},
    },
  },
  {
    id: 'rss-read',
    name: 'Read Board RSS',
    type: 'n8n-nodes-base.rssFeedRead',
    typeVersion: 1.2,
    position: [980, -140],
    parameters: {
      url: '={{ $json.rss_url }}',
      options: { ignoreSSL: false },
    },
    // One unreachable board must never abort the run - Workflow A reuses this
    // setting to keep the other boards going.
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    alwaysOutputData: true,
    notes: 'Continues on error so a renamed/secret board is reported, not fatal.',
  },
  {
    id: 'code-parse-pins',
    name: 'Parse Pins',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1220, -140],
    parameters: { jsCode: read('build/parse-pins.js') },
    notes: 'The only Pinterest-aware logic. Outputs a summary item then one item per pin.',
  },
  {
    id: 'form-result',
    name: 'Show Result',
    type: 'n8n-nodes-base.form',
    typeVersion: 2.5,
    position: [1460, -140],
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle:
        '={{ $json.ok === false ? "Could not read that board" : "Feed parsed OK" }}',
      completionMessage: '={{ $json.ok === false'
        + ' ? ($json.message + "\\n\\n" + ($json.hint || ""))'
        + ' : ("Board: " + $json.board_slug'
        + ' + "\\nFeed: " + $json.rss_url'
        + ' + "\\n\\nPins in feed: " + $json.pins_in_feed'
        + ' + "\\nWith an Etsy link: " + $json.with_etsy_link'
        + ' + "\\nUnique listings: " + $json.unique_listings'
        + ' + "\\nIgnored: " + $json.rejected'
        + ' + "\\n\\nFirst pin:\\n" + JSON.stringify($json.first_pin_preview, null, 2)'
        + ' + "\\n\\nOpen the execution in n8n to see every parsed pin.") }}',
      options: {},
    },
  },
  {
    id: 'form-bad-input',
    name: 'Explain Bad Input',
    type: 'n8n-nodes-base.form',
    typeVersion: 2.5,
    position: [980, 80],
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'Check what you typed',
      completionMessage: '={{ $json.message }}',
      options: {},
    },
  },
  {
    id: 'sticky-isolation',
    name: 'Sticky Note1',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [1180, 80],
    parameters: {
      width: 420,
      height: 220,
      color: 4,
      content: [
        '### Source isolation boundary',
        '',
        '`Parse Pins` is the **only** node in the whole system that knows',
        'Pinterest exists. It emits a fixed contract:',
        '',
        '`etsy_listing_id, etsy_url, title, description, image_url,',
        'image_candidates, pin_url`',
        '',
        'Workflows B/C/D key on **etsy_listing_id** only. Replacing this with',
        'the Etsy API later means replacing this node and nothing else.',
      ].join('\n'),
    },
  },
];

const connections = {
  'Ask For Board': { main: [[{ node: 'Build Feed URL', type: 'main', index: 0 }]] },
  'Build Feed URL': { main: [[{ node: 'Input Valid?', type: 'main', index: 0 }]] },
  'Input Valid?': {
    main: [
      [{ node: 'Read Board RSS', type: 'main', index: 0 }],
      [{ node: 'Explain Bad Input', type: 'main', index: 0 }],
    ],
  },
  'Read Board RSS': { main: [[{ node: 'Parse Pins', type: 'main', index: 0 }]] },
  'Parse Pins': { main: [[{ node: 'Show Result', type: 'main', index: 0 }]] },
};

const workflow = {
  name: '00 - Feed Probe (Pinterest -> Etsy)',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'Europe/Belgrade',
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
  },
};

const out = path.join(ROOT, 'workflows/00-feed-probe.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote workflows/00-feed-probe.json  (${nodes.length} nodes)`);
