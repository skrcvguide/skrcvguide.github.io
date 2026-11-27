/**
 * SKR CV Guide — booking backend (Google Apps Script, bound to the bookings Google Sheet).
 *
 * Setup (see SETUP.md):
 *  1. Create a Google Sheet, open Extensions → Apps Script, paste this file.
 *  2. Run `setup` once (authorises the script and writes the header row).
 *  3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *  4. Copy the /exec URL into `assets/config.js` on the website (BOOKING_ENDPOINT).
 */

const SHEET_NAME = 'Bookings';
// Optional: ID of an existing Google Sheet (from its URL). Leave empty to auto-create one on first `setup` run.
const SHEET_ID = '';
const FIRST_ID = 1000;
const ID_STEP = 11;
// Leave empty to notify the Google account that owns the script.
const NOTIFY_EMAIL = '';
// Also send the student an automatic "request received" email.
const SEND_STUDENT_RECEIPT = true;
const SITE_URL = 'https://skrcvguide.github.io/';

const HEADERS = [
  'Booking ID', 'Submission Date', 'Student Name', 'Email', 'WhatsApp', 'Address',
  'University', 'Department', 'Academic Status', 'Study Year / Graduation', 'Occupation',
  'Selected Service', 'Do you want to add more?', 'Appointment Date', 'Appointment Time',
  'Duration', 'Fee', 'Payment Status', 'Booking Status', 'Google Meet Link', 'Admin Notes'
];

// Prices are decided here, never trusted from the browser.
const SERVICES = {
  batch:      { name: 'Batch Session',      duration: '1.5 hours', minutes: 90, fee: 1499 },
  individual: { name: 'Individual Session', duration: '1 hour',    minutes: 60, fee: 1499 }
};

// Booking windows in Bangladesh Standard Time (UTC+6). 0 = Sunday … 6 = Saturday.
const WINDOWS = {
  weekday: [[17 * 60, 20 * 60]],
  weekend: [[9 * 60, 13 * 60], [17 * 60, 20 * 60]]
};
// Batch: Sunday nights only, start times 5:00 PM and 6:30 PM.
const BATCH = { days: [0], windows: [[17 * 60, 20 * 60]], step: 90 };

function setup() {
  const sh = getSheet_();
  Logger.log('Bookings sheet: ' + sh.getParent().getUrl());
  Logger.log('Receipts folder: ' + getReceiptFolder_().getUrl());   // also asks for Google Drive permission
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function getSpreadsheet_() {
  // Works both as a sheet-bound script and as a standalone script.
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = SHEET_ID || props.getProperty('sheetId');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('SKR CV Guide — Bookings');
  props.setProperty('sheetId', ss.getId());
  return ss;
}

function getSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

/** GET → list of slots already taken (date + time), so the site can grey them out. */
function doGet(e) {
  const sh = getSheet_();
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getDisplayValues() : [];
  const taken = rows
    .filter(r => !/cancel|reject/i.test(r[18]))           // Booking Status
    .map(r => ({ date: r[13], time: r[14], service: r[11] }));
  return json_({ ok: true, taken: taken });
}

/** POST → validate, assign Booking ID, append row, send emails. */
function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Invalid request.' });
  }
  if (d.website) return json_({ ok: true, bookingId: 0 }); // honeypot: silently drop bots
  if (d.action === 'receipt') return handleReceipt_(d);

  const required = ['name', 'email', 'whatsapp', 'address', 'university', 'department',
    'academicStatus', 'studyYear', 'occupation', 'service', 'date', 'time'];
  for (const k of required) {
    if (!d[k] || String(d[k]).trim() === '') return json_({ ok: false, error: 'Missing field: ' + k });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return json_({ ok: false, error: 'Invalid email.' });
  const svc = SERVICES[d.service];
  if (!svc) return json_({ ok: false, error: 'Unknown service.' });
  if (!validSlot_(d.date, d.time, svc.minutes, d.service === 'batch')) return json_({ ok: false, error: 'That time is outside booking hours.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    // slot already requested?
    const last = sh.getLastRow();
    if (last > 1) {
      const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
      const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const start = mins(d.time), end = start + svc.minutes;
      const clash = rows.some(r => {
        if (r[13] !== d.date || /cancel|reject/i.test(r[18]) || !/^\d{2}:\d{2}$/.test(r[14])) return false;
        const other = Object.values(SERVICES).find(x => x.name === r[11]) || SERVICES.individual;
        const s2 = mins(r[14]), e2 = s2 + other.minutes;
        if (d.service === 'batch' && r[11] === SERVICES.batch.name && s2 === start) return false; // same batch, join it
        return start < e2 && s2 < end;
      });
      if (clash) return json_({ ok: false, error: 'Sorry, this slot was just requested by someone else. Please pick another time.' });
    }
    const props = PropertiesService.getScriptProperties();
    const prev = Number(props.getProperty('lastBookingId') || (FIRST_ID - ID_STEP));
    const id = prev + ID_STEP;
    props.setProperty('lastBookingId', String(id));

    const now = Utilities.formatDate(new Date(), 'Asia/Dhaka', 'yyyy-MM-dd HH:mm');
    const clean = v => String(v || '').replace(/^[=+\-@]/, "'$&").slice(0, 1000); // block formula injection
    const row = [
      id, now, clean(d.name), clean(d.email), clean(d.whatsapp), clean(d.address),
      clean(d.university), clean(d.department), clean(d.academicStatus), clean(d.studyYear), clean(d.occupation),
      svc.name, clean(d.addMore), d.date, d.time, svc.duration, svc.fee + ' BDT',
      'Pending', 'Requested', '', ''
    ];
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), 14, 1, 2).setNumberFormat('@'); // keep date/time as text

    notifyOwner_(id, row);
    if (SEND_STUDENT_RECEIPT) receipt_(id, d, svc);
    return json_({ ok: true, bookingId: id });
  } finally {
    lock.releaseLock();
  }
}

