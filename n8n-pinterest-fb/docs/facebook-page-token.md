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

---

# If developers.facebook.com is blocked in your country

The error "Meta for Developers is not available in this location" blocks the
**developer portal only**. Three different hosts are involved, and they are
not blocked together:

| Host | What it is for | Needed when |
|---|---|---|
| `developers.facebook.com` | create an app, Graph API Explorer | once, to create an app |
| `www.facebook.com` | the normal site, **and the OAuth login dialog** | once, to approve access |
| `graph.facebook.com` | the API n8n actually calls | continuously |

Verified from this project's n8n host: `graph.facebook.com` answers normally.
So **publishing is not affected** - only the one-time act of creating an app.

There are two ways around it. Both end with the same Page token.

## Option A - tunnel through your own server

Your n8n host is in the US, where the portal is available. An SSH tunnel
through it is your own infrastructure, not a third-party VPN.

```bash
# on your machine; keeps running while you use the browser
ssh -D 1080 -N -C user@your-n8n-host
```

Then point a browser at it:

- **Firefox**: Settings -> search "proxy" -> Network Settings -> Settings ->
  Manual proxy configuration -> SOCKS Host `127.0.0.1`, Port `1080`,
  **SOCKS v5**, and tick **Proxy DNS when using SOCKS v5**.
- **Chrome**: needs a launch flag or an extension; Firefox is less trouble.

Check it worked by opening <https://ifconfig.me> - it should show the
server's address, not yours. Then follow steps 1-7 above as normal.

Turn the proxy off afterwards. The tunnel is needed **only** while creating
the app and minting the token; n8n never needs it.

## Option B - no portal at all, using someone else's App ID

This is the "just log me in" route. You never open the developer portal; you
log in on `www.facebook.com` like normal and approve access.

You need two things from somebody who already has a Meta app (any developer
friend, or your own app created once via Option A):

1. the **App ID**
2. that they add `https://www.facebook.com/connect/login_success.html` to the
   app's **Valid OAuth Redirect URIs** (App settings -> Facebook Login ->
   Settings). One click for them, and it exposes nothing of theirs.

They must NOT send you the App Secret over chat. You only need it for step 3
below; ask them to run that one command themselves and send you the result,
or to add your Facebook account to their app as an Administrator so you can
read the secret yourself.

### Step 1 - log in and approve (this is the login dialog you wanted)

Open this URL in your normal browser, substituting the App ID:

```
https://www.facebook.com/v21.0/dialog/oauth
  ?client_id=APP_ID
  &redirect_uri=https://www.facebook.com/connect/login_success.html
  &response_type=token
  &scope=pages_manage_posts,pages_read_engagement,pages_show_list
```

(put it on one line, without the spaces)

Facebook shows its own login and permission screen. Approve it. You land on a
blank "Success" page, and the token is in the **address bar**:

```
https://www.facebook.com/connect/login_success.html#access_token=EAA...&expires_in=5183944
```

Copy the value between `access_token=` and the next `&`. This is a
**short-lived user token**.

### Step 2 - check the permissions really came through

```bash
curl -s -G "https://graph.facebook.com/v21.0/me/permissions" \
  --data-urlencode "access_token=SHORT_LIVED_USER_TOKEN"
```

`pages_manage_posts` and `pages_read_engagement` must both show as `granted`.

### Step 3 - make it long-lived, then get the Page token

Same as steps 4-6 at the top of this file: `fb_exchange_token`, then
`/me/accounts`, then verify with `debug_token` that `expires_at` is `0`.

All three calls are against `graph.facebook.com`, which is not blocked - so
they work from your machine or from the n8n host, whichever answers.

## What is NOT an option

Giving n8n your Facebook **password** so it can log in like a browser.

- It breaks Facebook's terms, and the penalty is losing the account - and with
  it the Page this whole system posts to.
- A login from a datacenter IP with an unfamiliar device fingerprint looks
  exactly like an account takeover, so it triggers a checkpoint immediately,
  and 2FA stops the automation dead.
- A password grants **everything**; a Page token grants "post to this Page"
  and is revocable in one click.
- n8n has no such credential anyway: its `facebookGraphApi` credential type
  accepts a single `accessToken` field and nothing else.

The token flow above is the supported version of the same idea: you log in
once, on Facebook's own site, and what n8n keeps afterwards is a narrow,
revocable key rather than your password.
