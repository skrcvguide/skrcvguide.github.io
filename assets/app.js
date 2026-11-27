(function () {
  const C = window.SITE_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const form = $('#bookingForm');
  let taken = [];          // [{date, time, service}]
  let lastBooking = null;

  /* ---------- Bangladesh Standard Time helpers (UTC+6, no DST) ---------- */
  const BST_OFFSET = 6 * 60 * 60 * 1000;
  const bstNow = () => new Date(Date.now() + BST_OFFSET);            // read with getUTC*
  const ymd = d => d.toISOString().slice(0, 10);
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt12 = min => { let h = Math.floor(min / 60), m = min % 60; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; };
  const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const longDate = s => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  /* ---------- bank details with per-line copy ---------- */
  function renderBank() {
    const rows = C.BANK.filter(r => r.value && r.value.trim());
    $$('[data-bank]').forEach(box => {
      if (!rows.length) { box.innerHTML = '<div class="bank-missing">Bank details will be shared on WhatsApp.</div>'; return; }
      box.innerHTML = rows.map(r => `<div class="bank-row"><div><small>${esc(r.label)}</small><b>${esc(r.value)}</b></div>
        <button type="button" class="copy" data-copy="${esc(r.value)}" aria-label="Copy ${esc(r.label)}">Copy</button></div>`).join('');
    });
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const text = b.getAttribute('data-copy');
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    b.textContent = 'Copied ✓'; b.classList.add('done'); toast('Copied: ' + text);
    setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1600);
  });
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------- date + slots ---------- */
  const dateIn = $('#date');
  const tomorrow = bstNow(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const maxD = bstNow(); maxD.setUTCDate(maxD.getUTCDate() + C.BOOK_AHEAD_DAYS);
  dateIn.min = ymd(tomorrow); dateIn.max = ymd(maxD);

  function service() { const r = $('input[name=service]:checked'); return r ? r.value : null; }
  function minutesOf(svcName) { const s = Object.values(C.SERVICES).find(x => x.name === svcName); return s ? s.minutes : 60; }

  function renderSlots() {
    const box = $('#slots'), hint = $('#dayHint'), svc = service(), d = dateIn.value;
    $('#time').value = '';
    box.innerHTML = '';
    if (!svc || !d) { hint.textContent = !svc ? 'Choose a service first.' : 'Choose a date to see open times.'; updateSummary(); return; }
    if (d < dateIn.min || d > dateIn.max) { hint.textContent = 'Please choose a date between tomorrow and the next ' + C.BOOK_AHEAD_DAYS + ' days.'; updateSummary(); return; }
    const dow = parseYmd(d).getUTCDay(), weekend = dow === 0 || dow === 6;
    const isBatch = svc === 'batch';
    if (isBatch && !C.BATCH.days.includes(dow)) {
      hint.textContent = `${longDate(d)} · Batch sessions run on Sunday nights only (5 PM – 8 PM). Please pick a Sunday.`;
      updateSummary(); return;
    }
    const wins = isBatch ? C.BATCH.windows : (weekend ? C.WINDOWS.weekend : C.WINDOWS.weekday), len = C.SERVICES[svc].minutes;
    const step = isBatch ? C.BATCH.step : C.SLOT_STEP_MIN;
    const busy = taken.filter(t => t.date === d).map(t => [toMin(t.time), toMin(t.time) + minutesOf(t.service), t.service === C.SERVICES.batch.name]);
    let open = 0;
    wins.forEach(([a, b]) => {
      for (let s = a; s + len <= b; s += step) {
        // several students may join the same batch: same-time batch requests don't clash
        const clash = busy.some(([x, y, isBatch]) => s < y && x < s + len && !(svc === 'batch' && isBatch && x === s));
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'slot'; btn.dataset.t = hhmm(s);
        btn.setAttribute('role', 'radio'); btn.setAttribute('aria-checked', 'false');
        btn.innerHTML = `${fmt12(s)} <span class="end">– ${fmt12(s + len)}</span>`;
        if (clash) { btn.disabled = true; btn.title = 'Already requested'; } else open++;
        box.appendChild(btn);
      }
    });
    const label = isBatch ? 'Sunday night batch: 5 PM – 8 PM' : (weekend ? 'Weekend: 9 AM–1 PM & 5 PM–8 PM' : 'Weekday: 5 PM–8 PM');
    hint.textContent = `${longDate(d)} · ${label}${open ? '' : ' · No open times left, please try another date.'}`;
    updateSummary();
  }
  $('#slots').addEventListener('click', e => {
    const b = e.target.closest('.slot'); if (!b || b.disabled) return;
    $$('.slot').forEach(x => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
    b.classList.add('on'); b.setAttribute('aria-checked', 'true');
    $('#time').value = b.dataset.t; $('#slots').classList.remove('invalid'); updateSummary();
  });
  dateIn.addEventListener('change', renderSlots);
  function nextSunday() {
    const n = parseYmd(dateIn.min);
    while (!C.BATCH.days.includes(n.getUTCDay())) n.setUTCDate(n.getUTCDate() + 1);
    return ymd(n);
  }
  $$('input[name=service]').forEach(r => r.addEventListener('change', () => {
    if (service() === 'batch' && (!dateIn.value || !C.BATCH.days.includes(parseYmd(dateIn.value).getUTCDay()))) dateIn.value = nextSunday();
    renderSlots();
  }));
  $$('[data-pick]').forEach(a => a.addEventListener('click', () => {
    const r = $(`input[name=service][value=${a.dataset.pick}]`); r.checked = true; r.dispatchEvent(new Event('change'));
  }));

  function updateSummary() {
    const svc = service(), d = dateIn.value, t = $('#time').value, s = $('#summary');
    if (!svc || !d || !t) { s.style.display = 'none'; return; }
    const S = C.SERVICES[svc];
    s.innerHTML = `You're requesting <b>${S.name}</b> (${S.duration}) on <b>${longDate(d)}</b> at <b>${fmt12(toMin(t))} BST</b> · Fee <b>${S.fee} BDT</b>`;
    s.style.display = 'block';
  }

  /* ---------- live "now in BST" note ---------- */
  function tick() { const n = bstNow(); $('#nowBst').textContent = `Current time in Bangladesh: ${fmt12(n.getUTCHours() * 60 + n.getUTCMinutes())}, ${n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}`; }
  tick(); setInterval(tick, 30000);

  /* ---------- load already-requested slots ---------- */
  async function loadTaken() {
    if (!C.BOOKING_ENDPOINT || C.BOOKING_ENDPOINT === 'demo') return;
    try {
      const r = await fetch(C.BOOKING_ENDPOINT, { method: 'GET' });
      const j = await r.json(); if (j.ok) { taken = j.taken || []; renderSlots(); }
    } catch (e) { /* availability is best-effort; server re-checks clashes */ }
  }

  /* ---------- submit ---------- */
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#formErr'); err.textContent = '';
    $$('.invalid', form).forEach(x => x.classList.remove('invalid'));
    let first = null;
    const mark = (el, msg) => { el.classList.add('invalid'); if (!first) { first = el; err.textContent = msg; } };

    if (!service()) mark($('.svc-pick'), 'Please choose a service.');
    if (!dateIn.value) mark(dateIn, 'Please choose an appointment date.');
    else if (!$('#time').value) mark($('#slots'), 'Please choose an appointment time.');
    $$('input[required]:not([type=radio]):not([type=checkbox]):not([type=hidden]), select[required]', form).forEach(el => {
      if (el.name === 'date') return;
      if (!el.value.trim() || !el.checkValidity()) mark(el, `Please check: ${el.closest('label').firstChild.textContent.trim()}`);
    });
    if (!$('input[name=academicStatus]:checked')) mark($('.chips'), 'Please choose your academic status.');
    if (!form.agree.checked) mark($('.agree'), 'Please tick the confirmation box.');
    if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    const fd = new FormData(form);
    const extras = fd.getAll('extras');
    const addMore = [extras.join(', '), (fd.get('addMoreText') || '').trim()].filter(Boolean).join(' | ');
    const payload = {
      name: fd.get('name').trim(), email: fd.get('email').trim(), whatsapp: fd.get('whatsapp').trim(),
      address: fd.get('address').trim(), university: fd.get('university').trim(), department: fd.get('department').trim(),
      academicStatus: fd.get('academicStatus'), studyYear: fd.get('studyYear'), occupation: fd.get('occupation'),
      service: service(), addMore, date: dateIn.value, time: $('#time').value,
      website: fd.get('website') || ''
    };

    const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      let res;
      if (C.BOOKING_ENDPOINT === 'demo') res = { ok: true, bookingId: 1000 };
      else if (!C.BOOKING_ENDPOINT) throw new Error('The booking system is not connected yet. Please contact us on WhatsApp.');
      else {
        const r = await fetch(C.BOOKING_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
        res = await r.json();
      }
      if (!res.ok) throw new Error(res.error || 'Something went wrong. Please try again.');
      showSuccess(res.bookingId, payload);
      loadTaken();
    } catch (ex) {
      err.textContent = ex.message || 'Network error. Please try again.';
    } finally {
      btn.disabled = false; btn.textContent = 'Submit booking request';
    }
  });

  function showSuccess(id, p) {
    const S = C.SERVICES[p.service];
    lastBooking = id;
    form.hidden = true; $('#success').hidden = false;
    $('#bid').textContent = '#' + id;
    $('#successText').innerHTML = `${esc(S.name)} · ${esc(longDate(p.date))} at ${fmt12(toMin(p.time))} BST. A copy was sent to <b>${esc(p.email)}</b>.`;
    $('#payAmount').textContent = S.fee + ' BDT';
    openVerify(id, p.email, true);
    $('#success').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- payment receipt upload ---------- */
  const vf = $('#verify');
  const MAX_BYTES = 8 * 1024 * 1024;
  function openVerify(id, email, fromBooking) {
    vf.hidden = false;
    $$('#verify > :not(#verifyDone)').forEach(el => { if (el.id !== 'verifyErr') el.hidden = false; });
    $('#verifyDone').hidden = true; $('#verifyErr').textContent = '';
    if (id) vf.bookingId.value = id;
    if (email) vf.email.value = email;
    $('#verifyIds').hidden = !!fromBooking;          // after booking we already know ID + email
    vf.receipt.value = ''; $('#receiptPreview').hidden = true;
    $('#dropText').innerHTML = '<b>Choose a screenshot or receipt</b><small>JPG, PNG or PDF · up to 8 MB</small>';
  }
  $('#openVerify').addEventListener('click', e => {
    e.preventDefault(); openVerify(null, null, false); vf.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (location.hash === '#verify') openVerify(null, null, false);

  vf.receipt.addEventListener('change', () => {
    const f = vf.receipt.files[0], pv = $('#receiptPreview');
    $('#drop').classList.remove('invalid');
    if (!f) return;
    $('#dropText').innerHTML = `<b>${esc(f.name)}</b><small>${(f.size / 1048576).toFixed(1)} MB · tap to change</small>`;
    if (f.type.startsWith('image/')) { pv.src = URL.createObjectURL(f); pv.hidden = false; } else pv.hidden = true;
  });

  // shrink big photos/screenshots so uploads are fast on mobile data
  function shrinkImage(file) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/') || file.type === 'image/gif') return resolve(file);
      const img = new Image();
      img.onload = () => {
        const max = 1800, k = Math.min(1, max / Math.max(img.width, img.height));
        if (k === 1 && file.size < 1.5 * 1048576) return resolve(file);
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }
  const toBase64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

  vf.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#verifyErr'); err.textContent = '';
    const id = String(vf.bookingId.value).replace(/\D/g, ''), email = vf.email.value.trim(), file = vf.receipt.files[0];
    if (!id) { vf.bookingId.classList.add('invalid'); err.textContent = 'Please enter your Booking ID.'; return; }
    if (!vf.email.checkValidity() || !email) { vf.email.classList.add('invalid'); err.textContent = 'Please enter the email you used for booking.'; return; }
    if (!file) { $('#drop').classList.add('invalid'); err.textContent = 'Please choose a screenshot or receipt of your transfer.'; return; }
    if (!/^image\/|application\/pdf/.test(file.type)) { err.textContent = 'Please upload an image (JPG/PNG) or a PDF.'; return; }

    const btn = $('#verifyBtn'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const f = await shrinkImage(file);
      if (f.size > MAX_BYTES) throw new Error('The file is larger than 8 MB. Please upload a smaller screenshot.');
      const payload = { action: 'receipt', bookingId: id, email, fileName: f.name, mimeType: f.type || 'application/octet-stream', data: await toBase64(f) };
      let res;
      if (C.BOOKING_ENDPOINT === 'demo') res = { ok: true };
      else {
        const r = await fetch(C.BOOKING_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
        res = await r.json();
      }
      if (!res.ok) throw new Error(res.error || 'Upload failed. Please try again.');
      $$('#verify > :not(#verifyDone)').forEach(el => el.hidden = true);
      $('#verifyId').textContent = '#' + id;
      $('#verifyDone').hidden = false;
    } catch (ex) {
      err.textContent = ex.message || 'Network error. Please try again.';
    } finally {
      btn.disabled = false; btn.textContent = 'Request Payment Verification';
    }
  });

  $('#againBtn').addEventListener('click', () => {
    form.reset(); renderSlots(); form.hidden = false; $('#success').hidden = true; vf.hidden = true;
    form.scrollIntoView({ behavior: 'smooth' });
  });

  renderBank(); renderSlots(); loadTaken();
})();
