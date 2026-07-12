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
- `api/quote.js`: validated server-side quote proxy
- `api/chat.js`: server-side xAI Responses API proxy
- `business-data.json`: verified shared business facts used by the chat assistant
- `privacy.html`: privacy disclosures for quote requests and AI chat

## Vercel environment variables

Required for chat:

- `XAI_API_KEY`: xAI API key. Keep this server-side; never place it in `index.html` or `script.js`.

Recommended:

- `XAI_MODEL`: defaults to `grok-4.5`
- `GOOGLE_SCRIPT_URL`: deployed Google Apps Script quote endpoint
- `ALLOWED_ORIGINS`: comma-separated production origins, such as `https://txmulching.com,https://www.txmulching.com`

Both API routes validate origin and request size and apply basic in-memory rate limiting. For sustained traffic, move rate limiting to Vercel Firewall, Cloudflare, or a shared data store.

The chat endpoint sends only the recent conversation and verified business context to xAI. It uses the Responses API with `store: false`, limits message length, excludes sensitive-data requests, and does not expose the API key in the browser.

## Local development

Run the project through Vercel's local development environment so `/api/quote` and `/api/chat` are available. Opening `index.html` directly will display the site but cannot run the serverless endpoints.

## Phone integration

The website does not claim the business phone is currently answered by an AI agent. A Twilio/xAI voice pilot can be added separately after its call, SMS, fallback, and owner-handoff workflow has been tested.
