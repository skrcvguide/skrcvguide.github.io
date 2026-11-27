// ===== Edit this file to change site settings =====
window.SITE_CONFIG = {
  // Google Apps Script web-app URL (Deploy → Web app → copy the URL ending in /exec)
  BOOKING_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxCxZkC7HEpHho0dny-kYbUyVl9HsOeoW3FNVStUkmqYrAsoi3uLv4tix7WfmbTmaQ/exec',

  // Bank payment details — each line gets its own Copy button.
  BANK: [
    { label: 'Account Number', value: '1082098320001' },
    { label: 'Account Name',   value: 'SAJEEB KUMAR RAY' },
    { label: 'Bank Name',      value: 'BRAC Bank PLC' },
    { label: 'Branch Name',    value: 'RAJSHAHI BRANCH' },
    { label: 'Routing Number', value: '060811934' },
    { label: 'SWIFT Code',     value: 'BRAKBDDH' }
  ],

  SERVICES: {
    batch:      { name: 'Batch Session',      minutes: 90, fee: 1499, oldFee: null, duration: '1.5 hours' },
    individual: { name: 'Individual Session', minutes: 60, fee: 1499, oldFee: 1999, duration: '1 hour' }
  },

  // Booking windows (Bangladesh Standard Time, minutes from midnight)
  WINDOWS: {
    weekday: [[17 * 60, 20 * 60]],
    weekend: [[9 * 60, 13 * 60], [17 * 60, 20 * 60]]
  },
  // Batch sessions: Sunday nights only, fixed start times (every 90 minutes)
  BATCH: { days: [0], windows: [[17 * 60, 20 * 60]], step: 90 },
  SLOT_STEP_MIN: 30,     // start times every 30 minutes
  BOOK_AHEAD_DAYS: 45    // how far ahead students can request
};
