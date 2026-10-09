# Review: txmulching.com `/estimate` as the Agavi demo

Review only; no app code was changed. Written 2026-10-09 against `main` @ `bdf76da`.

## TL;DR

**The demo prospects were sent does not exist.** On 2026-09-28 (commit `6b50606`, four days before the Oct 2 send) the estimator was deleted and `/estimate` became a **301 redirect to the homepage callback form** (`public/_redirects`). I confirmed this on production:

```
$ curl -sI https://txmulching.com/estimate
HTTP/2 301
location: /#quote
```

So a Phoenix pool builder who taps the link sees an East Texas forestry-mulching homepage, scrolled to a "Request a Callback" form: name, phone, email, ZIP, acreage, service, and a free-text box. That form has none of what the email sells: no photos, no budget, no address, no scheduling, and nothing that shows the owner being alerted. To a skeptical contractor it looks exactly like a plain contact form. The page can't be blamed for every one of the 0/44 replies (cold email reply rates are low regardless), but in its current state it cannot back up the pitch. **Don't send follow-ups until R01–R03 ship.**

Beyond that, the site is in decent shape. On mobile the homepage scores 99 for performance (LCP 2.0 s, CLS 0). The API code is careful about validation and secrets. The main reliability risk is that a lead is lost outright if the single Google Apps Script hop fails.

## What I checked

- Read all app code (`src/worker.js`, `functions/api/*.js`, `public/*`), config (`wrangler.jsonc`, `_headers`, `_redirects`) and the three docs.
- Production probes (read-only apart from the noted cost): `/estimate` returns 301 to `/#quote` and keeps the query string. An empty `POST /api/quote` is rejected with a 400 (no lead created). One `/api/chat` message got a 200, so chat is activated. One `/api/voice-token` call with a spoofed `Origin` from curl got a 200, so voice is activated and its tokens can be minted from outside a browser (a few cents of xAI usage). A GET on the Apps Script URL hard-coded in `quote.js` returns Google's 404 "unable to open the file", meaning that deployment is archived.
- Lighthouse 12, mobile emulation, against production:

| URL | Perf | A11y | Best practices | SEO | Notes |
|---|---|---|---|---|---|
| `/estimate` | n/a (NO_LCP because of the redirect) | 96 | 100 | 100 | 3,579 KiB total; footer color-contrast fails |
| `/` | 99 | — | — | — | FCP 1.6 s, LCP 2.0 s (hero AVIF), TBT 40 ms, CLS 0; 2,475 KiB is the hero video |

## Decisions and credentials a human must provide

1. **TX Mulching owners' sign-off** on rebuilding `/estimate` as a richer intake (R01). The Sep 28 owner decision was "no pricing on the website." Asking for the *customer's* budget isn't publishing a price, but budget ranges imply price levels, so the owners need to approve that field and its wording. They also need to approve any response-time promise ("we call back the same day").
2. **Whether Agavi may show a demo banner** on the client's site when a `?demo=` link is used (R03). Real customers would never see it.
3. **Pause follow-ups** to the 44 prospects until the new `/estimate` is live, and send them the new tagged URLs from R02.
4. **Cloudflare account access** to: list Worker secrets, create D1 and R2 resources, create a Turnstile widget, read zone analytics.
5. **Google account `agavi.aiconsulting@gmail.com`** (owner of the Apps Script) to redeploy the script (R04, R05, R09).
6. **xAI console** access to set a monthly spend cap (R10).
7. **Photo retention period** and the matching privacy-policy text (R06).
8. **Backup alert channel**: Cloudflare Email Routing's `send_email` would replace the iCloud MX records (see `LEAD-NOTIFICATIONS.md` Part 2), so either decide that migration or approve a transactional email API key, for example Resend or Postmark (R05).

Effort scale: **S** = one or two files, under about 100 lines. **M** = several files or one new binding. **L** = a new page or flow plus API and Apps Script changes.

---

## P0: fix before any further outreach

### R01 · P0 · Rebuild `/estimate` as a real mobile-first smart intake (no prices)

