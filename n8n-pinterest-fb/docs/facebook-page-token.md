# Getting a long-lived Facebook Page Access Token

You need one token, with two permissions, that does not expire. Meta makes this
deliberately confusing, so follow the steps in order. Total time ~15 minutes.

You will end up with a **Page Access Token** that you paste into an n8n
credential. It never goes into a workflow, a Code node, or this repository.

---

## What you need first

- A Facebook **Page** (not a personal profile) that you are an admin of.
- A personal Facebook account that is an admin of that Page.

---

## Step 1 — Create a Meta app

1. Go to <https://developers.facebook.com/apps/>.
2. **Create app**.
3. App name: anything (`SmartlyDigit Poster`). Contact email: yours.
4. Use case: choose **Other** → **Business**.
   - If asked to pick a Business Portfolio, pick your existing one or create one.
5. Create the app. Note the **App ID** and **App Secret**
   (*App settings → Basic*; click **Show** for the secret).

You do **not** need to submit the app for review, and you do **not** need to
make it Live. A Page token issued to an admin of the Page works in Development
mode, for posting to *that* Page only — which is all you want.

## Step 2 — Add the Facebook Login product

1. In the left sidebar: **Add product** → **Facebook Login** → **Set up**.
2. No further configuration is needed; adding it is what lets the Graph
   Explorer issue user tokens for your app.

## Step 3 — Get a short-lived User Access Token with the right scopes

1. Open the **Graph API Explorer**:
   <https://developers.facebook.com/tools/explorer/>
2. Top right: set **Meta App** to the app you just created.
3. **User or Page** → **User token**.
4. Click **Add a permission** / the permissions box and tick exactly:
   - `pages_manage_posts`  ← lets it publish
   - `pages_read_engagement` ← lets it read the Page
   - `pages_show_list`  ← lets it list your Pages in step 5
   - `business_management` ← only if your Page sits in a Business Portfolio
5. Click **Generate Access Token** and approve the dialog for your Page.
6. Copy the token. This one is **short-lived (~1-2 hours)** — it is only a
   stepping stone.

Sanity-check it before moving on. In the Explorer, request `me/permissions`
and confirm `pages_manage_posts` and `pages_read_engagement` are listed as
`granted`.

## Step 4 — Exchange it for a long-lived User token (~60 days)

Run this in a terminal (or paste in a browser). Substitute your values:

```bash
curl -s -G "https://graph.facebook.com/v21.0/oauth/access_token" \
  --data-urlencode "grant_type=fb_exchange_token" \
  --data-urlencode "client_id=YOUR_APP_ID" \
  --data-urlencode "client_secret=YOUR_APP_SECRET" \
  --data-urlencode "fb_exchange_token=SHORT_LIVED_USER_TOKEN_FROM_STEP_3"
```

The response contains a new `access_token`. This is the **long-lived user
token**, valid about 60 days.

## Step 5 — Derive the Page token (this is the one that does not expire)

```bash
curl -s -G "https://graph.facebook.com/v21.0/me/accounts" \
  --data-urlencode "access_token=LONG_LIVED_USER_TOKEN_FROM_STEP_4"
```

You get a list of your Pages:

```json
{"data":[{"access_token":"EAA...","name":"SmartlyDigit","id":"1234567890"}]}
```

- `access_token` here is your **Page Access Token**.
- `id` here is your **Page ID** — you need this too.

A Page token derived from a **long-lived** user token has **no expiry**. That
is why step 4 cannot be skipped: a Page token derived from the short-lived
token in step 3 dies in an hour.

## Step 6 — Verify the token really is permanent

```bash
curl -s -G "https://graph.facebook.com/v21.0/debug_token" \
  --data-urlencode "input_token=PAGE_ACCESS_TOKEN" \
  --data-urlencode "access_token=YOUR_APP_ID|YOUR_APP_SECRET"
```

In the response check:

- `"type": "PAGE"`
- `"expires_at": 0`  ← **0 means never expires.** If this is a timestamp, your
  step-4 exchange did not take; redo steps 4-5.
- `"scopes"` includes `pages_manage_posts` and `pages_read_engagement`.

## Step 7 — Store it in n8n (never in code)

In n8n: **Credentials → New → Header Auth**

- Name: `Facebook Page - SmartlyDigit`
- Header name: `Authorization`
- Header value: `Bearer PAGE_ACCESS_TOKEN`

The Publisher workflow references this credential by name. The token never
appears in workflow JSON.

Then put the **Page ID** (not secret) into the `config` data table:
row `FB_PAGE_ID`.

---

## Things that will bite you

- **Using a personal profile instead of a Page.** `/{id}/photos` posting only
  works for Pages. Personal-profile posting was removed from the Graph API.
- **Changing your Facebook password** invalidates all tokens. Redo steps 3-5.
- **Removing yourself as Page admin** invalidates the Page token.
- **App in Development mode is fine**, but if you later add other admins or
  want the app reviewed, the token keeps working regardless.
- **`expires_at` is not 0.** You derived the Page token from the wrong user
  token. Step 4, then step 5 — in that order, same browser session.
