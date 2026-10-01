# Creating the Meta app through your own server (SSH tunnel)

The developer portal is blocked from your location but available from the n8n
host, which is in the US. An SSH tunnel through that host is your own
infrastructure - no third-party VPN involved.

The tunnel is needed **only** while you create the app and connect the
credential. n8n never needs it: it talks to `graph.facebook.com`, which
already answers from the server.

Total time about 15 minutes. Work top to bottom.

---

## 1. Open the tunnel

On your own machine, in a terminal you can leave running:

```bash
ssh -D 1080 -N -C user@your-n8n-host
```

- `-D 1080` opens a SOCKS5 proxy on your machine, port 1080
- `-N` means "do not run a command, just forward"
- `-C` compresses, which makes the portal noticeably less sluggish

No output means it is working. Leave the window open.

If port 1080 is taken, use another (`-D 1081`) and adjust step 2.

## 2. Point a browser at the tunnel

**Firefox** (least trouble):

1. Settings → search `proxy` → **Network Settings** → **Settings…**
2. **Manual proxy configuration**
3. **SOCKS Host** `127.0.0.1`, **Port** `1080`, select **SOCKS v5**
4. Tick **Proxy DNS when using SOCKS v5** ← easy to miss, and without it
   DNS still goes out through your own connection
5. OK

**Verify before continuing.** Open <https://ifconfig.me> — it must show the
**server's** address, not yours. If it shows yours, the proxy is not in
effect and the portal will keep refusing.

(Chrome needs a launch flag or an extension for SOCKS, so use Firefox for
these 15 minutes.)

## 3. Create the app

1. <https://developers.facebook.com/apps/> → **Create app**
2. Name: anything (`SmartlyDigit Poster`). Contact email: yours.
3. Use case: **Other** → app type **Business**
4. Business Portfolio: pick the existing one, or create one
5. Create

**Leave the app in Development mode.** It does not need to go Live, and it
does not need App Review, because you are an admin of the Page you will post
to. Going Live would require a Privacy Policy URL you do not need.

## 4. Add Facebook Login and the redirect URI

This is the step that creates the setting you could not find earlier: before
the product is added, there is no redirect-URI field anywhere.

**Older dashboard layout:**
1. Left menu → **Add product** → find **Facebook Login** → **Set up**
2. Left menu now shows **Facebook Login → Settings**
3. Into **Valid OAuth Redirect URIs** paste:

```
https://n8ntestsrb.duckdns.org/rest/oauth2-credential/callback
```

4. **Save changes**

**Newer dashboard layout:**
1. **Use cases** → "Authenticate and request data from users with Facebook
   Login" → **Customize**
2. In **Permissions**, make sure these are added:
   `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
3. In that use case's **Settings**, paste the same redirect URI and save

n8n shows the exact redirect URL inside the credential dialog — if it differs
from the line above, trust n8n's version.

## 5. Copy the two values

**App settings → Basic**:

- **App ID** — not secret
- **App Secret** — click **Show**. Treat it like a password: do not paste it
  into chat, a ticket, or a repository.

## 6. Connect the credential in n8n

You can do this with the proxy still on, or turn it off first — n8n is
reachable either way.

1. n8n → **Credentials** → open **Facebook OAuth (login)**
2. **Client ID** = App ID, **Client Secret** = App Secret
3. **Save**
4. Click **Connect my account**

Facebook's own login window opens. Log in, approve the permissions for your
Page. The window closes and the credential shows **Connected**.

This is the login step you wanted. It happens once, not on every run.

## 7. Switch publishing on

In the `config` data table:

| key | set to |
|---|---|
| `DRY_RUN` | `false` |
| `AUTH_MODE` | `oauth` (already the default) |

`FB_PAGE_ID` can stay empty — each run derives the Page and its token from
the login.

Then **activate `C - Publisher`**.

## 8. Turn the proxy back off

Firefox → Settings → Network Settings → **No proxy**, and close the ssh
window. Nothing afterwards needs the tunnel.

---

## Then what happens

- `C - Publisher` wakes every 30 minutes
- queued posts more than 10 minutes out are handed to Facebook with
  `scheduled_publish_time`, and Facebook publishes them at 10:00 / 15:00 /
  20:00
- anything whose slot already passed is published immediately
- the row goes to `scheduled`, then `posted`
- failures land in `errors_log` with the Graph API message, and are retried
  once after 30 minutes

You never touch it again except to add boards.

## If something refuses

| Symptom | Cause |
|---|---|
| portal still says "not available in this location" | the proxy is not in effect — re-check <https://ifconfig.me> and the SOCKS DNS tick |
| "URL blocked" after clicking Connect my account | the redirect URI in step 4 does not match the one n8n shows, character for character |
| credential connects, but `Pick Page` says `no_pages` | the login did not grant `pages_show_list`, or the account is not an admin of the Page |
| `Pick Page` says `page_id_required` | the account manages several Pages — put the right id in `FB_PAGE_ID` |
| Graph error code 190 | the login expired or was revoked — click **Connect my account** again |

Every one of these is reported by name in `errors_log`, with the remedy in
the `hint` field.
