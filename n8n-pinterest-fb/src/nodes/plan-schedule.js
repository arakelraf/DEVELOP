// ---------------------------------------------------------------- n8n glue
// Workflow B: decide what goes into the posting queue.
//
// Reads the three tables loaded upstream by name, so each data-table node
// runs exactly once (they are chained through single-item gates).
// Mode: Run Once for All Items.

const cfg = $('Config').first().json;
const boards = $('Load Boards').all().map((i) => i.json || {}).filter((b) => b.board_slug);
const items = $('Load Items').all().map((i) => i.json || {}).filter((r) => r.etsy_listing_id);
const scheduleRows = $('Load Schedule').all().map((i) => i.json || {})
  .filter((r) => r.etsy_listing_id);

const enabledBoards = boards.filter((b) => b.enabled === true).map((b) => b.board_slug);
const priorityByBoard = {};
for (const b of boards) priorityByBoard[b.board_slug] = Number(b.priority) || 0;

const nowMs = Date.now();

const plan = planSchedule({
  items,
  scheduleRows,
  enabledBoards,
  priorityByBoard,
  slots: cfg._slots,
  timezone: cfg.TIMEZONE,
  nowMs,
  horizonDays: cfg._horizon_days,
  maxQueue: cfg._max_queue,
  repostAfterDays: cfg._repost_after_days,
  // Facebook rejects a scheduled_publish_time less than 10 minutes out, so
  // never hand it something that close.
  leadMinutes: 20,
});

const out = [];

// Inserts and requeues share the same caption logic; only the write differs.
// A requeue carries requeue_row_id so Workflow B UPDATES that row, which is
// what keeps schedule.etsy_listing_id unique across reposts.
for (const row of [...plan.toInsert, ...plan.toRequeue]) {
  const it = row._item || {};
  const text = buildPostText({
    title: it.title,
    description: it.description,
    etsy_url: it.etsy_url || `https://www.etsy.com/listing/${row.etsy_listing_id}`,
    extraHashtags: cfg.EXTRA_HASHTAGS,
    maxChars: cfg._text_max,
    mode: cfg.TEXT_MODE,
  });

  out.push({ json: {
    _kind: row.requeue_row_id == null ? 'queue' : 'requeue',
    requeue_row_id: row.requeue_row_id ?? null,
    etsy_listing_id: row.etsy_listing_id,
    board_slug: row.board_slug,
    scheduled_at: row.scheduled_at,
    status: 'queued',
    post_text: text.post_text,
    fb_post_id: '',
    error: '',
    created_at: row.created_at,
    posted_at: null,
    // Diagnostics, not stored - visible in the execution view.
    _title: String(it.title || '').slice(0, 80),
    _image_url: it.image_url || '',
    _hashtags: text.hashtags,
    _truncated: text.truncated,
  } });
}

// The report the spec asks for: counts plus the explicit "already scheduled"
// list, so nothing is silently dropped.
const report = {
  _kind: 'report',
  workflow: 'B - Build Schedule',
  level: plan.report.added ? 'info' : 'warn',
  context: 'build_summary',
  created_at: new Date(nowMs).toISOString(),
  added: plan.report.added,
  inserted: plan.report.inserted,
  requeued: plan.report.requeued,
  already_scheduled: plan.report.already_scheduled,
  skipped: plan.report.skipped,
  unplaced: plan.report.unplaced,
  enabled_boards: plan.report.enabled_boards,
  free_slots_in_horizon: plan.report.free_slots_in_horizon,
  text_mode: cfg.TEXT_MODE,
  already_list: plan.already.map((a) =>
    `Listing ${a.etsy_listing_id} "${String(a.title).slice(0, 60)}" `
    + `is already scheduled for ${a.scheduled_at}`
    + (a.status && a.status !== 'queued' ? ` (status: ${a.status})` : '')),
  skipped_breakdown: plan.skipped.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {}),
  skipped_examples: plan.skipped.slice(0, 5).map((s) => ({
    etsy_listing_id: s.etsy_listing_id, reason: s.reason,
    days_until_eligible: s.days_until_eligible,
  })),
  unplaced_breakdown: plan.unplaced.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {}),
  note: !enabledBoards.length
    ? 'No board is enabled, so nothing can be queued. Enable a board in the '
      + 'boards table or via Workflow D.'
    : plan.report.added
      ? `Queued ${plan.report.added} post(s) across slots ${cfg.SLOTS} `
        + `${cfg.TIMEZONE} (${plan.report.inserted} new, `
        + `${plan.report.requeued} reposted after the cooldown).`
      : 'Nothing new to queue - every eligible listing is already scheduled, '
        + 'posted recently, or its boards are disabled.',
};

// Report last so the queue rows lead the output and read naturally.
out.push({ json: report });
return out;
