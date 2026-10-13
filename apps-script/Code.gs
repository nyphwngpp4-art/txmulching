// TX Mulching lead sink. A person deploys this from the Google account that
// owns the Sheet. Editing this file does not change production until that
// deploy happens. See apps-script/README.md.
//
// Required Script Properties, set BEFORE this version is deployed:
//   SHEET_ID       — the spreadsheet id (copy from the previous Code.gs)
//   NOTIFY_EMAILS  — comma-separated owner addresses (copy from the previous Code.gs)
//   TOKEN          — same value as the Worker secret APPS_SCRIPT_TOKEN
// Optional:
//   QUOTA_WATCH_EMAIL — who hears about a low MailApp quota (defaults to the first notify address)
//   PHOTO_FOLDER_ID   — Drive folder for lead photos (authorizePhotos fills this in)

var LEADS_SHEET = 'Sheet1';
var DEMO_SHEET = 'Demo Leads';
var PHOTO_FOLDER_NAME = 'TX Mulching Lead Photos';
var PHOTO_MAX_BYTES = 320 * 1024;
var PHOTO_COLUMN = 17;

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

  var config = deliveryConfig_();
  if (!config) {
    console.error('Lead delivery is not configured. Set the SHEET_ID and NOTIFY_EMAILS script properties.');
    return json_({ ok: false, error: 'not configured' });
  }

  var demo = data.demo === true || data.demo === 'true' || data.demo === '1';
  // Save Drive files before the row and the email, then drop the bytes so
  // they are not written into the Sheet.
  try {
    data.photoLinks = saveLeadPhotos_(data, config.emails);
  } catch (err) {
    console.error('photo save failed');
    data.photoLinks = photoLinks_(data);
  }
  delete data.photos;

  var sheet = openSheet_(config.sheetId, demo ? DEMO_SHEET : LEADS_SHEET);
  upsertLead_(sheet, data);

  if (!demo) {
    try {
      notifyLead_(data, config);
    } catch (err) {
      console.error('notify failed');
      return json_({ ok: false, error: 'notify failed' });
    }
  }

  return json_({ ok: true });
}

function deliveryConfig_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = String(props.getProperty('SHEET_ID') || '').replace(/^\s+|\s+$/g, '');
  var emails = parseEmails_(props.getProperty('NOTIFY_EMAILS'));
  if (!sheetId || !emails.length) return null;
  var quotaWatch = String(props.getProperty('QUOTA_WATCH_EMAIL') || '').replace(/^\s+|\s+$/g, '');
  return {
    sheetId: sheetId,
    emails: emails,
    quotaWatch: quotaWatch || emails[0]
  };
}

function parseEmails_(value) {
  var parts = String(value || '').split(/[,;\n]/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var email = parts[i].replace(/^\s+|\s+$/g, '');
    if (!email || out.indexOf(email) !== -1) continue;
    out.push(email);
  }
  return out;
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

function saveLeadPhotos_(data, emails) {
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
      console.error('photo decode failed');
      continue;
    }
    if (!bytes || bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) continue;
    if (!looksLikeImage_(bytes)) continue;
    var mime = imageMime_(bytes);
    var blob = Utilities.newBlob(bytes, mime, fileName_(data, links.length, mime));
    var file = folder.createFile(blob);
    // The file stays private to the script owner. Share view access with the
    // notify addresses only. A failed share must not drop the lead.
    sharePhoto_(file, emails);
    links.push(file.getUrl());
  }
  return links.join('\n');
}

function sharePhoto_(file, emails) {
  for (var i = 0; i < emails.length; i++) {
    try {
      file.addViewer(emails[i]);
    } catch (err) {
      console.error('photo share failed');
    }
  }
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
      console.error('PHOTO_FOLDER_ID invalid');
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

function openSheet_(sheetId, name) {
  var ss = SpreadsheetApp.openById(sheetId);
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
    'Callback window', 'Budget', 'Photo links', 'Ref', 'Source', 'Possible spam'
  ];
}

function rowValues_(data) {
  var flag = (data.needsReview === 'yes' || data.needsReview === true) ? 'review' : data.possibleSpam;
  return [
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
    cell_(data.source),
    cell_(flag)
  ];
}

// A retry of the same requestId updates the row. Photo links already on the
// row are kept when this attempt has no new links (photo bytes are not retried).
function upsertLead_(sheet, data) {
  var values = rowValues_(data);
  var requestId = String(data.requestId || '');
  var found = requestId ? findRequestRow_(sheet, requestId) : 0;
  if (!found) {
    sheet.appendRow(values);
    return;
  }
  if (!String(values[PHOTO_COLUMN - 1] || '').replace(/^\s+|\s+$/g, '')) {
    var existingPhotos = sheet.getRange(found, PHOTO_COLUMN).getValue();
    if (existingPhotos) values[PHOTO_COLUMN - 1] = existingPhotos;
  }
  sheet.getRange(found, 2, 1, values.length - 1).setValues([values.slice(1)]);
}

