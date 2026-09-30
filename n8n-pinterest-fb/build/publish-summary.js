// Final report for a publish run. Tolerates branches that did not execute.
// Mode: Run Once for All Items.

const safe = (name) => {
  try { return $(name).all().map((i) => i.json || {}); } catch { return []; }
};

const results = safe('Handle Result');
const ok = results.filter((r) => r._ok);
const failed = results.filter((r) => r._ok === false);
const dry = safe('Log Dry Run');

return [{ json: {
  workflow: 'C - Publisher',
  level: failed.length ? 'error' : 'info',
  context: 'publish_run',
  created_at: new Date().toISOString(),
  published_ok: ok.length,
  scheduled_on_facebook: ok.filter((r) => r.status === 'scheduled').length,
  published_immediately: ok.filter((r) => r.status === 'posted').length,
  failed: failed.length,
  dry_run_entries: dry.length,
  failures: failed.map((f) => ({
    etsy_listing_id: f.etsy_listing_id, attempts: f.attempts, error: f.error,
  })),
  successes: ok.map((r) => ({
    etsy_listing_id: r.etsy_listing_id, status: r.status,
    fb_post_id: r.fb_post_id, posted_at: r.posted_at,
  })),
} }];
