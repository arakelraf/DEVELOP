// Confirms the atomic claim actually took.
//
// "Claim Row" updates the row only when its status is still the one we read,
// so if another run (or a second trigger firing) got there first, zero rows
// change. That is the double-post guard: without a confirmed claim we do not
// call Facebook at all.
// Mode: Run Once for All Items.

const entry = $('Loop Publish').first().json;
const updated = $input.all().map((i) => i.json || {}).filter((r) => r && r.id);

const claimed = updated.length > 0;

return [{ json: {
  ...entry,
  claimed,
  claim_note: claimed
    ? `Row ${entry.row_id} claimed (status -> posting).`
    : `Row ${entry.row_id} was NOT claimed - its status changed since it was `
      + 'read, so another run owns it. Skipping to avoid a double post.',
} }];