**Problem.** `/estimate` no longer exists. `public/_redirects` lines 2–3 send `/estimate` and `/estimate.html` to `/#quote` with a 301, and `README.md` line 9 says "the instant estimator was retired". The target form (`public/index.html` lines 291–301) is a generic callback form. Nothing on it shows the features in the pitch (photos, budget, address, scheduling, instant owner alert). It is also buried under a 38-second hero video, a gallery and eight service cards, all about forestry mulching in Canton, TX.

**Recommendation.** Create `public/estimate.html` (served as `/estimate`) as a short, stepped intake. It should be a real TX Mulching page that helps their actual customers, without prices or Agavi branding in normal mode.
- **First screen on a 390 px phone:** minimal header with logo and a tap-to-call link. Headline in TX Mulching's voice, for example "Get your land-clearing quote started — 60 seconds". Subline: "Send photos and the property location. The owner reviews them and calls you back." Add the response time only if the owners approve it. Show a "Step 1 of 4" progress bar, with the first question visible without scrolling.
- **Step 1, the job:** large tap tiles for service type. Acreage chips (under 1, 1–3, 3–10, 10–25, 25+). Brush-density tiles ("can walk through / can drive through / wall of trees"), the same qualifying question used in `PHONE-AGENT-SETUP.md` line 50.
- **Step 2, the property:** street address or nearest road, plus city and county, with `autocomplete="street-address"`. Show a soft "outside our usual area, we'll still call" note when the ZIP is far from Canton. Skip "use my location" unless `Permissions-Policy` is changed (see R15).
- **Step 3, photos:** "Add photos of the brush (optional, up to 6)" using `<input type="file" accept="image/*" multiple>`, with thumbnails and a remove button. Leave out `capture` so people can pick from their gallery. Upload details are in R06.
- **Step 4, timing and budget:** timeline chips (ASAP / within a month / 1–3 months / just planning). Preferred callback window (morning / afternoon / evening). That is the "scheduling" piece, without promising dates. Budget only if the owners approve (decision 1), for example optional ranges or a free-text "Have a budget in mind?".
- **Step 5, contact:** name, mobile phone (required for a callback business), email optional, then submit.
- Save the draft to `sessionStorage` after each step, so a phone call or tab switch doesn't lose it.
- Success screen: reference number, "what happens next", tap-to-call, and in demo mode the alert preview from R03.
- Load no hero video, gallery or chat widget on this page. Weight budget: under 250 KB transferred.
- Progressive enhancement: with JS off it should still render as one long `<form method="post" action="/api/quote">`. The Worker accepts `multipart/form-data` and redirects to `/estimate?sent=1`.
- Extend `functions/api/quote.js` to accept and validate the new fields (`address`, `density`, `timeline`, `callbackWindow`, `budget`, `photoKeys[]`, `ref`), each with a max length or an enum. Extend the Apps Script `appendRow` and email body to match (the human deploys this).
- Leave the homepage `#quote` form in place. Pointing homepage CTAs at `/estimate` can be decided later from data.
- Remove both lines from `public/_redirects` in the same change.

**Verify.** `curl -sI https://txmulching.com/estimate` returns 200. On a real iPhone (Safari) and Android (Chrome), complete the flow with three camera photos in under about 90 seconds. Lighthouse mobile on `/estimate`: Performance at least 95, Accessibility at least 95, transfer under 250 KB. A test submission writes one Sheet row with every new column and sends one alert containing the photo links.

**Effort.** L. **Needs human:** decision 1, plus the Apps Script redeploy.

### R02 · P0 · Stop the permanent redirect now; use fresh, tagged links for follow-ups

**Problem.** A 301 is cached by browsers, often indefinitely. Every prospect who already tapped the Oct 2 link may keep getting redirected to `/#quote` even after R01 ships. Production confirms the 301 and that it carries no `Cache-Control`.

**Recommendation.** Before R01 lands, change the two lines in `public/_redirects` to `302`. When R01 ships, delete them. Follow-up emails should use URLs that were never 301'd and that identify the prospect, for example `https://txmulching.com/estimate?ref=p07&demo=1`. Browser redirect caches are keyed by the full URL, so a new query string avoids the stale redirect and also gives per-prospect attribution (R07).

**Verify.** `curl -sI https://txmulching.com/estimate` shows `302` now and `200` after R01. Open a `?ref=` link in a browser profile that previously visited `/estimate`; it should land on the new page.

**Effort.** S, a one-line change. **Needs human:** follow-up timing (decision 3).