function findRequestRow_(sheet, requestId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var ids = sheet.getRange(2, 9, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === requestId) return i + 2;
  }
  return 0;
}

function notifyLead_(data, config) {
  var remaining = MailApp.getRemainingDailyQuota();
  maybeWarnQuota_(remaining, config.quotaWatch);

  var subject = subjectFor_(data);
  var body = bodyFor_(data, config.sheetId);
  var replyTo = data.email || '';

  if (remaining < 1) {
    throw new Error('MailApp daily quota is exhausted');
  }

  // One message so a burst cannot multiply the recipient count. If that send
  // throws, fall back to one recipient at a time so a single bad address
  // cannot hide the lead from everyone else.
  var recipients = remaining >= config.emails.length ? config.emails : [config.quotaWatch];
  try {
    var message = {
      to: recipients[0],
      bcc: recipients.slice(1).join(','),
      name: 'TX Mulching Leads',
      subject: subject,
      body: body
    };
    if (replyTo) message.replyTo = replyTo;
    MailApp.sendEmail(message);
    return;
  } catch (err) {
    console.error('group email failed');
  }

  recipients.forEach(function (to) {
    try {
      var single = {
        to: to,
        name: 'TX Mulching Leads',
        subject: subject,
        body: body
      };
      if (replyTo) single.replyTo = replyTo;
      MailApp.sendEmail(single);
    } catch (inner) {
      console.error('email failed');
    }
  });
}

function maybeWarnQuota_(remaining, quotaWatch) {
  if (remaining >= 8 || !quotaWatch) return;
  var props = PropertiesService.getScriptProperties();
  var today = new Date().toDateString();
  if (props.getProperty('QUOTA_WARNED_ON') === today) return;
  props.setProperty('QUOTA_WARNED_ON', today);
  try {
    MailApp.sendEmail({
      to: quotaWatch,
      name: 'TX Mulching Leads',
      subject: 'TX Mulching lead mail quota is low (' + remaining + ' left)',
      body: 'MailApp has about ' + remaining + ' recipient sends left today. Real lead alerts may start failing until the quota resets.'
    });
  } catch (err) {
    console.error('quota warning failed');
  }
}

function subjectFor_(data) {
  var acres = data.acreage || 'acreage not given';
  var service = data.serviceType || 'land clearing';
  var where = data.city || data.zipcode || 'location not given';
  var who = shortName_(data.name);
  var phone = data.phone || 'no phone';
  var subject = 'New lead: ' + acres + ' ' + service + ' near ' + where + ' — ' + who + ' ' + phone;
  if (data.needsReview === 'yes' || data.needsReview === true) subject = 'Review this lead: ' + subject;
  else if (data.possibleSpam === 'yes' || data.possibleSpam === true) subject = 'Possible spam: ' + subject;
  return subject.slice(0, 180);
}

function spamWhy_(data) {
  var why = data.spamReasons;
  if (Array.isArray(why)) return why.filter(Boolean).join(', ');
  return why ? String(why) : '';
}

function shortName_(name) {
  var parts = String(name || 'Unknown').trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

function bodyFor_(data, sheetId) {
  var mapQuery = [data.address, data.city, data.county, data.zipcode, 'TX'].filter(Boolean).join(', ');
  var mapLink = mapQuery
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery)
    : '—';
  var photos = photoLinks_(data) || '—';
  var lines = [
    'Name: ' + (data.name || '—'),
    'Phone: ' + (data.phone || '—'),
    'Email: ' + (data.email || '—'),
    'Service: ' + (data.serviceType || '—'),
    'Acreage: ' + (data.acreage || '—'),
    'Brush: ' + (data.density || '—'),
    'Timeline: ' + (data.timeline || '—'),
    'Callback window: ' + (data.callbackWindow || '—'),
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
    'All leads: https://docs.google.com/spreadsheets/d/' + sheetId + '/edit'
  ];
  if (data.needsReview === 'yes' || data.needsReview === true || data.possibleSpam === 'yes' || data.possibleSpam === true) {
    var why = spamWhy_(data);
    lines.unshift('Needs review: yes' + (why ? ' (' + why + ')' : ''));
  }
  return lines.join('\n');
}

function json_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor after the script properties are set.
// Sends a clearly labelled test to the notify list. Does not write a Sheet row.
function testNotification() {
  var config = deliveryConfig_();
  if (!config) {
    console.error('Lead delivery is not configured. Set the SHEET_ID and NOTIFY_EMAILS script properties.');
    return;
  }
  notifyLead_({
    name: 'TEST — delete me',
    phone: '(555) 010-0000',
    acreage: '5 acres',
    serviceType: 'Forestry Mulching',
    city: 'Tyler',
    description: 'Test of lead notifications. Delete this row if one was created.'
  }, config);
}
