// Renders the outcome of an add-board / reschedule / remove action.
// Mode: Run Once for All Items.

const req = $('Parse Request').first().json;

if (req._kind === 'addboard') {
  return [{ json: {
    title: `Board "${req.board_slug}" added`,
    text: [
      `slug     ${req.board_slug}`,
      `name     ${req.name}`,
      `priority ${req.priority}`,
      `feed     ${req.rss_url}`,
      `enabled  false`,
      '',
      req.note,
    ].join('\n'),
  } }];
}

if (req._kind === 'reschedule') {
  return [{ json: {
    title: `Entry #${req.row_id} rescheduled`,
    text: `${req.note}\n\nIt will be picked up by "C - Publisher" when its new `
      + 'slot comes round.',
  } }];
}

if (req._kind === 'remove') {
  return [{ json: {
    title: `Entry #${req.row_id} removed`,
    text: req.note,
  } }];
}

return [{ json: { title: 'Done', text: JSON.stringify(req, null, 2) } }];
