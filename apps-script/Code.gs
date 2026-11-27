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
const FIRST_ID = 1000;
const ID_STEP = 11;
// Leave empty to notify the Google account that owns the script.
const NOTIFY_EMAIL = '';
// Also send the student an automatic "request received" email.
const SEND_STUDENT_RECEIPT = true;

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

function setup() {
  const sh = getSheet_();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

  const required = ['name', 'email', 'whatsapp', 'address', 'university', 'department',
    'academicStatus', 'studyYear', 'occupation', 'service', 'date', 'time'];
  for (const k of required) {
    if (!d[k] || String(d[k]).trim() === '') return json_({ ok: false, error: 'Missing field: ' + k });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return json_({ ok: false, error: 'Invalid email.' });
  const svc = SERVICES[d.service];
  if (!svc) return json_({ ok: false, error: 'Unknown service.' });
  if (!validSlot_(d.date, d.time, svc.minutes)) return json_({ ok: false, error: 'That time is outside booking hours.' });

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
    const notes = d.paymentRef ? 'Student payment ref: ' + clean(d.paymentRef) : '';
    const row = [
      id, now, clean(d.name), clean(d.email), clean(d.whatsapp), clean(d.address),
      clean(d.university), clean(d.department), clean(d.academicStatus), clean(d.studyYear), clean(d.occupation),
      svc.name, clean(d.addMore), d.date, d.time, svc.duration, svc.fee + ' BDT',
      d.paymentRef ? 'Submitted – verify' : 'Pending', 'Requested', '', notes
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

function validSlot_(date, time, minutes) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return false;
  const day = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3])).getUTCDay();
  const start = +tm[1] * 60 + +tm[2];
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
      <p>Your Booking ID is <b>#${id}</b>. Please use it as the reference when you pay <b>${svc.fee} BDT</b>.</p>
      <p>Once your payment is verified, our team will confirm your slot on WhatsApp (${esc_(d.whatsapp)}).</p>
      <p>— SKR CV Guide</p>`
  });
}

function esc_(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
