# Lead notifications & business email

Website leads (quote form + instant estimate) POST to `/api/quote`, which
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

Replace the whole script file with the version below, run
`testNotification` once from the editor to confirm delivery, then
**Deploy → Manage deployments → pencil → Version: New version → Deploy**.
Editing the code alone changes nothing in production.

```js
var SHEET_ID = '1LoWcYng7Je_KaVSGKdFVTAKmNGSQ06sGuFVk_8pHqoI';

// Everyone who gets the full lead by email.
var NOTIFY_EMAILS = [
  'messamoreh@gmail.com',     // Hal
  'messamore.gk@gmail.com',   // Kim
  'info@txmulching.com',      // business address
  'j.messamore@gmail.com'     // backstop — remove if not wanted
];

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    data = (e && e.parameter) || {};
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Sheet1') || ss.getSheets()[0];

  sheet.appendRow([
    new Date(),
    data.name || '',
    data.phone || '',
    data.email || '',
    data.zipcode || '',
    data.acreage || '',
    data.serviceType || '',
    data.description || '',
    data.requestId || ''      // column I "Request ID" — matches the Worker log
  ]);

  try {
    notifyLead_(data);
  } catch (err) {
    console.error('notify failed', err);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function notifyLead_(data) {
  var name = data.name || 'Unknown';
  var phone = data.phone || 'no phone';

  var body = [
    'Name: ' + name,
    'Phone: ' + phone,
    'Email: ' + (data.email || '—'),
    'ZIP: ' + (data.zipcode || '—'),
    'Acreage: ' + (data.acreage || '—'),
    'Service: ' + (data.serviceType || '—'),
    'Details: ' + (data.description || '—'),
    'Reference: ' + (data.requestId || '—'),
    '',
    'Call back: ' + phone,
    'All leads: https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit'
  ].join('\n');

  // One email per recipient so a single bad address cannot block the rest.
  NOTIFY_EMAILS.forEach(function (to) {
    try {
      MailApp.sendEmail({
        to: to,
        name: 'TX Mulching Leads',                    // display name in the inbox
        replyTo: data.email || 'info@txmulching.com', // Reply goes to the customer
        subject: 'New TX Mulching lead: ' + name + ' (' + phone + ')',
        body: body
      });
    } catch (err) {
      console.error('email failed for ' + to, err);
    }
  });
}

// Run once from the editor to confirm delivery to every inbox.
// Sends a clearly-labelled test to all recipients.
function testNotification() {
  notifyLead_({
    name: 'TEST — delete me',
    phone: '(555) 010-0000',
    acreage: '5 acres',
    serviceType: 'Forestry Mulching',
    description: 'Test of lead notifications.'
  });
}
```

Why the per-recipient loop matters: `MailApp.sendEmail` with a comma list
fails as a unit. If one address bounces, nobody gets alerted — the exact
failure mode that would silently recreate the original problem.

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
   new URL. Takes effect immediately; the Worker prefers the secret over
   the fallback baked into `quote.js`.
4. Submit the site's callback form once and confirm the row lands with a
   Request ID in column I and the alert emails arrive.
5. Back in Apps Script: **Deploy → Manage deployments → archive the old
   deployment.** The leaked URL now returns an error.
6. Tell Jay's session it's done; the fallback URL is then removed from
   `quote.js` so the secret is the only source of truth.

## Open items

- Part 3 rotation (steps above), then remove the fallback from `quote.js`.
- Decide on the iCloud+ → Cloudflare Email Routing move (Part 2). Not
  required for alerts to work — the script emails Kim and Hal directly.