### R03 · P0 · Add a demo mode: show the "instant owner alert" and keep test leads away from TX Mulching

**Problem.** The core selling point, that the owner is notified instantly with everything they need, is invisible to the prospect. And if a curious prospect submits a test today, it writes to the real "TX Mulching Quote Leads" Sheet and emails Hal, Kim, `info@` and Jay (`LEAD-NOTIFICATIONS.md` lines 30–35). That means fake leads for a real client, which damages the reference Agavi depends on.

**Recommendation.**
- When the URL has `demo=1` (or a `ref` that marks a prospect), show a slim, dismissible top bar: "Live demo by Agavi AI — demo submissions are not sent to TX Mulching." Store the flag in `sessionStorage` so it survives step navigation, and send `demo: true` to the API.
- In `quote.js`, when `demo` is true, skip the Sheet and owner emails. Write to a separate sink instead: an `env.DEMO_SCRIPT_URL` Apps Script or a D1 `demo_leads` table, so Agavi can see who tried it.
- On the success screen in demo mode, render **"Here's the alert the owner just got"**: a phone-notification-style card with name, tap-to-call number, acreage, density, timeline, a Google Maps link to the address, and photo thumbnails, timestamped "sent 2 seconds ago". This is what makes it obviously better than a contact form.
- Optional, needs a decision: send that alert to the prospect's own email. Only do this behind Turnstile and a strict rate limit (R10), because a form that sends email to any address is an abuse vector, and MailApp's daily quota is shared with real leads (R09).

**Verify.** A `?demo=1` submission shows the banner and alert preview, writes nothing to the TX Mulching Sheet, and sends no owner email (check the inbox and the Sheet). Without `demo`, behavior is unchanged.

**Effort.** M. **Needs human:** decision 2, and creating the demo sink.

### R04 · P0 · Confirm production leads are actually delivered; remove the dead fallback URL

**Problem.** `functions/api/quote.js` line 4 hard-codes `DEFAULT_GOOGLE_SCRIPT_URL`, and line 92 uses it when `env.GOOGLE_SCRIPT_URL` is unset. That deployment now returns Google's 404 page (it was archived per `LEAD-NOTIFICATIONS.md` Part 3 step 5). So production leads work **only if** the `GOOGLE_SCRIPT_URL` secret is set. If it isn't, every submission currently returns a 502 and the lead is discarded (see R05). I could not check the secret without Cloudflare access, and I did not submit a fake lead to the owners' inboxes.

**Recommendation.**
- Human: Cloudflare dashboard → Workers → `txmulching` → Settings → Variables and Secrets, and confirm `GOOGLE_SCRIPT_URL` exists. Then submit one lead clearly labelled `TEST — delete me` and confirm the Sheet row (with Request ID) and all four emails. Also search Workers Logs for `Quote not stored` / `Quote submission failed` since Sep 28.
- Code: delete `DEFAULT_GOOGLE_SCRIPT_URL`. If `env.GOOGLE_SCRIPT_URL` is missing, `console.error('GOOGLE_SCRIPT_URL not configured')` and return 503 with the existing call-us message. Add a committed `.dev.vars.example` listing `GOOGLE_SCRIPT_URL`, `XAI_API_KEY`, `ALLOWED_ORIGINS`. `.gitignore` already allows that file. Update `LEAD-NOTIFICATIONS.md` "Open items".

**Verify.** `wrangler dev` without the variable returns 503 and logs the message. With it set, the test lead round-trips.

**Effort.** S. **Needs human:** Cloudflare and Gmail access for the check.

---

## P1: reliability, attribution and abuse

### R05 · P1 · Never lose a lead: store first, then forward, with timeout and retry

**Problem.** `quote.js` lines 94–114 make a single `fetch` to Apps Script with **no timeout**, no retry, and no local copy. On any failure the visitor sees "temporarily unavailable" and the lead's contents are gone: the log line records only `requestId`, status and 200 characters of the upstream body, not the lead. Apps Script cold starts and Google incidents are routine. For a product sold on "never miss a lead", this is the weakest link.

