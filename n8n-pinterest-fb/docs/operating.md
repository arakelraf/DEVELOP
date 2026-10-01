# Running it day to day

Everything is live. Nothing needs doing daily.

## What happens without you

| When | What |
|---|---|
| every 6 hours | **A** reads each board's RSS, records new pins, resolves up to 10 pin pages to Etsy listings, updates `items` |
| daily 07:47 | **B** queues newly available listings into free slots, never twice, rotating boards by priority |
| every 30 min | **C** hands due posts to Facebook. More than 10 minutes out → scheduled with `scheduled_publish_time`; slot already passed → published immediately |
| on any crash | **E** writes it to `errors_log` |

Posts go out at **09:00 / 11:00 / 13:00 / 15:00 / 17:00 / 20:00
Europe/Belgrade**, six a day.

## What you actually do

**Normally: nothing.**

Occasionally, when you want to post from another Pinterest board:

1. **D - Control** → Execute workflow → **Board: add a new one**
2. Paste the board URL (the RSS address is built for you)
3. Wait for the next sync, or run **A** once by hand
4. **D - Control** → **Board: enable**

New boards start disabled on purpose, so pins accumulate before anything is
published from them.

---

# What to keep an eye on

Three things, in order of how likely they are to bite.

## 1. The queue keeping up

The system can only post what Pinterest gives it. With the board gaining
**7 new pins a day** and six posts going out a day, intake exceeds output by
about one a day, so the queue sustains itself - as long as that pinning rate
holds.

The margin is thin, though, and two things eat into it:

- a new pin pointing at a listing that is **already in `items`** adds nothing
  to post - the listing is posted once, then not again for
  `REPOST_AFTER_DAYS`
- a day without pinning is a day the queue shrinks by six

So this is worth a glance once a week rather than ignoring.

The system can only post what Pinterest gives it: an RSS feed carries about
25 pins, and each listing is posted once (then not again for
`REPOST_AFTER_DAYS`, default 60). At six posts a day one board runs
out in about three days; at three a day, about a week. Raising the rate does
not create content - it spends the backlog faster.

**Check:** D - Control → **Queue for the next 7 days**.

If it is thin or shrinking week on week:
- pin more to the board — A picks new pins up within 6 hours, B queues them
  the next morning
- or add another board (above)
- or slow down: remove a slot from `SLOTS` in `config`, e.g.
  `10:00,19:00` for two a day

Nothing breaks when the queue empties. B simply reports that there is
nothing new to queue, and C has nothing to publish.

## 2. The Facebook login expiring

The login you connected produces a user token that lasts about **60 days**.
From it, each run derives a Page token. When the user token expires, the Page
token can no longer be derived and publishing stops.

**It fails safely:** nothing is double-posted, nothing is lost. Entries stay
`queued` and go out once the login is renewed.

**Symptom:** `errors_log` fills with Graph error **code 190**, and the queue
stops moving.

**Fix (one minute):** n8n → Credentials → *Facebook OAuth (login)* →
**Connect my account** → approve. That is all; nothing else changes.

Worth a calendar reminder about two months out.

## 3. Failures

**Check:** the `errors_log` table, newest rows first.

| level | means |
|---|---|
| `info` | a normal run report - how many pins, how many queued, what published |
| `warn` | something was skipped and said why - an empty feed, a disabled board |
| `error` | a publish failed, or a workflow crashed |

A failed post is retried once after 30 minutes. If it fails again it is
parked as `failed` and left alone rather than retried forever. Put it back
with D - Control → **Entry: reschedule**.

---

# Adjusting things

| Want | Do |
|---|---|
| different times | `config` → `SLOTS`, e.g. `09:00,13:00,18:00` |
| more or fewer per day | add or remove entries in `SLOTS`, then run `node scripts/respread-queue.js --apply` to move the EXISTING queue onto the new grid - without it the change only affects what B queues next |
| pause everything | deactivate **C - Publisher**; collection carries on |
| pause one board | D - Control → **Board: disable** - its queued entries move to `skipped` and come back when you re-enable |
| stop a single post | D - Control → **Entry: remove** (use the `#` from the queue view) |
| move a single post | D - Control → **Entry: reschedule** |
| repost sooner than 60 days | `config` → `REPOST_AFTER_DAYS` |
| shorter captions | `config` → `POST_TEXT_MAX_CHARS` |
| different hashtags | `config` → `EXTRA_HASHTAGS` |

Changes to `SLOTS` apply to what B queues next; already-queued entries keep
the times they were given.

## One limit worth knowing

An entry already handed to Facebook shows status `scheduled`. Removing or
moving it in D will **not** unpublish it - Facebook already holds it. Change
or delete that one in Meta Business Suite instead. D refuses the action and
says so rather than pretending it worked.
