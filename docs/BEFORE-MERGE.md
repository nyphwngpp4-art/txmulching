# Before merging to `main`

`main` auto-deploys this Worker. Do not merge until the items below are done,
or the production deploy will fail or real leads will 503. Nothing in this
branch was deployed, and no test lead was sent to the owners.

## Cloudflare

1. Workers → `txmulching` → Settings → Variables and Secrets. Confirm
   `GOOGLE_SCRIPT_URL` is the live `/exec` URL. The archived URL that used to
   be hard-coded in `quote.js` is gone. Search Workers Logs for
   `GOOGLE_SCRIPT_URL not configured`, `quote_forward_failed`, and
   `quote_store_failed` since 28 Sep 2026.
2. `npx wrangler d1 create txm-leads`. Replace `database_id` in
   `wrangler.jsonc` (the current value is a placeholder). Then
   `npx wrangler d1 migrations apply txm-leads --remote`.
3. `npx wrangler r2 bucket create txm-lead-photos`. Leave the bucket private.
   Add a lifecycle rule: delete `drafts/` after 2 days. Do not delete
   `leads/` until the owners pick a retention period (decision 7 in
   `REVIEW-OPUS.md`).
4. `openssl rand -hex 32` twice. Store one as Worker secret
   `APPS_SCRIPT_TOKEN` and the other as `PHOTO_LINK_SECRET`.
5. Turnstile: create a widget for `txmulching.com` (managed or invisible).
   Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` together. Until both are
   set, the forms skip the check on purpose so the homepage callback form
   keeps working.
6. Rate-limit bindings (`QUOTE_RL`, `PHOTO_RL`, `CHAT_RL`, `VOICE_RL`) are
   declared in `wrangler.jsonc` and are created on deploy. They count per
   Cloudflare location, keyed by IP.
7. Optional backup channel, only after three failed forwards: set
   `RESEND_API_KEY` and `BACKUP_ALERT_EMAIL` (and `BACKUP_ALERT_FROM` if the
   default sender is wrong), or set `BACKUP_ALERT_URL`. Do not enable
   Cloudflare Email Routing `send_email` unless the owners accept replacing
   the iCloud MX records (`LEAD-NOTIFICATIONS.md` Part 2).
8. Optional: `DEMO_SCRIPT_URL` for a second Apps Script deployment that
   records demo tries. Without it, demo rows still land in D1 `demo_leads`
   and are not emailed to the owners.
9. xAI console: set a monthly spend cap. Voice tokens can still be minted by
   a client that forges `Origin` and `Sec-Fetch-Site` until Turnstile is on.
10. Confirm every subdomain is HTTPS-only before anyone submits
    `txmulching.com` to the HSTS preload list. The header already sends
    `includeSubDomains; preload`. This branch does not submit the domain.

## Google (agavi.aiconsulting@gmail.com)

1. Add Sheet headers J through S if they are empty: Address, City, County,
   Density, Timeline, Callback window, Budget, Photo links, Ref, Source.
2. Paste `apps-script/Code.gs`, set script property `TOKEN` to the same value
   as `APPS_SCRIPT_TOKEN`, and deploy a new version. Steps:
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
5. Photo retention text in `public/privacy.html` says photos are kept until
   the customer asks for deletion or the owners set a shorter period. Publish
   the real period once they choose it, and match the R2 lifecycle rule.

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