**Recommendation.**
- Add a D1 database (`wrangler d1 create txm-leads`, binding `LEADS`) with a `leads` table: `request_id` primary key, `created_at`, `payload_json`, `forwarded_at`, `attempts`, `last_error`.
- In `quote.js`, `INSERT` first. A successful insert counts as "confirmed storage", which keeps the intent of commit `87f2f58`, and the visitor gets success.
- Then forward to Apps Script inside `ctx.waitUntil` with an `AbortController` timeout of about 10 s, and mark the row `forwarded_at` on `{ok:true}`.
- Add a Cron Trigger every 5 minutes that retries unforwarded rows with backoff. After about 3 failures, send a backup alert through whichever channel decision 8 picks.
- Keep the existing 502 path only for when D1 itself fails.

**Verify.** Unit test (see R14): with the upstream mocked to time out, the response is 200, the row exists with `forwarded_at` null, and the cron handler forwards it once the mock recovers. On production, temporarily point `GOOGLE_SCRIPT_URL` at a 500 URL on a preview deployment and confirm the backup alert fires.

**Effort.** M. **Needs human:** D1 creation, and decision 8.

### R06 · P1 · Photo upload pipeline (R2, private, compressed on the device)

**Problem.** Photos are the most visible "smarter intake" feature, and for land clearing they're the most useful input for quoting. There is no upload path. `quote.js` line 56 rejects bodies over 20 KB, and the privacy policy (`public/privacy.html` line 34) doesn't mention photos.

**Recommendation.**
- **Client:** on file selection, decode with `createImageBitmap`, resize to at most 1600 px on the long edge, and `canvas.toBlob('image/jpeg', 0.8)`. Typically 200–400 KB per photo on cellular. If decoding fails, upload the original when it's 10 MB or less. Start uploading immediately in the background while the visitor continues, with a per-thumbnail progress and retry. Max 6 photos.
- **Upload endpoint:** new `POST /api/quote-photo` routed in `src/worker.js`. Same origin and rate checks, plus Turnstile (R10). Check magic bytes (JPEG `FFD8FF`, PNG, WebP; reject everything else), enforce 5 MB or less after compression, and `put` to a **private** R2 bucket (binding `LEAD_PHOTOS`) under `drafts/<uuid>/<n>.jpg`. Return the key.
- **On submit:** `quote.js` moves the referenced keys to `leads/<requestId>/` (copy and delete). An R2 lifecycle rule deletes `drafts/` after 2 days and `leads/` after the agreed retention period.
- **Links in the owner's alert:** `https://txmulching.com/api/lead-photo/<requestId>/<n>?exp=<ts>&sig=<HMAC-SHA256>` using secret `PHOTO_LINK_SECRET`. The route checks the signature and streams from R2, so the bucket is never public. Use an expiry of 30–90 days.
- Add `blob:` to `img-src` in `public/_headers` for previews, and update the privacy policy.

**Verify.** An iPhone HEIC photo picked from the library uploads as a JPEG under 500 KB. A `.exe` renamed to `.jpg` is rejected. An alert link opens the photo, and a tampered `sig` returns 403. `drafts/` objects disappear after the lifecycle period.

**Effort.** L. **Needs human:** R2 bucket and lifecycle rule, retention decision (decision 7).

### R07 · P1 · Find out whether any of the 44 even clicked, and measure the funnel from now on

**Problem.** Nobody can tell today. `_redirects` runs in the static-asset layer before the Worker (`wrangler.jsonc` `run_worker_first` covers only `/api/*` and `/video/*`), so Worker logs never see `/estimate`. After the redirect, GA4 records the landing page as `/`. `public/analytics.js` tracks only `quote_submit` and `phone_click`.

**Recommendation.**
- Human, now: check the cold-email tool's click tracking, and in Cloudflare → `txmulching.com` → Analytics/Security events, filter by path `/estimate` for Oct 2–9 to count hits (this may need a plan with request logs). In GA4, look at sessions landing on `/` with `utm_*` or no referrer on Oct 2–3.
- Code, in R01's page: read `ref`/`utm_*` once, store them in `sessionStorage`, send them with the lead, and set them as GA4 event parameters. Add events `estimate_view`, `estimate_step` (`step`), `estimate_photo_added`, `estimate_submit`, `estimate_error` (`code`). Mark `estimate_submit` as a key event. With R03's demo sink, Agavi then knows which prospect opened, how far they got, and whether they tried a submit, which is a strong signal for follow-up.

