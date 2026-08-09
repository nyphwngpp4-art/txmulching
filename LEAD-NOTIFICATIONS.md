# Lead notifications — Apps Script setup

Leads from the website (quote form, instant estimate, chat handoffs) POST to
`/api/quote`, which forwards them to a Google Apps Script that appends a row to
the **"TX Mulching Quote Leads"** Sheet (owned by `agavi.aiconsulting@gmail.com`).

As of Aug 2026 the script only appends the row — nobody is notified. That is
how the May 27 lead (Jared Cole) went unseen for 10 weeks. This adds an email
to info@txmulching.com plus a text to the owner's cell on every lead.

## Steps

1. Log in as `agavi.aiconsulting@gmail.com` and open the Sheet
   "TX Mulching Quote Leads" → Extensions → Apps Script.
2. In the script editor, find the `doPost` function. After the line that
   appends the row (`appendRow(...)` or similar), add:

   ```js
   try { notifyLead_(data); } catch (err) { console.error('notify failed', err); }
   ```

   (`data` = the parsed JSON object; match the variable name used in doPost.)

3. Paste this function at the bottom of the script file:

   ```js
   // Carrier gateway for (469) 595-1984 — pick ONE line for Dad's carrier:
   //   Verizon:  '4695951984@vtext.com'
   //   AT&T:     '4695951984@txt.att.net'
   //   T-Mobile: '4695951984@tmomail.net'
   var SMS_GATEWAY = '4695951984@vtext.com';

   function notifyLead_(data) {
     var name = data.name || 'Unknown';
     var phone = data.phone || 'no phone';
     var lines = [
       'Name: ' + name,
       'Phone: ' + phone,
       'Email: ' + (data.email || '—'),
       'ZIP: ' + (data.zipcode || '—'),
       'Acreage: ' + (data.acreage || '—'),
       'Service: ' + (data.serviceType || '—'),
       'Details: ' + (data.description || '—'),
       '',
       'Sheet: https://docs.google.com/spreadsheets/d/1LoWcYng7Je_KaVSGKdFVTAKmNGSQ06sGuFVk_8pHqoI/edit'
     ];
     MailApp.sendEmail({
       to: 'info@txmulching.com',
       subject: 'New TX Mulching lead: ' + name + ' (' + phone + ')',
       body: lines.join('\n')
     });
     // Email-to-SMS: keep it short, no subject.
     MailApp.sendEmail({
       to: SMS_GATEWAY,
       subject: '',
       body: 'TXM lead: ' + name + ' ' + phone + ' — ' +
             (data.acreage || '?') + ', ' + (data.serviceType || 'service TBD')
     });
   }
   ```

4. Save, then **Deploy → Manage deployments → Edit (pencil) → Version: New
   version → Deploy**. (Apps Script web apps serve the deployed version, not
   the saved code — skipping this step means no change in production.)
5. Test: submit the website form with a test name; confirm the email arrives
   at info@txmulching.com and the text hits the cell. Delete the test row.

Notes:
- Confirm `info@txmulching.com` is actually monitored before relying on it.
- Email-to-SMS gateways are carrier-dependent and best-effort; the email is
  the reliable channel, the text is the fast one.
- MailApp free quota is ~100 recipients/day — far above lead volume.
