# Before merging to `main`

`main` auto-deploys this Worker. Do not merge until the items below are done,
or the production deploy will fail or real leads will 503. Nothing in this
branch was deployed, and no test lead was sent to the owners.

## Already done

- D1 database `txm-leads` exists. `database_id` in `wrangler.jsonc` is
  `757fb9fe-c7f6-4d08-99b4-00f948de0733`. Migration `0001` is already applied
  remotely. Do not create another database.
- These are Worker **secrets**, not plain vars: `GOOGLE_SCRIPT_URL`,
  `APPS_SCRIPT_TOKEN`, `PHOTO_LINK_SECRET`. Leave them as secrets.
- On 28 Sep 2026 `GOOGLE_SCRIPT_URL` was a dashboard plain var. A deploy wiped
  it because `wrangler.jsonc` did not declare it. Wrangler keeps `secret_text`
  across deploys and deletes undeclared plain vars. Do not add a `vars` block
  for `GOOGLE_SCRIPT_URL` or any other secret. CI only runs
  `wrangler deploy --dry-run` and must not pass `--var` or a secrets file.
- `PHOTO_LINK_SECRET` is set for the optional R2 photo links. The live photo
  path does not use it. Photos go to Google Drive through Apps Script.
- R2 is not enabled on the account. `wrangler.jsonc` has no `r2_buckets`
  binding, so deploy does not require a bucket. Quotes still send with no R2.

## Cloudflare

1. Workers → `txmulching` → Settings → Variables and Secrets. Confirm
   `GOOGLE_SCRIPT_URL` is still the live `/exec` URL and still type Secret.
   Search Workers Logs for `GOOGLE_SCRIPT_URL not configured`,
   `quote_forward_failed`, and `quote_store_failed` since 28 Sep 2026.
2. Turnstile is still pending. Create a widget for `txmulching.com` (managed
   or invisible). Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` together.
   Until both are set, the forms skip the check on purpose so the homepage
   callback form keeps working.
3. Rate-limit bindings (`QUOTE_RL`, `PHOTO_RL`, `CHAT_RL`, `VOICE_RL`) are
   declared in `wrangler.jsonc` and are created on deploy. They count per
   Cloudflare location, keyed by IP.
4. Optional backup channel, only after three failed forwards: set
   `RESEND_API_KEY` and `BACKUP_ALERT_EMAIL` (and `BACKUP_ALERT_FROM` if the
   default sender is wrong), or set `BACKUP_ALERT_URL`. Do not enable
   Cloudflare Email Routing `send_email` unless the owners accept replacing
   the iCloud MX records (`LEAD-NOTIFICATIONS.md` Part 2).
5. Optional: `DEMO_SCRIPT_URL` for a second Apps Script deployment that
   records demo tries. Without it, demo rows still land in D1 `demo_leads`
   and are not emailed to the owners.
6. xAI console: set a monthly spend cap. Voice tokens can still be minted by
   a client that forges `Origin` and `Sec-Fetch-Site` until Turnstile is on.
7. Confirm every subdomain is HTTPS-only before anyone submits
   `txmulching.com` to the HSTS preload list. The header already sends
   `includeSubDomains; preload`. This branch does not submit the domain.

## Google (agavi.aiconsulting@gmail.com)

1. Add Sheet headers J through S if they are empty: Address, City, County,
   Density, Timeline, Callback window, Budget, Photo links, Ref, Source.
2. Paste `apps-script/Code.gs`, set script property `TOKEN` to the same value
   as `APPS_SCRIPT_TOKEN`, run `authorizePhotos` once, and deploy a new
   version. That creates the Drive folder `TX Mulching Lead Photos`. Steps:
   `apps-script/README.md`.
3. Run `testNotification` once, then submit one lead named `TEST — delete me`
   and delete that row. Do this only after the Worker secret is set.
4. A name `=1+1` must show up as the text `=1+1`, not as the number 2.

## Owners (TX Mulching)

1. They already said no prices on the site. This page does not show a budget
   field. `SHOW_BUDGET` in `public/estimate.js` stays `false` until they
   approve the wording. The API will store a `budget` string if a future
   client sends one.
2. No new response-time promise was added. Copy says the owner reviews the
   request and calls back, which is already on the homepage.
3. Confirm Agavi may show the dismissible "Live demo by Agavi AI" bar only
   when the URL contains `demo=1`. A `ref` alone does not turn on demo mode,
   so a real customer link with a tracking ref still reaches the owners.
4. Do not send follow-ups to the 44 prospects until this is live. Old `/estimate`
   visits may still be stuck on the cached 301. New links need a query string
   that was never 301'd, for example
   `https://txmulching.com/estimate?ref=p07&demo=1`.
5. Photo retention text in `public/privacy.html` says photos are kept in
   Google Drive until the customer asks for deletion or the owners set a
   shorter period. Each file is shared so anyone with the link can view it.
   Publish the real period once they choose it.

## After merge

1. `curl -sI https://txmulching.com/estimate` should be 200, not 301.
2. Submit `?demo=1` and confirm the TX Mulching Sheet and the four inboxes
   stay quiet. Confirm the row is in D1 `demo_leads` (or the demo script).
3. Submit one clearly labelled real test and confirm the Sheet row and one
   alert email.
4. In GA4, mark `estimate_submit` as a key event. DebugView should show
   `estimate_view`, `estimate_step`, and `estimate_submit` with `ref`.
5. Re-run `python3 scripts/build-media.py` when you want the smaller hero
   loop and the 800px gallery files, then add those files to the gallery
   `srcset`s. That script is updated; the binaries in `public/` are not.
6. `media-src/` is still in git. Moving it to Git LFS or R2 and dropping the
   history needs a force push. Leave that as its own decision.
