# Lead notifications & business email

Website leads (the callback form) POST to `/api/quote`, which
forwards to a Google Apps Script that appends a row to the **"TX Mulching
Quote Leads"** Sheet and then sends alerts.

## Two separate problems — don't conflate them

1. **Alert routing** (urgent): alerts currently reach Jay only. The owners
   need them on their phones. This is fixed entirely in the Apps Script and
   does **not** depend on any email migration.
2. **Where `info@txmulching.com` lives** (housekeeping): currently an
   iCloud+ Custom Email Domain mailbox. Optionally move to Cloudflare Email
   Routing so mail forwards to whatever inbox the owners actually read.

## Part 1 — Apps Script (fixes the alerts)

Email only — no SMS gateways (owner decision, Aug 2026). Every lead goes to
Kim, Hal, the business address, and Jay as a backstop.

The script that should be deployed is [`apps-script/Code.gs`](apps-script/Code.gs).
Follow [`apps-script/README.md`](apps-script/README.md): paste it into the Apps
Script project, set the `TOKEN` script property, deploy a new version, and set
the Worker secret `APPS_SCRIPT_TOKEN` to the same value. Editing the file in
git does nothing in production until that deploy.

The current script sends one email per lead, with the other owners in BCC, so a burst uses one MailApp call instead of four. If that group send throws, it falls back to one recipient at a time so a single bad address cannot hide the lead. It also refuses posts that do not carry `TOKEN`, prefixes a leading apostrophe on values that would become Sheet formulas, and writes the extra intake columns (address, density, timeline, callback window, photo links, ref).

Sender identity: MailApp always sends from the Google account that owns the
script (agavi.aiconsulting@gmail.com); only the display name is changeable.
Showing `info@txmulching.com` as the address would require adding it as a
"Send mail as" alias in that Gmail account and switching to `GmailApp` —
not worth it for family-only alerts.

First-delivery gotcha: Gmail may route the first alert from
`agavi.aiconsulting@gmail.com` to Spam or Promotions. Kim and Hal should
check there once and mark it "Not spam" so future leads land in Primary.

## Part 2 — Business email: iCloud+ vs Cloudflare Email Routing

`txmulching.com` DNS is already on Cloudflare (the Worker serves the apex
domain), so Email Routing is available at no cost.

**The decisive difference: Cloudflare Email Routing is receive-and-forward
only. It cannot send.** Nothing can reply *as* `info@txmulching.com`
through Cloudflare alone.

| | iCloud+ Custom Domain (current) | Cloudflare Email Routing |
|---|---|---|
| Receive at info@ | Yes | Yes (forwards anywhere) |
| **Reply as info@** | **Yes** | **No** (needs an SMTP sender) |
| Cost | Part of iCloud+ | Free |
| Ties to | An Apple ID / device | Nothing — any inbox |
| Aliases | Limited | Unlimited (sales@, quotes@…) |

**Recommendation:** move to Cloudflare Email Routing *if* the owners only
need to **receive** leads and respond by phone — which matches how this
business actually runs (every lead gets a callback, not an email reply).
It removes the Apple-account dependency, forwards to whatever inbox they
already check, and costs nothing.

**Keep iCloud+ if** they want to send email *from* `info@txmulching.com`
for quotes, invoices, or vendors. Losing send-as is the one real downside
and it is not easily recovered later without a paid mail host.

### Migration steps (only if moving to Cloudflare)

1. Cloudflare dashboard → `txmulching.com` → **Email** → **Email Routing** →
   Get started.
2. Add the destination address (owners' preferred inbox) and have them click
   the verification email Cloudflare sends. **Verification is required.**
3. Create a custom address: `info@txmulching.com` → forward to that inbox.
   Add `quotes@` or `sales@` too if wanted — aliases are free.
4. Let Cloudflare add its MX + SPF records automatically. **This replaces
   the iCloud MX records** — the two cannot coexist; whichever MX set is
   live wins.
5. Send a test to `info@txmulching.com` and confirm it lands.
6. Only after that works, remove the domain from iCloud+ settings. Mail
   already sitting in the iCloud mailbox stays there — save anything needed
   before disconnecting.

Order matters: verify the new path *before* tearing down the old one, or
mail sent in between bounces.

## Part 3 — Rotate the Script URL (one-time)

The Apps Script `/exec` URL was committed to this repository while it was
public, so anyone who saw it can post junk straight to the Sheet, bypassing
the Worker's rate limit and honeypot. Rotation = new deployment URL, moved
into a Worker secret, old deployment archived.

1. Paste the Part 1 script (it now writes column I "Request ID" — add that
   header to cell I1 of the Sheet).
2. **Deploy → New deployment** (not "Manage deployments" this time — a new
   URL is the point). Type: Web app · Execute as: Me · Who has access:
   Anyone. Copy the new `/exec` URL.
3. Cloudflare → Workers & Pages → `txmulching` → Settings → Variables and
   Secrets → **Add** → type Secret, name `GOOGLE_SCRIPT_URL`, value = the
   new URL. The Worker reads only this secret. There is no URL left in the source.
4. Submit the site's callback form once and confirm the row lands with a
   Request ID in column I and the alert emails arrive.
5. Back in Apps Script: **Deploy → Manage deployments → archive the old
   deployment.** The leaked URL now returns an error.
6. The fallback URL has already been removed from the Worker. After the
   secret is confirmed, archive the old deployment if that was not done in
   step 5.

## Open items

- `GOOGLE_SCRIPT_URL`, `APPS_SCRIPT_TOKEN`, and `PHOTO_LINK_SECRET` are Worker
  secrets. Keep them secrets. A plain var is wiped on deploy if
  `wrangler.jsonc` does not list it (that happened to `GOOGLE_SCRIPT_URL` on
  28 Sep 2026).
- D1 database `txm-leads` exists and migration `0001` is applied. Photos go
  to Google Drive through `apps-script/Code.gs`, not R2. Redeploy that script
  and run `authorizePhotos` once. Full list: `docs/BEFORE-MERGE.md`.
- Decide on the iCloud+ → Cloudflare Email Routing move (Part 2). Not
  required for alerts to work — the script emails Kim and Hal directly.
  Do not turn on Email Routing `send_email` as the backup channel unless
  that migration is accepted; it would replace the iCloud MX records.
  `RESEND_API_KEY` + `BACKUP_ALERT_EMAIL`, or `BACKUP_ALERT_URL`, is the
  backup path that does not touch DNS.
