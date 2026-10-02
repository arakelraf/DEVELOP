// Flattens the config table into one object so later nodes can read settings
// as $('Config').first().json.SLOTS instead of searching rows.
// Defaults are applied for any key missing from the table, so the workflow
// still runs on a fresh install. Mode: Run Once for All Items.

const DEFAULTS = {
  TIMEZONE: 'Europe/Belgrade',
  SLOTS: '10:00,15:00,20:00',
  TEXT_MODE: 'pinterest',
  REPOST_AFTER_DAYS: '60',
  SCHEDULE_HORIZON_DAYS: '14',
  MAX_QUEUE_PER_RUN: '60',
  RETRY_DELAY_MINUTES: '30',
  EXTRA_HASHTAGS: '',
  POST_TEXT_MAX_CHARS: '600',
  FB_PAGE_ID: '',
  PIN_RESOLVE_MAX_PER_RUN: '10',
  RESOLVE_THROTTLE_MS: '2000',
  RESOLVE_MAX_ATTEMPTS: '3',
  DRY_RUN: 'true',
  MAX_PUBLISH_PER_RUN: '20',
  FB_API_VERSION: 'v21.0',
  AUTH_MODE: 'oauth',
  LINK_IN_COMMENT: 'true',
  CTA_FOOTER: '',
};

const cfg = { ...DEFAULTS };
for (const item of $input.all()) {
  const r = item.json || {};
  if (r.key) cfg[String(r.key)] = r.value == null ? '' : String(r.value);
}

// Typed views, so consumers never re-parse strings.
cfg._slots = String(cfg.SLOTS).split(',').map((s) => s.trim()).filter(Boolean);
cfg._repost_after_days = Number(cfg.REPOST_AFTER_DAYS) || 0;
cfg._resolve_max = Math.max(1, Number(cfg.PIN_RESOLVE_MAX_PER_RUN) || 10);
cfg._throttle_ms = Math.max(0, Number(cfg.RESOLVE_THROTTLE_MS) || 0);
cfg._resolve_max_attempts = Math.max(1, Number(cfg.RESOLVE_MAX_ATTEMPTS) || 3);
cfg._horizon_days = Math.max(1, Number(cfg.SCHEDULE_HORIZON_DAYS) || 14);
cfg._max_queue = Math.max(1, Number(cfg.MAX_QUEUE_PER_RUN) || 60);
cfg._text_max = Math.max(80, Number(cfg.POST_TEXT_MAX_CHARS) || 600);
cfg._retry_delay_minutes = Math.max(1, Number(cfg.RETRY_DELAY_MINUTES) || 30);
cfg._max_publish = Math.max(1, Number(cfg.MAX_PUBLISH_PER_RUN) || 20);
// Anything but an explicit "false" keeps the safety on.
cfg._dry_run = String(cfg.DRY_RUN).trim().toLowerCase() !== 'false';
// Link-in-first-comment is on unless explicitly "false".
cfg._link_in_comment = String(cfg.LINK_IN_COMMENT).trim().toLowerCase() !== 'false';
// Anything other than an explicit "token" means the OAuth login path.
cfg._auth_mode = String(cfg.AUTH_MODE).trim().toLowerCase() === 'token'
  ? 'token' : 'oauth';

return [{ json: cfg }];
