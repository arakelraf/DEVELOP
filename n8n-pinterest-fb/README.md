# Pinterest boards → schedule queue → Facebook Page

Reads pins from Pinterest board RSS, recovers the Etsy listing each pin points
at, accumulates listings in storage, spreads them over daily time slots, and
publishes them to a Facebook Page.

Built on **n8n 2.90.0** at `https://n8ntestsrb.duckdns.org`, using **n8n Data
Tables** for storage (no Postgres needed).

---

## What is deployed

| Workflow | ID | Trigger | What it does |
|---|---|---|---|
| **A - Sync Boards** | `fwvz0DCV8qUgISNJ` | every 6h + manual | RSS → `pins` → resolve Etsy links → `items` |
| **B - Build Schedule** | `lquFp2VbnUQck4aw` | daily 07:47 + manual | `items` → `schedule` queue with captions |
| **C - Publisher** | `5e40Xz6KQgc6ihqp` | every 30 min + manual | `schedule` → Facebook |
| **D - Control** | `3uORKvNDepdWOTBE` | n8n Form | everything you operate by hand |
| **E - Error Handler** | `PvlehC1HppyNUe9b` | on crash in A-D | writes the crash to `errors_log` |
| 00 - Feed Probe | `km7kN1d4wZ12gUXV` | Form | diagnose one board's feed |
| 01 - Pin Resolver Probe | `F4bacz8xycWyGkKx` | webhook | diagnose Etsy-link recovery |
| 02 - URL Check | `3npJ76d4byGKCXqJ` | webhook | what does the n8n server see at this URL |

All are **inactive** until you activate them. The three numbered probes are
read-only diagnostics and write to no table.

## Storage

| Table | ID | Holds |
|---|---|---|
| `boards` | `eHP9QfDm4Ay8F0HE` | one row per board (= category) |
| `pins` | `HBshV0j15En0ZX6S` | source-layer cache, one row per pin |
| `items` | `JaT1fvUeN6R77Pg2` | **one row per Etsy listing** |
| `schedule` | `xKKcCos8oPqCFNDW` | the posting queue, unique per listing |
| `config` | `Fzx5awBGnmaDaffF` | every setting |
| `errors_log` | `VahesI6mpjXmcBX5` | run reports and failures |

Note: n8n Data Tables have **no UNIQUE constraint**. "A listing is never
queued twice" is enforced in the workflow logic plus the atomic
`queued → posting` claim, not by the database.

---

# Day-to-day

## Add a board

**D - Control** → Execute workflow → open the form → **Board: add a new one**.

Fill either the username plus a board slug, or just paste the board URL into
*New board: slug, name or pasted URL* and leave the username empty. The RSS
URL is built for you.

New boards are added **disabled**. That is deliberate: A starts collecting
their pins immediately, so when you enable one later it already has a
backlog. Run **A - Sync Boards** once after adding, then enable it.

## Enable or disable a board

**D - Control** → **Board: enable** / **Board: disable**, with the slug in
*Board slug (for enable / disable)*.

`enabled` controls **publishing only** — a disabled board keeps collecting.

Disabling moves queued entries to `skipped`, but only those whose listing
belongs to no other enabled board: a listing pinned on two boards keeps its
slot while either is on. Enabling restores exactly the entries that were
skipped.

## Check the schedule

- **D - Control** → **Queue for the next 7 days** — grouped by day, with the
  `#` entry id you need for reschedule and remove.
- **D - Control** → **Check a listing** — paste an Etsy URL or the numeric id.
  Answers "already scheduled for …", "posted on …", "failed after N
  attempts: …", "skipped", or "not scheduled".
- **D - Control** → **Boards: show all** — per board: on/off, priority, how
  many listings, how many queued right now, last sync time.

## Move or drop an entry

**D - Control** → **Entry: reschedule** (entry id + a new time such as
`2026-10-05T14:00:00Z`) or **Entry: remove**.

A reschedule clears any previous failure and puts the row back to `queued`.
Removing frees the listing to be queued again by the next run of B.