**Verify.** GA4 DebugView shows the event sequence with `ref=p07`. The demo D1 row carries `ref`.

**Effort.** S for code. **Needs human:** dashboard checks.

### R08 · P1 · The bot-timing check rejects real people (clock skew, 2-hour ceiling, "refresh" wipes the form)

**Problem.** `public/script.js` line 66 stamps `formStartedAt` with the **device clock**, and `quote.js` lines 67–71 compare it with the **server clock**. It rejects anything under 2 s or over 2 hours. A phone whose clock runs a few minutes fast gets a negative age and fails. A contractor who opens the email at 7 a.m. and finishes the form at lunch fails. Either way the error says "Please refresh the page and try again", and refreshing throws away everything they typed.

**Recommendation.** Send `elapsedMs = Math.round(performance.now() - t0)` from the client, which is monotonic and immune to clock skew. Server: reject only if `elapsedMs < 3000`, with no upper bound (or 24 h). Change the message to "Please wait a moment and tap Send again", and never ask for a refresh. Combine this with R01's `sessionStorage` draft.

**Verify.** Unit tests for `elapsedMs` of 1000 (rejected), 5000 (accepted) and 10,800,000 (accepted). Manually, set the phone clock 10 minutes ahead and submit successfully.

**Effort.** S.

### R09 · P1 · Harden the Apps Script: shared secret, formula injection, quota, better alert

**Problem.** Script code in `LEAD-NOTIFICATIONS.md` lines 26–116:
- `doPost` accepts any JSON from anyone who has the `/exec` URL. There's no shared secret, so the URL is the only credential, and it has leaked once already (Part 3).
- `appendRow` writes visitor-supplied strings directly. A name like `=HYPERLINK("https://evil.example","Call me")` or `=IMPORTXML(...)` becomes a live formula in the owners' Sheet. The Worker's `clean()` (`quote.js` line 17) only strips `<` and `>`.
- MailApp on a consumer Gmail account allows about 100 recipients a day. With 4 recipients per lead, that is about 25 leads a day. A spam burst exhausts it, and real alerts then fail with only a `console.error` in the script.
- The alert subject is "New TX Mulching lead: Name (phone)", which tells the owner nothing about the job from a lock screen.

**Recommendation.**
- Worker: send `token: env.APPS_SCRIPT_TOKEN`. Script: compare it with `PropertiesService.getScriptProperties().getProperty('TOKEN')` and return `{ok:false}` on mismatch.
- In both the Worker and the script, prefix `'` to any value that starts with `=`, `+`, `-`, `@`, tab or CR.
- Script: send **one** email with all recipients in BCC after checking `MailApp.getRemainingDailyQuota()`. Below a threshold, send a single "quota low" email to Jay.
- Subject: `New lead: 12 ac forestry mulching near Tyler — Jane D. (903) 555-0100`. Body: address with a Google Maps link, density, timeline, callback window, photo links (R06), reference.
- Copy the final script into the repo as `apps-script/Code.gs` so it is reviewed like code instead of living only in a Markdown block.

**Verify.** POST without the token: no row is written. Submit the name `=1+1`: the Sheet shows the literal text `=1+1`. The test alert has the new subject format.

**Effort.** S for code. **Needs human:** redeploy from `agavi.aiconsulting@gmail.com`, and set the script property and Worker secret.

### R10 · P1 · Real abuse controls: Turnstile and Cloudflare rate limiting, and cap xAI spend

**Problem.**
- All three routes rate-limit with an in-memory `Map` per isolate (`quote.js` lines 7 and 25–32, `chat.js` lines 10 and 24–31, `voice-token.js` lines 7 and 21–28). Cloudflare runs many short-lived isolates, so the limits are close to meaningless, and the Maps never evict old IPs.
- The `Origin` check is trivially spoofed outside a browser. I minted a production voice token with curl and a fake `Origin` header and got a 200. Each token opens a billable xAI realtime session.
- The quote form relies only on a honeypot and the timing check from R08, and spam directly threatens the MailApp quota from R09.

