/* =====================================================================
   MODULE 5 — Report timetable changes
   Screen: #/changes
   For the rep's own classes: cancelled, moved to another hall, or new time.
   ===================================================================== */
const TIMETABLE_CHANGE_TYPES = ['class_cancelled', 'venue_moved', 'time_changed'];

Screens.changes = async function timetableChangesView() {
  const [{ classrooms }, classes] = await Promise.all([API.getLookups(), API.listMyClasses()]);
  view.innerHTML = `
    <header class="page-head"><h1>Report a timetable change</h1><p>Tell the administrator when one of your classes is cancelled, moved or rescheduled.</p></header>
    <form id="report" class="card form" novalidate>
      <fieldset class="types"><legend>What changed?</legend>
        ${TIMETABLE_CHANGE_TYPES.map((t, i) => `<label class="pill"><input type="radio" name="type" value="${t}" ${i === 0 ? 'checked' : ''}><span>${REPORT_LABELS[t]}</span></label>`).join('')}
      </fieldset>
      <label>Class<select name="timetable_entry_id">
        ${options(classes, null, (c) => `${c.course.code} · ${DAYS[c.day_of_week]} ${t12(c.start_time)} · ${c.classroom.name}`)}</select></label>
      <label>Date affected<input type="date" name="affected_date" value="${API.today()}" min="${API.today()}" required></label>
      <label data-for="venue_moved">New hall<select name="proposed_classroom_id">${hallOptions(classrooms, null)}</select></label>
      <div class="cols" data-for="time_changed">
        <label>New start<input type="time" name="proposed_start_time" step="1800"></label>
        <label>New end<input type="time" name="proposed_end_time" step="1800"></label>
      </div>
      <label>Details (optional)<textarea name="details" rows="3" maxlength="500" placeholder="e.g. Lecturer is away, class will not hold."></textarea></label>
      <p class="muted small">Students in the course are notified once the administrator verifies your report.</p>
      <p id="error" class="error" role="alert" hidden></p>
      <button type="submit" class="btn primary">Send report</button>
    </form>
    <h2 class="section">My timetable reports</h2>
    <div id="reports" class="stack"></div>`;

  const form = $('#report'), error = $('#error');

  // "New hall" shows only for venue_moved; "New start/end" only for time_changed
  function toggle() {
    const type = formData(form).type;
    form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== type; });
    error.hidden = true;
  }
  form.addEventListener('change', toggle);

  async function drawReports() {
    const rows = (await API.listMyReports()).filter((r) => TIMETABLE_CHANGE_TYPES.includes(r.type));
    if (!$('#reports')) return;   // the rep already left this screen
    $('#reports').innerHTML = rows.length ? rows.map(reportCard).join('') : '<p class="empty">You have not reported any timetable changes.</p>';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const fail = (msg) => { error.textContent = msg; error.hidden = false; };
    const cls = classes.find((c) => String(c.id) === d.timetable_entry_id);

    if (!d.affected_date) return fail('Choose the date affected.');
    if (API.dayOfWeek(d.affected_date) !== cls.day_of_week) return fail(`${cls.course.code} meets on ${DAYS[cls.day_of_week]}s. Pick a ${DAYS[cls.day_of_week]}.`);

    const row = { type: d.type, timetable_entry_id: cls.id, classroom_id: null, affected_date: d.affected_date,
      proposed_classroom_id: null, proposed_start_time: null, proposed_end_time: null, details: d.details.trim() };

    if (d.type === 'venue_moved') {
      if (d.proposed_classroom_id === String(cls.classroom_id)) return fail('The new hall is the same as the current one.');
      row.proposed_classroom_id = d.proposed_classroom_id;
    }
    if (d.type === 'time_changed') {
      if (!d.proposed_start_time || !d.proposed_end_time) return fail('Enter the new start and end time.');
      if (d.proposed_end_time <= d.proposed_start_time) return fail('New end time must be after the new start time.');
      row.proposed_start_time = d.proposed_start_time; row.proposed_end_time = d.proposed_end_time;
    }

    await API.createChangeReport(row);
    toast('Report sent for verification.');
    form.reset(); toggle(); drawReports();
  });

  toggle(); drawReports();
};
