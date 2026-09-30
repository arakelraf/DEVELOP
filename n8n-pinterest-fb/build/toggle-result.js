// Renders the outcome of a board toggle, including what the cascade did.
// Mode: Run Once for All Items.

const req = $('Parse Request').first().json;

let skipped = 0;
let restored = 0;
try {
  for (const i of $('Cascade Plan').all()) {
    const j = i.json || {};
    if (j._kind !== 'cascade') continue;
    if (j.status === 'skipped') skipped++;
    if (j.status === 'queued') restored++;
  }
} catch { /* cascade produced nothing */ }

const state = req.enabled ? 'ENABLED' : 'DISABLED';
const lines = [`Board "${req.board_slug}" is now ${state}.`, ''];

if (req.enabled) {
  lines.push(restored
    ? `${restored} previously skipped entr${restored === 1 ? 'y was' : 'ies were'} `
      + 'put back in the queue.'
    : 'No skipped entries needed restoring.');
  lines.push('', 'Its listings can now be published. The next run of '
    + '"B - Build Schedule" will queue any that are not scheduled yet.');
} else {
  lines.push(skipped
    ? `${skipped} queued entr${skipped === 1 ? 'y was' : 'ies were'} moved to `
      + 'skipped, because their listings belong only to disabled boards.'
    : 'No queued entries were affected - their listings also sit on boards '
      + 'that are still enabled.');
  lines.push('', 'Pins keep being collected for this board; nothing new will '
    + 'be published from it. Enabling it again restores exactly the entries '
    + 'that were skipped.');
}

return [{ json: { title: `Board ${req.board_slug}: ${state}`, text: lines.join('\n') } }];