An entry already handed to Facebook (`status = scheduled`) cannot be moved or
removed here — deleting the row would **not** unpublish the post. Change it in
Meta Business Suite first.

## Change the time slots

`config` → row **`SLOTS`** → e.g. `10:00,15:00,20:00`.

Add or remove entries to change how many posts per day. Times are wall-clock
in `TIMEZONE`, and they stay correct across daylight-saving changes.

Already-queued entries keep the slots they were given; the new slots apply to
whatever B queues next.

---

## Settings (`config` table)

| Key | Default | Meaning |
|---|---|---|
| `TIMEZONE` | `Europe/Belgrade` | all slot times are wall-clock here |
| `SLOTS` | `10:00,15:00,20:00` | daily posting slots |
| `TEXT_MODE` | `pinterest` | `pinterest` = use the pin's text · `template` = title + link · `ai` = reserved |
| `EXTRA_HASHTAGS` | `#etsy #digitaldownload #smartlydigit` | appended when the pin carries none |
| `POST_TEXT_MAX_CHARS` | `600` | caption is trimmed on a sentence boundary |
| `REPOST_AFTER_DAYS` | `60` | a posted listing may be re-queued after this; `0` disables reposting |
| `SCHEDULE_HORIZON_DAYS` | `14` | B will not fill slots further ahead |
| `MAX_QUEUE_PER_RUN` | `60` | cap on new queue rows per run of B |
| `SYNC_INTERVAL_HOURS` | `6` | documents A's trigger (change the trigger too) |
| `PIN_RESOLVE_MAX_PER_RUN` | `10` | pin pages fetched per run — each is ~1MB |
| `RESOLVE_THROTTLE_MS` | `2000` | pause between pin-page fetches |
| `RESOLVE_MAX_ATTEMPTS` | `3` | then the pin is parked as `failed` |
| `RETRY_DELAY_MINUTES` | `30` | wait before retrying a failed post, once |
| `MAX_PUBLISH_PER_RUN` | `20` | cap on Facebook calls per run of C |
| `AUTH_MODE` | `oauth` | `oauth` = the login credential · `token` = a pasted user token |
| `DRY_RUN` | `true` | **C sends nothing to Facebook while this is true** |
| `FB_PAGE_ID` | *(empty)* | optional — derived from the login when blank |
| `FB_API_VERSION` | `v21.0` | Graph API version |

Secrets live **only** in n8n Credentials. `config` holds no tokens.

## Status values in `schedule`

```
queued     waiting for its slot
posting    claimed by a run of C right now  (the double-post guard)
scheduled  accepted by Facebook, will publish at scheduled_at
posted     published
failed     the attempt failed; error and attempts say what happened
skipped    its boards were disabled
```

`queued`, `posting` and `scheduled` all block the listing from being queued
again. `failed` and `skipped` wait for you — reschedule them from D.

---

## Publishing to Facebook

**This is the only part that is not finished**, because it needs something
only you can supply.

A Facebook Page Access Token cannot be issued unless a **Meta app** exists —
that is how the Graph API works, and web access to facebook.com is not
enough. Once an app exists, pick either route:

| `AUTH_MODE` | What you do | Redirect URI needed |
|---|---|---|
| `oauth` | Credentials → *Facebook OAuth (login)* → paste App ID + Secret → **Connect my account** → approve the Facebook window | yes |
| `token` | Credentials → *Facebook User Token* → paste a long-lived **user** token | no |

Either way the run derives the **Page** token itself via `/me/accounts`, so
you never copy a Page token and `FB_PAGE_ID` can stay empty.

Then set `DRY_RUN` to `false` and activate C.

`docs/facebook-page-token.md` has the full walkthrough, including two routes
that avoid the developer portal when it is blocked in your country, and where
the redirect-URI setting lives in both Meta dashboard layouts.

### Until then: post by hand, decisions still automated

**D - Control** → **Today's posts (copy-paste list)** gives each post due
today with its local time, the verified full-resolution image URL, and the
caption between cut marks — ready to paste into Meta Business Suite.

Everything difficult stays automatic: which listings, in what order, at what
times, with what text, no repeats, boards rotating by priority, images
verified to actually load.

