/* =====================================================================
   MODULE 2 — Request classroom reservations
   Screen: #/reserve
   The form checks for clashes while the rep types, and again on submit.
   ===================================================================== */
Screens.reserve = async function reserveView() {
  const [{ classrooms }, me] = await Promise.all([API.getLookups(), API.getMe()]);

  // Start from the slot chosen on the hall page, or from the last search
  const p = state.prefill || { classroom_id: classrooms[0].id, date: state.filters.date, start: state.filters.start, end: state.filters.end };
  state.prefill = null;
  if (p.date < API.today()) p.date = API.today();

  view.innerHTML = `
    <header class="page-head"><h1>Request a reservation</h1><p>Your request goes to the administrator for approval.</p></header>
    <form id="reserve" class="card form" novalidate>
      <label>Hall<select name="classroom_id">${hallOptions(classrooms, p.classroom_id)}</select></label>
      <label>Course<select name="course_id">${options(me.courses, null, (c) => `${c.code} · ${c.title}`)}</select></label>
      <div class="cols">
        <label>Date<input type="date" name="reservation_date" value="${p.date}" min="${API.today()}" required></label>
        <label>From<input type="time" name="start_time" value="${p.start}" step="1800" required></label>
        <label>To<input type="time" name="end_time" value="${p.end}" step="1800" required></label>
      </div>
      <label>Purpose<input type="text" name="purpose" maxlength="200" placeholder="e.g. Make-up lecture" required></label>
      <label>Expected attendance<input type="number" name="expected_attendance" min="1" placeholder="Number of students" required></label>
      <div id="clash" class="notice" aria-live="polite"></div>
      <p id="error" class="error" role="alert" hidden></p>
      <button type="submit" class="btn primary" id="submit">Submit request</button>
    </form>`;

  const form = $('#reserve'), clashBox = $('#clash'), error = $('#error');
  let slotFree = false;

  // ---------- live clash check ----------
  async function check() {
    const d = formData(form);
    slotFree = false;
    if (!d.reservation_date || !d.start_time || !d.end_time) { clashBox.className = 'notice'; clashBox.textContent = ''; return; }
    if (d.end_time <= d.start_time) { clashBox.className = 'notice warn'; clashBox.textContent = 'End time must be after the start time.'; return; }

    const hits = await API.checkClash(d.classroom_id, d.reservation_date, d.start_time, d.end_time);
    if (!clashBox.isConnected) return;   // the rep already left this screen
    if (!hits.length) {
      slotFree = true;
      clashBox.className = 'notice ok';
      clashBox.innerHTML = '<strong>No clashes.</strong> Not on the timetable and no other booking in this slot.';
    } else {
      clashBox.className = 'notice warn';
      clashBox.innerHTML = `<strong>This slot is taken.</strong><ul>${hits.map((h) => `<li>${t12(h.start)} – ${t12(h.end)}: ${esc(h.label)}</li>`).join('')}</ul>
        <a href="#/halls" id="find-free">Find halls that are free at this time</a>`;
      $('#find-free').addEventListener('click', () => Object.assign(state.filters, { date: d.reservation_date, start: d.start_time, end: d.end_time }));
    }
  }
  form.addEventListener('input', () => { error.hidden = true; check(); });

  // ---------- validate and submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await check();
    const d = formData(form);
    const hall = classrooms.find((c) => String(c.id) === d.classroom_id);
    const fail = (msg) => { error.textContent = msg; error.hidden = false; };

    if (!d.purpose.trim()) return fail('Enter the purpose of the reservation.');
    if (!(Number(d.expected_attendance) > 0)) return fail('Enter the expected number of students.');
    if (Number(d.expected_attendance) > hall.capacity) return fail(`${hall.name} only seats ${hall.capacity}. Choose a bigger hall.`);
    if (d.reservation_date < API.today()) return fail('Choose today or a future date.');
    if (!slotFree) return fail('Fix the time clash before submitting.');

    $('#submit').disabled = true;
    try {
      await API.createReservation({
        classroom_id: d.classroom_id, course_id: d.course_id,
        reservation_date: d.reservation_date, start_time: d.start_time, end_time: d.end_time,
        purpose: d.purpose.trim(), expected_attendance: Number(d.expected_attendance),
      });
      toast('Request sent. Waiting for admin approval.');
      location.hash = '#/reservations';          // Module 3 shows it in the history
    } catch (err) { fail(err.message); $('#submit').disabled = false; }
  });
  check();
};
