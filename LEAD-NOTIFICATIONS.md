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

Replace the whole script file with the version below, then **Deploy →
Manage deployments → pencil → Version: New version → Deploy**.
Editing the code alone changes nothing in production.

Fill in the CONFIG block at the top. Carrier gateways:

| Carrier  | Gateway suffix   |
|----------|------------------|
| AT&T     | `@txt.att.net`   |
| Verizon  | `@vtext.com`     |
| T-Mobile | `@tmomail.net`   |

```js
/* ================= CONFIG — edit these ================= */
var SHEET_ID = '1LoWcYng7Je_KaVSGKdFVTAKmNGSQ06sGuFVk_8pHqoI';

// Everyone who should get the full lead by email.
var NOTIFY_EMAILS = [
  'info@txmulching.com',      // business address
  'PARENTS_EMAIL_HERE',       // <-- the inbox the owners actually read
  'j.messamore@gmail.com'     // backstop
];

// Phones that should get the short text. Number + carrier gateway.
var NOTIFY_SMS = [
  '4695951984@txt.att.net'    // Dad, AT&T
  // ,'MOM_NUMBER@txt.att.net'
];
/* ======================================================= */

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
    data.description || ''
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
    '',
    'Call back: ' + phone,
    'All leads: https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit'
  ].join('\n');

  // One email per recipient so a single bad address cannot block the rest.
  NOTIFY_EMAILS.forEach(function (to) {
    if (!to || to.indexOf('_HERE') > -1) return;
    try {
      MailApp.sendEmail({
        to: to,
        subject: 'New TX Mulching lead: ' + name + ' (' + phone + ')',
        body: body
      });
    } catch (err) {
      console.error('email failed for ' + to, err);
    }
  });

  var sms = 'TXM lead: ' + name + ' ' + phone + ' — ' +
            (data.acreage || '?') + ', ' + (data.serviceType || 'service TBD');

  NOTIFY_SMS.forEach(function (to) {
    if (!to || to.indexOf('_NUMBER') > -1) return;
    try {
      MailApp.sendEmail({ to: to, subject: '', body: sms });
    } catch (err) {
      console.error('sms failed for ' + to, err);
    }
  });
}

// Run once from the editor to authorize and confirm delivery, then delete
// any test rows from the Sheet.
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
failure mode that would silently recreate the current problem.

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

## Open items

- Owners' preferred inbox address (needed for both parts).
- Mom's cell + carrier, if she should get texts too.
- Confirm whether Dad's AT&T text is arriving.
- Carrier email-to-SMS gateways are free but best-effort and increasingly
  deprecated. If texts prove unreliable, the durable fix is a Twilio SMS
  send from the Worker (~$0.008/message).
