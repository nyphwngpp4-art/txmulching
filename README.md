# TX Mulching website

Static marketing site with a Vercel serverless quote endpoint.

## Deployment

The existing Google Apps Script URL is used as the default quote destination. For cleaner environment management, add these Vercel environment variables:

- `GOOGLE_SCRIPT_URL`: deployed Google Apps Script web-app endpoint
- `ALLOWED_ORIGINS`: optional comma-separated list such as `https://txmulching.com,https://www.txmulching.com`

The quote endpoint validates fields, rejects the honeypot, enforces a completion-time check, limits request size, verifies same-origin requests and applies a basic per-instance rate limit. For higher traffic, replace the in-memory limiter with a shared store or edge firewall rule.

## Main files

- `index.html`: semantic page content and SEO metadata
- `styles.css`: responsive design without Tailwind
- `script.js`: mobile navigation, gallery interaction and quote submission
- `api/quote.js`: validated server-side form proxy
- `business-data.json`: reusable verified business facts for future chat and voice systems