function validSlot_(date, time, minutes, isBatch) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return false;
  const day = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3])).getUTCDay();
  const start = +tm[1] * 60 + +tm[2];
  if (isBatch) {
    if (BATCH.days.indexOf(day) < 0) return false;
    return BATCH.windows.some(([a, b]) => start >= a && start + minutes <= b && (start - a) % BATCH.step === 0);
  }
  const wins = (day === 0 || day === 6) ? WINDOWS.weekend : WINDOWS.weekday;
  return wins.some(([a, b]) => start >= a && start + minutes <= b);
}

function notifyOwner_(id, row) {
  const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  const lines = HEADERS.map((h, i) => `<tr><td style="padding:4px 10px;color:#555">${h}</td><td style="padding:4px 10px"><b>${esc_(row[i])}</b></td></tr>`).join('');
  MailApp.sendEmail({
    to: to,
    subject: `New booking #${id} — ${row[2]} — ${row[13]} ${row[14]}`,
    htmlBody: `<p>A new consultation request arrived.</p><table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${lines}</table>
      <p>Verify the payment, then confirm on WhatsApp: ${esc_(row[4])}</p>`,
    replyTo: row[3]
  });
}

function receipt_(id, d, svc) {
  MailApp.sendEmail({
    to: d.email,
    subject: `Booking request received — #${id} (SKR CV Guide)`,
    htmlBody: `<p>Hi ${esc_(d.name)},</p>
      <p>Thanks! We received your request for a <b>${svc.name}</b> (${svc.duration}) on <b>${esc_(d.date)} at ${esc_(d.time)}</b> (Bangladesh time).</p>
      <p>Your Booking ID is <b>#${id}</b>.</p>
      <p><b>Next steps:</b></p>
      <ol>
        <li>Pay <b>${svc.fee} BDT</b> by bank transfer (bank details are on the website).</li>
        <li>Upload a screenshot or receipt of the transfer and click <b>Request Payment Verification</b>:<br>
          <a href="${SITE_URL}#verify">${SITE_URL}#verify</a> (use Booking ID <b>${id}</b> and this email address).</li>
      </ol>
      <p>Once your payment is verified, our team will confirm your slot on WhatsApp (${esc_(d.whatsapp)}).</p>
      <p>— SKR CV Guide</p>`
  });
}

/* ---------- payment receipt upload ---------- */
const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

function getReceiptFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('receiptFolderId');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ } }
  const f = DriveApp.createFolder('SKR CV Guide — Payment receipts');
  props.setProperty('receiptFolderId', f.getId());
  return f;
}

function handleReceipt_(d) {
  const id = String(d.bookingId || '').replace(/\D/g, '');
  const email = String(d.email || '').trim().toLowerCase();
  const ext = RECEIPT_TYPES[d.mimeType];
  if (!id || !email) return json_({ ok: false, error: 'Please enter your Booking ID and email.' });
  if (!ext) return json_({ ok: false, error: 'Please upload an image (JPG/PNG) or a PDF.' });
  let bytes;
  try { bytes = Utilities.base64Decode(String(d.data || '')); } catch (e) { return json_({ ok: false, error: 'The file could not be read. Please try again.' }); }
  if (!bytes.length) return json_({ ok: false, error: 'The file is empty.' });
  if (bytes.length > MAX_RECEIPT_BYTES) return json_({ ok: false, error: 'The file is larger than 8 MB.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    if (last < 2) return json_({ ok: false, error: 'Booking not found. Please check your Booking ID.' });
    const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
    const i = rows.findIndex(r => String(r[0]) === id && String(r[3]).trim().toLowerCase() === email);
    if (i < 0) return json_({ ok: false, error: 'We could not find a booking with this Booking ID and email. Please check both.' });
    const r = rows[i], rowNo = i + 2;

    const stamp = Utilities.formatDate(new Date(), 'Asia/Dhaka', 'yyyy-MM-dd HH-mm');
    const blob = Utilities.newBlob(bytes, d.mimeType, `#${id} - ${r[2]} - ${stamp}.${ext}`);
    const file = getReceiptFolder_().createFile(blob);
    const url = file.getUrl();

    sh.getRange(rowNo, 18).setValue('Verification requested');            // R Payment Status
    const notes = sh.getRange(rowNo, 21).getValue();                       // U Admin Notes
    sh.getRange(rowNo, 21).setValue((notes ? notes + '\n' : '') + `Receipt (${stamp}): ${url}`);

    MailApp.sendEmail({
      to: NOTIFY_EMAIL || Session.getEffectiveUser().getEmail(),
      subject: `Payment verification requested — #${id} — ${r[2]}`,
      htmlBody: `<p><b>${esc_(r[2])}</b> uploaded a payment receipt for booking <b>#${id}</b>.</p>
        <p>${esc_(r[11])} · ${esc_(r[13])} ${esc_(r[14])} · Fee ${esc_(r[16])}<br>WhatsApp: ${esc_(r[4])}</p>
        <p>Receipt: <a href="${url}">${url}</a> (also attached)</p>
        <p>After checking it, set Payment Status to <b>Paid</b> and Booking Status to <b>Confirmed</b>, then confirm on WhatsApp.</p>`,
      attachments: [blob],
      replyTo: r[3]
    });
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function esc_(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
