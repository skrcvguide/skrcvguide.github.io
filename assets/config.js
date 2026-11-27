// ===== Edit this file to change site settings =====
window.SITE_CONFIG = {
  // Google Apps Script web-app URL (Deploy → Web app → copy the URL ending in /exec)
  BOOKING_ENDPOINT: '',

  // Bank payment details — each line gets its own Copy button.
  BANK: [
    { label: 'Bank Name',      value: '' },
    { label: 'Account Name',   value: '' },
    { label: 'Account Number', value: '' },
    { label: 'Branch',         value: '' },
    { label: 'Routing Number', value: '' }
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
  SLOT_STEP_MIN: 30,     // start times every 30 minutes
  BOOK_AHEAD_DAYS: 45    // how far ahead students can request
};
