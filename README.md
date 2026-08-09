# TX Mulching website

Owner-led forestry mulching and land-clearing website for TX Mulching, LLC in Canton, Texas.

## Current status

- Phase 1 website foundation complete
- Accessible responsive navigation
- Server-validated quote form
- LocalBusiness and service SEO metadata
- xAI-powered website chat added through a secure server-side endpoint
- Existing image and hero-video assets retained in `/images`

## Architecture

- `index.html`: semantic page content, SEO metadata, and quote form
- `styles.css`: responsive custom CSS without Tailwind or runtime CSS dependencies
- `chat.css`: responsive floating-chat interface
- `script.js`: navigation, before/after gallery, quote form, and chat interaction
- `functions/api/quote.js`: validated server-side quote proxy (Cloudflare Pages Function)
- `functions/api/chat.js`: server-side xAI Responses API proxy (Cloudflare Pages Function)
- `business-data.json`: verified shared business facts used by the chat assistant
- `_headers`: security and cache response headers applied by Cloudflare Pages
- `privacy.html`: privacy disclosures for quote requests and AI chat

## Hosting

The site is deployed as a **Cloudflare Worker** (`txmulching`) with a static assets binding, connected to this GitHub repository.

- `wrangler.jsonc` defines the Worker: `src/worker.js` is the entry point and the repository root is the assets directory (`.assetsignore` keeps code, config, and internal docs out of the published assets).
- `src/worker.js` routes `/api/chat`, `/api/quote`, and `/api/voice-token` to the handlers in `functions/api/` and serves everything else from the assets binding (pretty URLs give `/estimate`).
- `_headers` applies the security headers (CSP, HSTS, `Permissions-Policy` with `microphone=(self)` for the voice widget, etc.) to asset responses.
- Deploy with `npx wrangler deploy` (or let the git-connected build deploy on push to `main`).

## Environment variables (Worker secrets)

Set these on the Worker (Settings → Variables and Secrets, or `npx wrangler secret put NAME`). `XAI_API_KEY` must be a Secret.

Required for chat:

- `XAI_API_KEY`: xAI API key. Keep this server-side; never place it in `index.html` or `script.js`.

Recommended:

- `XAI_MODEL`: defaults to `grok-4.5`
- `GOOGLE_SCRIPT_URL`: deployed Google Apps Script quote endpoint. A default is currently baked into `functions/api/quote.js`; setting this variable overrides it and is the preferred approach.
- `ALLOWED_ORIGINS`: comma-separated production origins, such as `https://txmulching.com,https://www.txmulching.com`

The chat interface is included in the site but will return a clear “not activated” message until `XAI_API_KEY` is configured.

Both API routes validate origin and request size and apply basic in-memory rate limiting. In-memory limits reset per Worker isolate, so for sustained traffic move rate limiting to Cloudflare KV, a Durable Object, or a WAF rate-limiting rule.

The chat endpoint sends only the recent conversation and verified business context to xAI. It uses the Responses API with `store: false`, which instructs xAI not to store the request and response for conversation continuation. It also limits message length, excludes sensitive-data requests, and does not expose the API key in the browser.

## Local development

Run the project with Wrangler so `/api/quote` and `/api/chat` are available:

```
npm install
npx wrangler dev
```

Opening `index.html` directly will display the site but cannot run the API routes.

## Phone integration

The website does not claim the business phone is currently answered by an AI agent. A Twilio/xAI voice pilot can be added separately after its call, SMS, fallback, and owner-handoff workflow has been tested.
