# TX Mulching website

Owner-led forestry mulching and land-clearing website for TX Mulching, LLC in Canton, Texas.

## Current status

- Homepage plus `/forestry-mulching` and `/service-area` pages
- Server-validated callback form: the only lead path, emailed to the owners (see `LEAD-NOTIFICATIONS.md`)
- No published pricing: the instant estimator was retired and `/estimate` redirects to the quote form
- LocalBusiness, WebSite and Service structured data
- xAI-powered website chat through a secure server-side endpoint
- Background hero video (38-second loop) with a pause control

## Architecture

- `public/`: everything the site serves, and nothing else
  - `index.html`, `forestry-mulching.html`, `service-area.html`, `privacy.html`, `404.html`
  - `styles.css`, `chat.css`: responsive custom CSS without Tailwind or runtime CSS dependencies
  - `script.js`: navigation, hero video, before/after gallery, and quote form
  - `chat-widget.js`: floating text/voice chat
  - `analytics.js`: GA4 loader (property `G-YJD63RVV4V`) and conversion events
  - `fonts/`, `images/`, `video/`: self-hosted fonts and generated media (see Media)
  - `_headers`: security and cache response headers; `_redirects`: `/estimate` → `/#quote`
- `src/worker.js`: Worker entry (see Hosting)
- `functions/api/quote.js`: validated server-side quote proxy to the Google Apps Script
- `functions/api/chat.js`: server-side xAI Responses API proxy
- `functions/api/voice-token.js`: mints short-lived xAI realtime tokens for voice chat
- `business-data.json`: verified shared business facts used by the chat assistant
- `media-src/`, `scripts/build-media.py`: original footage and photos, and the script that builds the web versions

## Hosting

The site is deployed as a **Cloudflare Worker** (`txmulching`) with a static assets binding, connected to this GitHub repository.

- `wrangler.jsonc` defines the Worker: `src/worker.js` is the entry point and `public/` is the assets directory, so code, config, docs and local secrets are never published.
- `src/worker.js` routes `/api/chat`, `/api/quote`, and `/api/voice-token` to the handlers in `functions/api/`, serves `/video/*` with byte-range (206) responses, and serves everything else from the assets binding. Static assets ignore `Range` headers, and Safari/iOS will not play video without them.
- Pretty URLs are on (`/privacy.html` → `/privacy`), and unknown URLs get `public/404.html`.
- `_headers` applies the security headers (CSP, HSTS, `Permissions-Policy` with `microphone=(self)` for the voice widget, etc.) and long cache lifetimes for fonts, images and video.
- Deploy with `npx wrangler deploy` (or let the git-connected build deploy on push to `main`).

## Environment variables (Worker secrets)

Set these on the Worker (Settings → Variables and Secrets, or `npx wrangler secret put NAME`). `XAI_API_KEY` must be a Secret.

Required for chat:

- `XAI_API_KEY`: xAI API key. Keep this server-side; never place it in anything under `public/`.

Recommended:

- `XAI_MODEL`: defaults to `grok-4.5`
- `GOOGLE_SCRIPT_URL`: deployed Google Apps Script quote endpoint. A default is currently baked into `functions/api/quote.js`; setting this variable overrides it and is the preferred approach.
- `ALLOWED_ORIGINS`: comma-separated production origins, such as `https://txmulching.com,https://www.txmulching.com`

The chat interface is included in the site but will return a clear “not activated” message until `XAI_API_KEY` is configured.

The API routes validate origin and request size and apply basic in-memory rate limiting; the chat and voice-token routes also refuse requests with no `Origin` header. In-memory limits reset per Worker isolate, so for sustained traffic move rate limiting to Cloudflare KV, a Durable Object, or a WAF rate-limiting rule.

The chat endpoint sends only the recent conversation and verified business context to xAI. It uses the Responses API with `store: false`, which instructs xAI not to store the request and response for conversation continuation. It also limits message length, excludes sensitive-data requests, never quotes prices, and does not expose the API key in the browser.

## Local development

Run the project with Wrangler so `/api/quote` and `/api/chat` are available:

```
npm install
npx wrangler dev
```

Put local secrets (for example `XAI_API_KEY=...`) in `.dev.vars`. It is git-ignored and lives outside `public/`, so it can never be committed or published.

## Media

Everything in `public/video/`, the hero posters, `og-image.jpg` and `public/images/gallery/` is generated from the originals in `media-src/`. To replace footage or photos, swap the file in `media-src/` and run (needs ffmpeg and Pillow 11.3+):

```
pip install pillow
python3 scripts/build-media.py
```

The script bakes the hero's grayscale look into the video, cuts a portrait version for phones and a 16:9 version for wider screens, uses each video's first frame as its poster, and exports the gallery's 4:3 crops at 640 and 1000 px in AVIF and JPEG. Returning visitors can see the previous version for up to 30 days (the image/video cache lifetime in `_headers`), so rename the outputs if a change must show immediately.

## Phone integration

The website does not claim the business phone is currently answered by an AI agent. A Twilio/xAI voice pilot can be added separately after its call, fallback, and owner-handoff workflow has been tested.
