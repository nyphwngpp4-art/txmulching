# SEO plan: txmulching.com

Conversion = a lead: `estimate_complete`, `quote_submit` or `phone_click`. Rankings and impressions only count if they move one of those.

## What's shipped (this branch)

- **Conversion tracking** (`analytics.js`): GA4 with named events. It stays inactive until `GA4_ID` is set.
  - `estimate_complete`: name and phone submitted on the instant estimate. Params: `acres`, `density`, `zone`, `outcome` (range / site_walk / referred).
  - `quote_submit`: callback form accepted by `/api/quote`.
  - `phone_click`: any `tel:` link. Param: `link_location` (id of the nearest section).
  - `estimate_start`: estimate step 1 completed (funnel only, not a key event).
- **Money page** `/forestry-mulching`: targets "forestry mulching", "forestry mulching near me" and "forestry mulching texas", the top GBP searches. Every heading is phrased the way people ask the question and answered in its first line; the page covers what drives cost (no dollar figures, which stay in the instant estimate), acres per day, mulching vs. bulldozing and what's left behind. Excavation is described as arranged through partner contractors. The estimate call-to-action appears near the top, mid-page and at the end.
- **Supporting page** `/service-area`: answers "do you come to my town?" with towns grouped by the estimate's distance zones. Nacogdoches, Lufkin and Vidor each have their own section. There are no one-page-per-city doorway pages.
- **Homepage**: nav, service card, service-area card and footer now link to both pages. The hero copy names forestry mulching. City entries added to `areaServed`.
- Sitemap, CSP (GA4 domains) and privacy policy (analytics disclosure) updated.

Schema is limited to Service + BreadcrumbList. There's no FAQPage markup: Google restricts that rich result to government and health sites, and schema is not a lever for getting cited in AI answers.

## Owner to-do (in order)

1. **GA4**: create a property and web data stream for txmulching.com, paste the `G-…` ID into `GA4_ID` in `analytics.js`, and deploy. In Admin → Events, mark `estimate_complete`, `quote_submit` and `phone_click` as key events (they appear after the first hit).
2. **Search Console**: add a Domain property. Verify with a DNS TXT record in Cloudflare, submit `https://txmulching.com/sitemap.xml`, then request indexing for `/forestry-mulching` and `/service-area`. Link Search Console to GA4.
3. **Google Business Profile**:
   - Keep **Excavating contractor** as a *secondary* category. Excavation is available through partner contractors, and that category drives the "excavating contractor in canton, tx" searches (19). Make the closest land-clearing or forestry-mulching category GBP offers the *primary*. When those callers phone, say up front that dirt work is done through a partner, to match the website.
   - Set the website link to `https://txmulching.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp` so GBP leads show separately in GA4.
   - Add "Forestry mulching" as a service with a description matching the new page, and post before/after photos regularly.
   - Ask every finished customer for a review that names the service and town ("forestry mulching near Tyler"). Reviews and third-party mentions carry weight in both the map pack and AI answers.
4. **Verify the service-area town lists** in `service-area.html`. They're grouped by approximate distance from Canton. Move or remove any town you don't want calls from.
5. **Keep business details consistent** (name, phone, city) on GBP, Bing Places, Facebook and any directories.

## Measurement loop (monthly, not weekly)

At current volume (GBP searches in the dozens per month), weekly checks would only be measuring noise. Once a month:

1. Pull Search Console queries and pages alongside GA4 key events by landing page.
2. Compare against the previous month and note the date of the last change.
3. Make **one** change, log it below with the date, and leave it for at least 4–6 weeks before judging.
4. A ranking gain with no extra leads is a miss; more leads with flat rankings is a win.

Revisit the automated agent setup (brief, state and log files, scheduled run) once Search Console has about 3 months of data and at least 2–3 pages have impressions worth comparing.

## Candidate next pages (only when data supports them)

- `/land-clearing`: if Search Console shows land-clearing queries landing on the homepage.
- `/excavation` (clearing + partner dirt work): if the excavating-contractor searches turn into real calls. Be clear on the page that a partner does the dirt work.
- A cost deep-dive: only if `/forestry-mulching` ranks for cost queries but the cost section can't hold all the detail. Otherwise it would compete with the money page.
- Skip "brush mulcher": it's equipment-shopper intent, not people hiring a crew.

## Change log

| Date | Change | Pages | Result (fill in after 4–6 weeks) |
|---|---|---|---|
| 2026-09-24 | GA4 events, /forestry-mulching, /service-area, homepage internal links | all | baseline |
| 2026-09-24 | Removed published per-acre pricing; excavation described as partner-delivered | /forestry-mulching, /service-area | baseline |
