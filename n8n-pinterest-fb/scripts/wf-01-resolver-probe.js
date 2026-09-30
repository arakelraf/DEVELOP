/**
 * Emits workflows/01-resolver-probe.json.
 *
 * Purpose: Pinterest board RSS does not contain a pin's outbound link
 * (verified: 26/26 pins on a real board had none). The link exists only on
 * the pin page. This probe answers one question before any of that is built
 * into Workflow A:
 *
 *   can the n8n server fetch a pin page and read the Etsy link out of it,
 *   or does Pinterest serve a bot wall to unauthenticated requests?
 *
 * Read-only, writes to no table, capped at 10 pins per call.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// A plain Webhook trigger (not a Form) so the probe can be driven
// programmatically with a JSON body.
const nodes = [
  {
    id: 'sticky-why',
    name: 'Sticky Note',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-300, -220],
    parameters: {
      width: 520,
      height: 340,
      color: 3,
      content: [
        '## 01 - Pin Resolver Probe (read-only)',
        '',
        '**Why this exists.** Pinterest board RSS does *not* publish a pin\'s',
        'outbound link. Verified on a real board: 26 pins, 0 Etsy links. The',
        'feed only carries the pin URL, the image and the description.',
        '',
        'So the Etsy link has to come from the **pin page** itself, where',
        'Pinterest embeds it in a JSON blob.',
        '',
        '**The question this answers:** can the n8n server fetch a pin page',
        'and read that link, or does Pinterest serve a bot wall?',
        '',
        'POST to the webhook:',
        '`{"pin_urls":["https://www.pinterest.com/pin/<id>/"]}`',
        '',
        'Capped at 10 pins per call. Writes nothing.',
      ].join('\n'),
    },
  },
  {
    id: 'webhook-in',
    name: 'Probe Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1,
    position: [280, -40],
    parameters: {
      httpMethod: 'POST',
      path: 'pin-resolver-probe',
      responseMode: 'lastNode',
      options: {},
    },
  },
  {
    id: 'code-pins',
    name: 'Pins To Resolve',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [500, -40],
    parameters: { jsCode: read('build/pins-to-resolve.js') },
    notes: 'Expands the posted pin_urls into one item each. Batch capped at 10.',
  },
  {
    id: 'http-pin-page',
    name: 'Fetch Pin Page',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [720, -40],
    parameters: {
      url: '={{ $json.pin_url }}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          // Pinterest serves a stripped page to obvious bots. A normal
          // browser UA and Accept headers are what make the JSON blob appear.
          {
            name: 'User-Agent',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              + ' (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          },
          {
            name: 'Accept',
            value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          { name: 'Accept-Language', value: 'en-US,en;q=0.9' },
        ],
      },
      options: {
        timeout: 20000,
        redirect: { redirect: { followRedirects: true, maxRedirects: 5 } },
        response: {
          response: {
            responseFormat: 'text',
            outputPropertyName: 'data',
            // Keep non-2xx flowing so the probe can report 403/429 instead of
            // dying, which is the whole point of the diagnostic.
            neverError: true,
            fullResponse: true,
          },
        },
      },
    },
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    alwaysOutputData: true,
    notes: 'Browser-like headers. neverError so a bot wall is reported, not fatal.',
  },
  {
    id: 'code-extract',
    name: 'Extract Destination',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [960, -40],
    parameters: { jsCode: read('build/extract-destination.js') },
    notes: 'Reads the Etsy link out of the page JSON. Distinguishes '
         + '"blocked" from "no link" from "destination is not Etsy".',
  },
];

const connections = {
  'Probe Webhook': { main: [[{ node: 'Pins To Resolve', type: 'main', index: 0 }]] },
  'Pins To Resolve': { main: [[{ node: 'Fetch Pin Page', type: 'main', index: 0 }]] },
  'Fetch Pin Page': { main: [[{ node: 'Extract Destination', type: 'main', index: 0 }]] },
};

const workflow = {
  name: '01 - Pin Resolver Probe',
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

const out = path.join(ROOT, 'workflows/01-resolver-probe.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote workflows/01-resolver-probe.json  (${nodes.length} nodes)`);