---

## How it hangs together

```
Pinterest board RSS ──► A ──► pins ──► (resolve pin page) ──► items
                                                               │
                                          boards.enabled ──────┤
                                                               ▼
                                                    B ──► schedule
                                                               │
                                                               ▼
                                            C ──► Facebook Page
                                                               ▲
                                                    D ─────────┘ (operate)
```

**A is the only Pinterest-aware component.** It writes `items` keyed on
`etsy_listing_id`; B, C and D never reference a pin, a board feed or an
`i.pinimg.com` URL. Replacing A with the Etsy API later leaves them untouched.

### One thing worth knowing about the source

Pinterest board RSS **does not publish a pin's outbound link** — verified on a
real board: 26 pins, 0 Etsy links. `<link>` and `<guid>` are both the pin
page. So A fetches each pin's page once and recovers the link from the
embedded JSON, caching the result in `pins` so it is never fetched twice.
That is why `PIN_RESOLVE_MAX_PER_RUN` exists: each page is about 1 MB.

---

## Working on the code

```bash
# unit tests - no network, no n8n needed (181 cases)
for f in pin-parser board-url pin-resolver scheduler post-text publisher control; do
  node src/$f.test.js
done

# regenerate Code-node sources from src/ after editing
node scripts/build-code-nodes.js

# regenerate a workflow JSON and push it to n8n (create-or-update by name)
node scripts/wf-a-sync-boards.js && node scripts/deploy.js workflows/A-sync-boards.json
```

**Never edit `build/` or `workflows/` by hand.** `build/` is generated from
`src/` by `scripts/build-code-nodes.js`, and `workflows/` by the `scripts/wf-*`
generators. The point is that the code covered by tests and the code running
in n8n cannot drift apart.

Add `--test-trigger` to a generator to attach a temporary webhook so the
workflow can be driven from a script, then redeploy without the flag to
remove it.

### Layout

```
src/            logic, each file with a matching .test.js
  pin-parser      RSS item → title/description/image/Etsy link   (22 tests)
  board-url       typed input → username/slug/rss_url            (22 tests)
  pin-resolver    pin page HTML → Etsy listing                   (15 tests)
  scheduler       slot planning, timezone and DST, queue rules   (37 tests)
  post-text       caption assembly, de-duplication, trimming     (23 tests)
  publisher       publish selection, scheduled vs immediate      (24 tests)
  control         all of Workflow D's views and actions          (38 tests)
  nodes/          the n8n glue for each Code node
scripts/        generators, deploy and diagnostic tooling
build/          generated Code-node sources - do not edit
workflows/      generated workflow JSON, importable into n8n
docs/           the Facebook token walkthrough
```

## Diagnostics

- **00 - Feed Probe** — type a board, see what parsed out of its feed. Writes
  nothing. Run this first whenever a board looks wrong.
- **01 - Pin Resolver Probe** — `POST {"pin_urls":["…"]}`; reports whether the
  Etsy link can be recovered, and distinguishes a bot wall from a pin that
  genuinely has no link.
- **02 - URL Check** — `POST {"url":"…","method":"HEAD","preset":"image"}`;
  answers what the **n8n server** sees at a URL, which is the only machine
  whose view matters.
- `scripts/heal-item-images.js [--apply]` — re-verifies downscaled images and
  upgrades them to the original.

## Security

Rotate the n8n API key in Settings → API: it is committed in `.mcp.json` in
this repository's history. Move it to an untracked file, or export
`N8N_API_URL` and `N8N_API_KEY` in the environment — `scripts/n8n-api.js`
prefers the environment and falls back to `.mcp.json`.

## Getting the day's list outside n8n

The form's completion screen is not saved anywhere. To get the same list as a
file you can keep:

```bash
node scripts/todays-posts.js                       # today, to stdout
node scripts/todays-posts.js 1                     # tomorrow
node scripts/todays-posts.js 0 posts-today.md      # and write it to a file
```

It reads the tables directly, marks any slot that has already passed, and
flags an entry whose image is missing.
