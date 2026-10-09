// TX Mulching lead sink. A person deploys this from the Google account that
// owns the Sheet (agavi.aiconsulting@gmail.com). Editing this file does not
// change production until that deploy happens. See apps-script/README.md.

var SHEET_ID = '1LoWcYng7Je_KaVSGKdFVTAKmNGSQ06sGuFVk_8pHqoI';
var LEADS_SHEET = 'Sheet1';
var DEMO_SHEET = 'Demo Leads';
var PHOTO_FOLDER_NAME = 'TX Mulching Lead Photos';
var PHOTO_MAX_BYTES = 320 * 1024;

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
  // Save Drive files before the row and the email, then drop the bytes so
  // they are not written into the Sheet.
  try {
    data.photoLinks = saveLeadPhotos_(data);
  } catch (err) {
    console.error('photo save failed', err);
    data.photoLinks = photoLinks_(data);
  }
  delete data.photos;

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
  if (Array.isArray(links)) return links.filter(Boolean).join('\n');
  return String(links || '');
}

function saveLeadPhotos_(data) {
  var photos = data.photos;
  var links = [];
  var already = photoLinks_(data);
  if (already) links.push(already);
  if (!photos || !photos.length) return links.join('\n');
  var folder = photoFolder_();
  var count = Math.min(photos.length, 6);
  for (var i = 0; i < count; i++) {
    var photo = photos[i] || {};
    var raw = String(photo.data || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    if (!raw) continue;
    var bytes;
    try {
      bytes = Utilities.base64Decode(raw);
    } catch (err) {
      console.error('photo decode failed', err);
      continue;
    }
    if (!bytes || bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) continue;
    if (!looksLikeImage_(bytes)) continue;
    var mime = imageMime_(bytes);
    var blob = Utilities.newBlob(bytes, mime, fileName_(data, links.length, mime));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    links.push(file.getUrl());
  }
  return links.join('\n');
}

function imageMime_(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
  return 'image/jpeg';
}

function looksLikeImage_(bytes) {
  if (!bytes || bytes.length < 12) return false;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  return false;
}

function fileName_(data, index, mime) {
  var ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  var id = String(data.requestId || 'lead').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36);
  return id + '-' + (index + 1) + '.' + ext;
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      console.error('PHOTO_FOLDER_ID invalid', err);
    }
  }
  var found = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// Run once from the editor so Apps Script can ask for Drive permission and
// print the folder id. The live web app uses the same folder.
function authorizePhotos() {
  var folder = photoFolder_();
  Logger.log(folder.getName() + ' ' + folder.getId());
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