**Recommendation.**
- Add Workers Rate Limiting bindings in `wrangler.jsonc`, for example `"ratelimits": [{ "name": "QUOTE_RL", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }, …]`, keyed by `cf-connecting-ip`, for quote, photo, chat and voice-token. Delete the Map code.
- Add Cloudflare Turnstile (managed or invisible) to quote submit, photo upload and voice start. Verify server-side via `siteverify` with `TURNSTILE_SECRET`. Add `https://challenges.cloudflare.com` to `script-src` and `frame-src` in `public/_headers`.
- Human: set a monthly spend limit in the xAI console.

**Verify.** A burst of 10 quote POSTs in under 60 s from one IP returns 429 after the fifth. A POST without a valid Turnstile token gets 403. Voice-token from curl gets 403.

**Effort.** M. **Needs human:** Turnstile widget, xAI cap.

### R11 · P1 · Mobile form usability (applies to `/estimate` and the homepage form)

**Problem.**
- Field labels are 10 px uppercase in muted text (`public/styles.css`, `.field label{…font-size:10px…}`), and helper text is 11 px. Contractors read these on a phone in sunlight.
- Phone and email are both optional with "provide at least one" (`index.html` line 295). That's a confusing rule for a business that only calls back.
- Validation is all-or-nothing in one alert box (`script.js` lines 83–92). Email, phone and ZIP format errors only show up after a server round trip, and there's no `aria-invalid` or per-field message.
- Nothing says when they'll hear back, and the success state (`index.html` line 290) shows no reference number.
- The fixed 54 px chat button (`public/chat.css`, `.chat-widget{position:fixed;right:14px;bottom:14px}` at ≤520 px) can sit over the right end of the full-width submit button and the form note.

**Recommendation.** Labels at least 13 px in sentence case. Make phone the primary required contact and email optional (owner sign-off). Show inline errors under each field with `aria-invalid="true"` and `aria-describedby`, and mirror the server's regexes on the client. Add `enterkeyhint="next"`/`"send"`. Add a "What happens next" line (owner-approved wording). Show the reference ID on success. Hide the chat button on `/estimate`, and on other pages while a form field has focus.

**Verify.** Screenshots at 360×740 and 390×844 show no overlap. VoiceOver announces each field's error. A bad email is caught before any network request (DevTools Network tab).

**Effort.** S–M.

---

## P2: performance, accessibility, code health, SEO

### R12 · P2 · Trim media weight: gate the hero video, right-size the gallery, and move originals out of git

**Problem.**
- The critical path is fine (homepage LCP 2.0 s, CLS 0). But after `load`, `script.js` lines 38–50 always fetch the **2.5 MB** `hero-portrait.mp4`. That happens even when the visitor arrived at `/#quote` and never sees the hero, and it's 70% of the 3.5 MB total transfer on cellular.
- Lighthouse estimates about 700 KiB of savings on the gallery AVIFs (1000 w at about 110–155 KB each, chosen on phones because of DPR).
- `gtag.js` is 176 KB.
- The "26 MB repo" is not user-facing: `media-src/` (18 MB of originals, including an 11.3 MB `hero-loop.mp4`) is never served. It only slows clones and the git-connected Cloudflare build.

**Recommendation.**
- Start the video only when the hero is on screen (IntersectionObserver), the page wasn't opened with a hash, and `navigator.connection?.effectiveType` is `4g` or unknown.
- In `scripts/build-media.py`, cut the portrait loop to 12–15 s at 540×960, CRF 34, aiming for 1 MB or less.
- Lower the gallery AVIF quality (for example `quality=40`, `speed=6`) and add an 800 w size.
- Load GA4 on `requestIdleCallback` or first interaction, accepting slightly undercounted bounces.
- Move `media-src/` to Git LFS or an R2 bucket and document the fetch step. Rewriting history to drop the old blobs needs a force push, so leave that as a human decision.

**Verify.** Lighthouse mobile on `/`: performance at least 95 and total transfer under 1.2 MB. Landing on `/#quote` downloads no `.mp4` (Network tab). A fresh `git clone --depth 1` is under 10 MB.

**Effort.** M.

### R13 · P2 · Accessibility fixes found by Lighthouse and code reading

