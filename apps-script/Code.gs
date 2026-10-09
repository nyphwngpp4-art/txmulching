// TX Mulching lead sink. A person deploys this from the Google account that
// owns the Sheet (agavi.aiconsulting@gmail.com). Editing this file does not
// change production until that deploy happens. See apps-script/README.md.

var SHEET_ID = '1LoWcYng7Je_KaVSGKdFVTAKmNGSQ06sGuFVk_8pHqoI';
var LEADS_SHEET = 'Sheet1';
var DEMO_SHEET = 'Demo Leads';

// Everyone who gets a real lead. Demo posts never email this list.
var NOTIFY_EMAILS = [
  'messamoreh@gmail.com',     // Hal
  'messamore.gk@gmail.com',   // Kim
  'info@txmulching.com',      // business address
  'j.messamore@gmail.com'     // backstop — remove if not wanted
];
var QUOTA_WATCH_EMAIL = 'j.messamore@gmail.com';

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    data = (e && e.parameter) || {};
  }

  if (!tokenOk_(data)) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  var demo = data.demo === true || data.demo === 'true' || data.demo === '1';
  var sheet = openSheet_(demo ? DEMO_SHEET : LEADS_SHEET);
  sheet.appendRow([
    new Date(),
    cell_(data.name),
    cell_(data.phone),
    cell_(data.email),
    cell_(data.zipcode),
    cell_(data.acreage),
    cell_(data.serviceType),
    cell_(data.description),
    cell_(data.requestId),
    cell_(data.address),
    cell_(data.city),
    cell_(data.county),
    cell_(data.density),
    cell_(data.timeline),
    cell_(data.callbackWindow),
    cell_(data.budget),
    cell_(photoLinks_(data)),
    cell_(data.ref),
    cell_(data.source)
  ]);

  if (!demo) {
    try {
      notifyLead_(data);
    } catch (err) {
      console.error('notify failed', err);
      return json_({ ok: false, error: 'notify failed' });
    }
  }

  return json_({ ok: true });
}

function tokenOk_(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected || !data.token) return false;
  return String(data.token) === String(expected);
}

// Leading = + - @ tab or CR would become a formula. An apostrophe keeps the
// literal. Values the Worker already escaped are left alone.
function cell_(value) {
  var text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) return "'" + text;
  return text;
}

function photoLinks_(data) {
  var links = data.photoLinks || data.photoUrls || [];
  if (Array.isArray(links)) return links.join('\n');
  return String(links || '');
}

function openSheet_(name) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headerRow_());
  }
  return sheet;
}

function headerRow_() {
  return [
    'Timestamp', 'Name', 'Phone', 'Email', 'ZIP', 'Acreage', 'Service', 'Details',
    'Request ID', 'Address', 'City', 'County', 'Density', 'Timeline',
    'Callback window', 'Budget', 'Photo links', 'Ref', 'Source'
  ];
}

function notifyLead_(data) {
  var remaining = MailApp.getRemainingDailyQuota();
  maybeWarnQuota_(remaining);

  var subject = subjectFor_(data);
  var body = bodyFor_(data);
  var replyTo = data.email || 'info@txmulching.com';

  if (remaining < 1) {
    throw new Error('MailApp daily quota is exhausted');
  }

  // One message so a burst cannot multiply the recipient count. If that send
  // throws, fall back to one recipient at a time so a single bad address
  // cannot hide the lead from everyone else.
  var recipients = remaining >= NOTIFY_EMAILS.length ? NOTIFY_EMAILS : [QUOTA_WATCH_EMAIL];
  try {
    MailApp.sendEmail({
      to: recipients[0],
      bcc: recipients.slice(1).join(','),
      name: 'TX Mulching Leads',
      replyTo: replyTo,
      subject: subject,
      body: body
    });
    return;
  } catch (err) {
    console.error('group email failed', err);
  }

  recipients.forEach(function (to) {
    try {
      MailApp.sendEmail({
        to: to,
        name: 'TX Mulching Leads',
        replyTo: replyTo,
        subject: subject,
        body: body
      });
    } catch (inner) {
      console.error('email failed for ' + to, inner);
    }
  });
}

function maybeWarnQuota_(remaining) {
  if (remaining >= 8) return;
  var props = PropertiesService.getScriptProperties();
  var today = new Date().toDateString();
  if (props.getProperty('QUOTA_WARNED_ON') === today) return;
  props.setProperty('QUOTA_WARNED_ON', today);
  try {
    MailApp.sendEmail({
      to: QUOTA_WATCH_EMAIL,
      name: 'TX Mulching Leads',
      subject: 'TX Mulching lead mail quota is low (' + remaining + ' left)',
      body: 'MailApp has about ' + remaining + ' recipient sends left today. Real lead alerts may start failing until the quota resets.'
    });
  } catch (err) {
    console.error('quota warning failed', err);
  }
}

function subjectFor_(data) {
  var acres = data.acreage || 'acreage not given';
  var service = data.serviceType || 'land clearing';
  var where = data.city || data.zipcode || 'location not given';
  var who = shortName_(data.name);
  var phone = data.phone || 'no phone';
  var subject = 'New lead: ' + acres + ' ' + service + ' near ' + where + ' — ' + who + ' ' + phone;
  return subject.slice(0, 180);
}

function shortName_(name) {
  var parts = String(name || 'Unknown').trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

function bodyFor_(data) {
  var mapQuery = [data.address, data.city, data.county, data.zipcode, 'TX'].filter(Boolean).join(', ');
  var mapLink = mapQuery
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery)
    : '—';
  var photos = photoLinks_(data) || '—';
  return [
    'Name: ' + (data.name || '—'),
    'Phone: ' + (data.phone || '—'),
    'Email: ' + (data.email || '—'),
    'Service: ' + (data.serviceType || '—'),
    'Acreage: ' + (data.acreage || '—'),
    'Brush: ' + (data.density || '—'),
    'Timeline: ' + (data.timeline || '—'),
    'Callback window: ' + (data.callbackWindow || '—'),
    'Budget note: ' + (data.budget || '—'),
    'Address: ' + (data.address || '—'),
    'City: ' + (data.city || '—'),
    'County: ' + (data.county || '—'),
    'ZIP: ' + (data.zipcode || '—'),
    'Map: ' + mapLink,
    'Photos:',
    photos,
    'Details: ' + (data.description || '—'),
    'Ref: ' + (data.ref || '—'),
    'Reference: ' + (data.requestId || '—'),
    '',
    'Call back: ' + (data.phone || '—'),
    'All leads: https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit'
  ].join('\n');
}

function json_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor after setting the TOKEN script property.
// Sends a clearly labelled test to the notify list. Delete the Sheet row after.
function testNotification() {
  notifyLead_({
    name: 'TEST — delete me',
    phone: '(555) 010-0000',
    acreage: '5 acres',
    serviceType: 'Forestry Mulching',
    city: 'Tyler',
    description: 'Test of lead notifications. Delete this row.'
  });
}
