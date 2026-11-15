/* =====================================================================
   MODULE 6 — Submit classroom availability corrections
   Screen: #/corrections
   For any hall: the app says it is free but it is in use, or the reverse.
   ===================================================================== */
const CORRECTION_TYPES = ['hall_in_use', 'hall_free'];

Screens.corrections = async function correctionsView() {
  const { classrooms } = await API.getLookups();
  view.innerHTML = `
    <header class="page-head"><h1>Hall availability correction</h1><p>Tell the administrator when a hall's status in the app does not match what you see.</p></header>
    <form id="correction" class="card form" novalidate>
      <fieldset class="types"><legend>What is wrong?</legend>
        <label class="pill"><input type="radio" name="type" value="hall_in_use" checked><span>Shown free, but in use</span></label>
        <label class="pill"><input type="radio" name="type" value="hall_free"><span>Shown in use, but free</span></label>
      </fieldset>
      <label>Hall<select name="classroom_id">${hallOptions(classrooms, null)}</select></label>
      <label>Date<input type="date" name="affected_date" value="${API.today()}" required></label>
      <label>What did you see?<textarea name="details" rows="3" maxlength="500" placeholder="e.g. A study group has been using the hall since 10 AM."></textarea></label>
      <p id="error" class="error" role="alert" hidden></p>
      <button type="submit" class="btn primary">Send correction</button>
    </form>
    <h2 class="section">My corrections</h2>
    <div id="reports" class="stack"></div>`;

  const form = $('#correction'), error = $('#error');
  form.addEventListener('input', () => { error.hidden = true; });

  async function drawReports() {
    const rows = (await API.listMyReports()).filter((r) => CORRECTION_TYPES.includes(r.type));
    if (!$('#reports')) return;   // the rep already left this screen
    $('#reports').innerHTML = rows.length ? rows.map(reportCard).join('') : '<p class="empty">You have not sent any corrections.</p>';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const fail = (msg) => { error.textContent = msg; error.hidden = false; };

    if (!d.affected_date) return fail('Choose the date.');
    if (!d.details.trim()) return fail('Add a short note about what you saw.');

    await API.createChangeReport({
      type: d.type, timetable_entry_id: null, classroom_id: d.classroom_id, affected_date: d.affected_date,
      proposed_classroom_id: null, proposed_start_time: null, proposed_end_time: null, details: d.details.trim(),
    });
    toast('Correction sent for verification.');
    form.reset(); drawReports();
  });

  drawReports();
};