**Problem.**
- Footer text contrast is 3.4:1 (`.footer-bottom` uses `rgba(242,234,214,.4)` on `#141410`), which fails WCAG AA.
- The before/after buttons have an `aria-label` ("Show completed result for project one") that doesn't include their visible text ("Before", "After", "Hover · Tap"). Lighthouse flags this as `label-content-name-mismatch`, which breaks voice-control users.
- The chat panel (`public/chat-widget.js` lines 16–42) has no `role="dialog"`/`aria-modal`. Escape doesn't close it (`script.js` line 115 handles only the menu), and focus isn't returned to the toggle on close.
- The emoji icons (💬, 🎤) are read out as "speech balloon" and "microphone".
- Chat text is 13 px, and the chat note is 9 px.

**Recommendation.** Raise the footer alpha to at least 0.7. Rename the gallery buttons to start with the visible text, for example `aria-label="Before and after, project one — tap to show after"`. Add dialog semantics, an Escape handler, and focus return to the chat panel. Replace the emoji with inline SVG plus `aria-hidden`. Set chat text to 15 px or more.

**Verify.** Lighthouse accessibility is 100 on `/` and `/estimate`. A VoiceOver and keyboard pass through the chat opens, closes and returns focus correctly.

**Effort.** S.

### R14 · P2 · Code health: shared helpers, tests, CI, and docs that match reality

**Problem.**
- `json`, `getClientIp`, `isRateLimited` and `validOrigin` are copy-pasted in all three handlers, and `quote.js`'s `validOrigin` differs (it allows a missing Origin).
- The header comments say "Cloudflare Pages Function", but this is a Worker (`src/worker.js`).
- There are no tests, no lint and no CI. `package.json` has only `dev` and `deploy`, and `main` auto-deploys.
- `README.md` line 9, `SEO-PLAN.md` line 54 and `business-data.json` (`quoteUrl`) all describe `/estimate` as retired, so they'll mislead the next agent once R01 lands.
- The voice widget uses the deprecated `ScriptProcessorNode` (`chat-widget.js` line 197).

**Recommendation.**
- Move the shared helpers into `functions/api/_lib.js`.
- Add `vitest` with `@cloudflare/vitest-pool-workers`. Cover quote validation (honeypot, timing, required fields, enums), upstream non-JSON or timeout (R05), a missing secret returning 503 (R04), the demo routing (R03), and the photo magic-byte check (R06).
- Add a GitHub Actions workflow that runs `npm test` and `npx wrangler deploy --dry-run` on PRs.
- Update the three docs when R01 ships.
- Plan an AudioWorklet migration for voice (low urgency).

**Verify.** `npm test` passes locally and in CI. A PR that breaks validation fails CI.

**Effort.** M.

### R15 · P2 · SEO and header tidy-ups that come with the new page

**Problem.**
- `public/sitemap.xml` has no `/estimate` and every `lastmod` is stale (2026-09-24).
- `Permissions-Policy: geolocation=()` (`public/_headers` line 4) would block any "use my location" button.
- `style-src 'unsafe-inline'` is needed only because of three inline `style=` attributes in `index.html` (lines 265, 281, 290).
- HSTS is sent with `includeSubDomains; preload`. That's fine only if every subdomain is HTTPS-only before anyone submits the domain to the preload list.

**Recommendation.**
- Once R01 is live, give `/estimate` a canonical URL and a title like "Free Land Clearing Quote | TX Mulching", add it to the sitemap, and add `Service` and `BreadcrumbList` JSON-LD as on the other pages. Demo and `ref` variants are covered by the canonical, so no separate pages are needed.
- Change geolocation to `(self)` only if R01 ships a location button.
- Move the inline styles into classes, then drop `'unsafe-inline'` from `style-src`.
- Add `blob:` (R06) and the Turnstile domains (R10) to the CSP.
- Human: confirm subdomain HTTPS coverage before any HSTS preload submission.

**Verify.** Search Console's URL Inspection shows `/estimate` as indexable with the right canonical. `securityheaders.com` grade holds or improves. There are no CSP violations in the console during a full intake with photos.

**Effort.** S.

---

## Suggested order of work

1. **R02** (switch to 302) and **R04** (confirm delivery, remove the fallback): small, immediate.
2. **R08** and **R10**, so the new page launches on a reliable, abuse-resistant endpoint.
3. **R01** + **R06** + **R03** + **R07** together as the demo launch, with **R11** applied to the new page.
4. **R05** and **R09** right after, so a lead is never lost and the alert is worth showing off.
5. **R12–R15** as follow-up hygiene.
