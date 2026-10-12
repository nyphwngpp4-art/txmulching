# Spam protection on quote leads

`/estimate` and the homepage callback form both POST to `/api/quote`. Three checks run before a lead is emailed. `?demo=1` still never calls `GOOGLE_SCRIPT_URL`. A `ref` by itself does not turn on demo mode.

## 1. Honeypot and minimum time

The forms include a hidden `website` field. If it is filled, the Worker answers success and does not store or forward the lead.

JavaScript sends `elapsedMs`, the time since the page script started. Under about 3 seconds the Worker answers success and drops the lead. A no-JS submit has no `elapsedMs` and is not dropped for timing. A missing `elapsedMs` on a JSON post still gets the existing "wait a moment" error, so an older cached script can retry.

## 2. Scoring

The Worker scores the name, address, city, county, acreage, and message (`description`, or `message` when that is what the client sent). Points land on:

- a URL in that text (an email address alone does not count)
- unsubscribe, SEO, backlinks, ranking, B2B, "per month" or "/mo", "phone agent", "send files", "farm project"
- a missing ZIP, or a ZIP outside the usual Canton-area prefixes `751`, `754`, `756`, `757`, `758`
- a blank acreage
- the same email or phone as a lead stored in the last 10 minutes

A far ZIP by itself is not spam. Nacogdoches, Vidor, and other Texas jobs are still forwarded. "Within a month" is the timeline choice and is not treated as "per month".

| Score | What happens |
| --- | --- |
| High (8 or more) | Stored in D1 `leads` with `status` `spam`. Not forwarded to the Google Sheet, and the 5-minute retry skips it. The browser still sees a normal success response. |
| Borderline (4–7) | Stored with `status` `possible` and forwarded. The JSON includes `possibleSpam: "yes"`. |
| Low | Forwarded as usual. |

The Apps Script writes `possibleSpam` into column T (**Possible spam**) and prefixes the email subject with "Possible spam" when that field is `yes`. The script that is live today ignores unknown JSON fields, so borderline leads are still forwarded before you redeploy `apps-script/Code.gs`. High-score spam is dropped by the Worker either way. Redeploy steps are in `apps-script/README.md`.

Apply the D1 column before or with the deploy:

```
npx wrangler d1 migrations apply txm-leads --remote
```

If that reports `duplicate column name: status`, the Worker already added the column and the schema is already correct.

## 3. Cloudflare Turnstile

The widget is already on `/estimate` and the homepage callback form. It stays off until both secrets exist. `/api/public-config` returns the site key only. The secret never goes to the browser. Photo upload and voice start use the same server check.

The Worker calls `https://challenges.cloudflare.com/turnstile/v0/siteverify` only when both of these are set:

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

`TURNSTILE_SECRET` is still read if `TURNSTILE_SECRET_KEY` is empty, so an older secret name keeps working. One key by itself does nothing: the form keeps working and siteverify is skipped. Do not add these names to `secrets.required` in `wrangler.jsonc` until the values exist. A required secret that is missing fails the deploy. Do not put them in a `vars` block.

### Create the widget

1. Open the [Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile).
2. Select **Add widget** (or **Set up with Spin**).
3. Widget name: `TX Mulching leads`.
4. Hostnames: `txmulching.com` and `www.txmulching.com`. Add `localhost` only if you need it for `wrangler dev`. Do not rely on a localhost hostname in production.
5. Widget mode: **Managed**. The page renders the widget explicitly and uses interaction-only mode, so visitors see a challenge only when Turnstile asks for one.
6. Create the widget and copy the site key and the secret key.

From Wrangler 4.109 or later you can create the same widget in a terminal:

```
npx wrangler turnstile widget create "TX Mulching leads" \
  --domain txmulching.com \
  --domain www.txmulching.com \
  --mode managed
```

Wrangler prints the site key and the secret. Store the secret. Do not commit it.

### Set the Worker secrets

Cloudflare → Workers → `txmulching` → Settings → Variables and Secrets, or:

```
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Paste one value per prompt. Secrets are available on the next request. The site key is public; the page loads it from `/api/public-config`. Leave both unset until you are ready. The forms, including `?demo=1&ref=`, keep working without them.

For a local check, put the same names in `.dev.vars`. Cloudflare's dummy keys exercise the widget without a real challenge: site key `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA` always pass siteverify. Do not use those values in production.
