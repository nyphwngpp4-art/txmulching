# TX Mulching site update — Instant Estimate + Big-Iron positioning
_Aug 2026_

## New files
- **estimate.html** — 3-step instant estimate page (acreage → density → contact gate → price range).
  Serves at `/estimate` (Cloudflare Pages pretty URLs). Heavy density pre-selected.
  Small light-brush jobs (light + under 3 ac) get an honest "compact machine may cost you
  less" referral message instead of a quote — lead is still captured.
- **estimate.js** — widget logic, external file (site CSP `script-src 'self'` blocks inline
  scripts). Retail RANGES only; no cost or margin data anywhere. CONFIG block at top:
  rates per density, `minJob` (2500), `smallLightAcres` (3), travel bands.
  Submits leads to the existing **/api/quote** Pages Function (honeypot + formStartedAt
  timing gate satisfied), so estimates land in the same Google Sheet/email flow as the
  main form, tagged "INSTANT ESTIMATE TOOL". If the POST fails the visitor still sees
  their range, and the "Text This to Us" button delivers the lead via prefilled SMS.

## Changed files
- **index.html**
  - Nav: added "Why Big Iron" (#why-big-iron) and "Instant Estimate" (/estimate).
  - Hero: copy repositioned to heavy clearing ("finished in days, not weeks");
    primary CTA now "Get an Instant Estimate" → /estimate.
  - Hero card list: leads with "250+ days of TPWD contract work statewide" and
    the high-HP machine.
  - NEW section `#why-big-iron` ("Bigger machine. Smaller bill.") — side-by-side
    compact/skid-steer vs high-HP comparison with the production-math argument,
    honest note that small light lots may be better served by a compact machine,
    CTA to /estimate.
  - About stats: added "250+ Days of TPWD work" (grid now 2×2 mobile / 4-up desktop).
  - Footer: Instant Estimate link. Meta description updated.
- **styles.css** — appended `.vs-*` styles + stats-grid override (bottom of file, own comment block).
- **sitemap.xml** — added /estimate.
- **business-data.json** — heavy-timber positioning, tpwdContractDays, instantEstimateUrl.

## Deploy
Commit to `main` — Cloudflare Pages auto-builds. No new env vars, no function changes.

## Verify after deploy
1. `/estimate` loads, density buttons render (JS executing = CSP happy).
2. Run a test estimate with a real phone → confirm it arrives via the Google Script flow.
3. `#why-big-iron` section renders styled on desktop + mobile.

## Before promoting
- Confirm the widget's price ranges (estimate.js CONFIG) match what Dad actually charges.
- Confirm "250+ days TPWD" is the number he'd stand behind in a bid.
