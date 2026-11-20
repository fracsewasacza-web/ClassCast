/* =====================================================================
   MODULE 2 — Request classroom reservations
   Screen: #/reserve
   One request can hold several halls or time slots ("Add another slot").
   Each slot is checked for clashes while the rep types, and again on submit.
   Several slots are sent together: all are booked, or none are.
   ===================================================================== */
const MAX_SLOTS = 20;   // the server accepts up to 20 bookings in one request

Screens.reserve = async function reserveView() {
  const [{ classrooms }, me] = await Promise.all([API.getLookups(), API.getMe()]);

  // Start from the slot chosen on the hall page, or from the last search
  const p = state.prefill || { classroom_id: classrooms[0].id, date: state.filters.date, start: state.filters.start, end: state.filters.end };
  state.prefill = null;
  if (p.date < API.today()) p.date = API.today();

  view.innerHTML = `
    <header class="page-head"><h1>Request a reservation</h1><p>Your request goes to the administrator for approval. Add more slots to book several halls or times at once.</p></header>
    <form id="reserve" class="card form" novalidate>
      <label>Course<select name="course_id">${options(me.courses, null, (c) => `${c.code} · ${c.title}`)}</select></label>
      <div id="slots" class="booking-slots"></div>
      <button type="button" class="btn sm add-slot" id="add-slot">+ Add another slot</button>
      <label>Purpose<input type="text" name="purpose" maxlength="200" placeholder="e.g. Make-up lecture" required></label>
      <label>Expected attendance<input type="number" name="expected_attendance" min="1" placeholder="Number of students" required></label>
      <p id="error" class="error" role="alert" hidden></p>
      <button type="submit" class="btn primary" id="submit">Submit request</button>
    </form>`;

  const form = $('#reserve'), slotsBox = $('#slots'), error = $('#error'), addBtn = $('#add-slot'), submitBtn = $('#submit');
  const slots = [];   // { el, free }

  const slotData = (s) => ({
    classroom_id: $('[name=classroom_id]', s.el).value,
    reservation_date: $('[name=reservation_date]', s.el).value,
    start_time: $('[name=start_time]', s.el).value,
    end_time: $('[name=end_time]', s.el).value,
  });

  // ---------- slots ----------
  function addSlot(v) {
    const el = document.createElement('div');
    el.className = 'booking-slot';
    el.setAttribute('role', 'group');
    el.innerHTML = `
      <div class="booking-slot-head"><span class="slot-title"></span><button type="button" class="btn sm remove-slot">Remove</button></div>
      <label>Hall<select name="classroom_id">${hallOptions(classrooms, v.classroom_id)}</select></label>
      <div class="cols">
        <label>Date<input type="date" name="reservation_date" value="${v.date}" min="${API.today()}" required></label>
        <label>From<input type="time" name="start_time" value="${v.start}" step="1800" required></label>
        <label>To<input type="time" name="end_time" value="${v.end}" step="1800" required></label>
      </div>
      <div class="notice" aria-live="polite"></div>
      <p class="error overlap" aria-live="polite" hidden></p>`;
    const s = { el, free: false };
    slots.push(s);
    slotsBox.append(el);
    $('.remove-slot', el).addEventListener('click', () => {
      slots.splice(slots.indexOf(s), 1);
      el.remove();
      renumber();
      checkAll();
    });
    el.addEventListener('input', () => { error.hidden = true; check(s); checkOverlaps(); });
    renumber();
    check(s);
    return s;
  }

  function renumber() {
    slots.forEach((s, i) => {
      const title = slots.length > 1 ? `Slot ${i + 1}` : 'Hall and time';
      $('.slot-title', s.el).textContent = title;
      s.el.setAttribute('aria-label', title);
      $('.remove-slot', s.el).hidden = slots.length === 1;
    });
    addBtn.hidden = slots.length >= MAX_SLOTS;
    submitBtn.textContent = slots.length > 1 ? `Submit ${slots.length} requests` : 'Submit request';
  }

  addBtn.addEventListener('click', () => {
    // New slot starts as a copy of the last one, an hour later the same day
    const last = slotData(slots[slots.length - 1]);
    const start = last.end_time || p.start;
    const s = addSlot({ classroom_id: last.classroom_id, date: last.reservation_date || p.date, start, end: addHours(start, 2) });
    $('[name=classroom_id]', s.el).focus();
    checkOverlaps();
  });

  // ---------- live clash check, one slot ----------
  async function check(s) {
    const d = slotData(s), box = $('.notice', s.el);
    s.free = false;
    if (!d.reservation_date || !d.start_time || !d.end_time) { box.className = 'notice'; box.textContent = ''; return; }
    if (d.end_time <= d.start_time) { box.className = 'notice warn'; box.textContent = 'End time must be after the start time.'; return; }

    const hits = await API.checkClash(d.classroom_id, d.reservation_date, d.start_time, d.end_time);
    if (!box.isConnected) return;   // the rep left this screen or removed the slot
    const now = slotData(s);
    if (now.classroom_id !== d.classroom_id || now.reservation_date !== d.reservation_date
        || now.start_time !== d.start_time || now.end_time !== d.end_time) return;   // a newer check is on its way
    if (!hits.length) {
      s.free = true;
      box.className = 'notice ok';
      box.innerHTML = '<strong>No clashes.</strong> Not on the timetable and no other booking in this slot.';
    } else {
      box.className = 'notice warn';
      box.innerHTML = `<strong>This slot is taken.</strong><ul>${hits.map((h) => `<li>${t12(h.start)} – ${t12(h.end)}: ${esc(h.label)}</li>`).join('')}</ul>
        <a href="#/halls" class="find-free">Find halls that are free at this time</a>`;
      $('.find-free', box).addEventListener('click', () => Object.assign(state.filters, { date: d.reservation_date, start: d.start_time, end: d.end_time }));
    }
    checkOverlaps();
  }
  const checkAll = () => Promise.all(slots.map(check));

  // ---------- slots in this request that clash with each other ----------
  function overlapPairs() {
    const pairs = [];
    for (let j = 1; j < slots.length; j++) {
      const b = slotData(slots[j]);
      for (let i = 0; i < j; i++) {
        const a = slotData(slots[i]);
        if (a.classroom_id === b.classroom_id && a.reservation_date === b.reservation_date
            && a.start_time < b.end_time && a.end_time > b.start_time) pairs.push([i, j]);
      }
    }
    return pairs;
  }
  // Marks the slots that overlap another slot in this request. Returns the first pair, or null.
  function checkOverlaps() {
    const pairs = overlapPairs();
    slots.forEach((s, k) => {
      const others = pairs.filter((pr) => pr.includes(k)).map(([i, j]) => (i === k ? j : i) + 1);
      const note = $('.overlap', s.el);
      s.el.classList.toggle('clash', others.length > 0);
      note.hidden = !others.length;
      note.textContent = others.length ? `Overlaps slot ${others.join(', ')} in this request — same hall, same time.` : '';
    });
    return pairs[0] || null;
  }

  // ---------- validate and submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await checkAll();
    const d = formData(form);
    const fail = (msg, slotIndex) => {
      error.textContent = msg; error.hidden = false;
      if (slotIndex !== undefined && slots[slotIndex]) slots[slotIndex].el.scrollIntoView({ block: 'nearest' });
    };
    const label = (i) => (slots.length > 1 ? `Slot ${i + 1}: ` : '');

    if (!d.purpose.trim()) return fail('Enter the purpose of the reservation.');
    if (!(Number(d.expected_attendance) > 0)) return fail('Enter the expected number of students.');
    for (const [i, s] of slots.entries()) {
      const v = slotData(s);
      const hall = classrooms.find((c) => String(c.id) === v.classroom_id);
      if (Number(d.expected_attendance) > hall.capacity) return fail(`${label(i)}${hall.name} only seats ${hall.capacity}. Choose a bigger hall.`, i);
      if (v.reservation_date < API.today()) return fail(`${label(i)}Choose today or a future date.`, i);
      if (!s.free) return fail(`${label(i)}Fix the time clash before submitting.`, i);
    }
    const pair = checkOverlaps();
    if (pair) return fail(`Slot ${pair[1] + 1} overlaps slot ${pair[0] + 1} in the same hall.`, pair[1]);

    const shared = { course_id: d.course_id, purpose: d.purpose.trim(), expected_attendance: Number(d.expected_attendance) };
    const bookings = slots.map((s) => ({ ...shared, ...slotData(s) }));

    submitBtn.disabled = true;
    try {
      if (bookings.length === 1) {
        await API.createReservation(bookings[0]);
        toast('Request sent. Waiting for admin approval.');
      } else {
        await API.createReservations(bookings);
        toast(`${bookings.length} requests sent. Waiting for admin approval.`);
      }
      location.hash = '#/reservations';          // Module 3 shows them in the history
    } catch (err) {
      // The server names the failing one as "Booking 2: ..."; show it as "Slot 2: ..."
      const m = /^Booking (\d+): (.*)$/s.exec(err.message);
      if (m) fail(`Slot ${m[1]}: ${m[2]}`, Number(m[1]) - 1); else fail(err.message);
      submitBtn.disabled = false;
      checkAll();
    }
  });

  addSlot(p);
};
