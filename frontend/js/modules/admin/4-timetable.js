/* =====================================================================
   ADMIN MODULE 4 — Upload and update official timetables
   Screen: #/timetable
     A. Upload a CSV file (add to, or replace, the current timetable)
     B. Add or edit one class by hand
     C. The timetable, one day at a time
   ===================================================================== */
const TIMETABLE_TEMPLATE = [
  'course_code,course_title,room,day,start,end,lecturer',
  'CSC 301,Operating Systems,NLT 1,Monday,08:00,10:00,Dr. A. Mensah',
  'MAT 204,Linear Algebra,LT 3,Tuesday,13:00,15:00,',
].join('\n');

// Turn CSV text into rows of objects keyed by the header line. Handles "quoted, values".
function parseCsv(text) {
  const lines = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some((c) => c.trim())) lines.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim())) lines.push(row);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  return { headers, rows: lines.slice(1).map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] || '').trim()]))) };
}

Screens.timetable = async function timetableView() {
  const { classrooms, courses } = await API.getLookups();
  let day = 1, entries = [];

  view.innerHTML = `
    <header class="page-head"><h1>Timetable</h1><p>The official weekly timetable. Rooms show as in use during these classes.</p></header>

    <!-- A. upload -->
    <form id="upload" class="card form" novalidate>
      <h2>Upload a timetable file</h2>
      <p class="muted small">A CSV file with the columns course_code, course_title, room, day, start, end, lecturer. Excel can save a sheet as CSV.</p>
      <label>CSV file<input type="file" name="file" accept=".csv,text/csv"></label>
      <label class="check"><input type="checkbox" name="replace">Replace the whole current timetable (otherwise the classes are added to it)</label>
      <p id="up-error" class="error" role="alert" hidden></p>
      <div class="row wrap">
        <button type="submit" class="btn primary">Upload</button>
        <a class="btn" download="timetable-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(TIMETABLE_TEMPLATE)}">Download a template</a>
      </div>
      <div id="up-result" aria-live="polite"></div>
    </form>

    <!-- B. one class -->
    <h2 class="section" id="form-title">Add a class</h2>
    <form id="entry" class="card form" novalidate>
      <input type="hidden" name="id">
      <div class="cols">
        <label>Course<select name="course_id">${options(courses, null, (c) => `${c.code} · ${c.title}`)}</select></label>
        <label>Room<select name="classroom_id">${hallOptions(classrooms, null)}</select></label>
      </div>
      <div class="cols">
        <label>Day<select name="day_of_week">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}">${DAYS[d]}</option>`).join('')}</select></label>
        <label>From<input type="time" name="start_time" step="1800" required></label>
        <label>To<input type="time" name="end_time" step="1800" required></label>
      </div>
      <label>Lecturer (optional)<input type="text" name="lecturer_name"></label>
      <p id="error" class="error" role="alert" hidden></p>
      <div class="row wrap">
        <button type="submit" class="btn primary">Save class</button>
        <button type="button" class="btn" id="cancel" hidden>Cancel edit</button>
      </div>
    </form>

    <!-- C. the timetable -->
    <h2 class="section">Classes</h2>
    ${tabsHtml(['1', '2', '3', '4', '5', '6', '7'], '1', { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' })}
    <p id="summary" class="muted"></p>
    <div class="card table-wrap"><table>
      <thead><tr><th>Time</th><th>Course</th><th>Room</th><th>Lecturer</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const upload = $('#upload'), form = $('#entry');

  async function draw() {
    entries = await API.listTimetable();
    if (!$('#rows')) return;   // the admin already left this screen
    const list = entries.filter((t) => t.day_of_week === day);
    $('#summary').textContent = `${list.length} class${list.length === 1 ? '' : 'es'} on ${DAYS[day]}, ${entries.length} in the whole week`;
    $('#rows').innerHTML = list.length ? list.map((t) => `
      <tr>
        <td class="nowrap">${t12(t.start_time)} – ${t12(t.end_time)}</td>
        <td><strong>${esc(t.course ? t.course.code : '')}</strong> ${esc(t.course ? t.course.title : '')}</td>
        <td>${esc(t.classroom.name)}</td>
        <td>${esc(t.lecturer_name || '')}</td>
        <td class="actions">
          <button type="button" class="btn sm" data-act="edit" data-id="${t.id}">Edit</button>
          <button type="button" class="btn sm" data-act="remove" data-id="${t.id}">Remove</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="5" class="muted">No classes on ${DAYS[day]}.</td></tr>`;
  }

  // ---------- A. upload ----------
  upload.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('#up-error'), result = $('#up-result');
    const stop = (msg) => { error.textContent = msg; error.hidden = false; };
    error.hidden = true; result.innerHTML = '';

    const file = upload.file.files[0];
    if (!file) return stop('Choose a CSV file first.');
    const { headers, rows } = parseCsv(await file.text());
    const missing = ['course_code', 'room', 'day', 'start', 'end'].filter((h) => !headers.includes(h));
    if (missing.length) return stop(`The file is missing these columns: ${missing.join(', ')}. Download the template to see the layout.`);
    if (!rows.length) return stop('The file has a header line but no classes.');

    try {
      const out = await API.importTimetable({ rows, replace: upload.replace.checked });
      result.innerHTML = `
        <div class="notice ${out.imported ? 'ok' : 'warn'}"><strong>${out.imported} class${out.imported === 1 ? '' : 'es'} imported.</strong>
          ${out.imported ? '' : ' Nothing was changed.'}</div>
        ${out.skipped.length ? `<div class="notice warn"><strong>${out.skipped.length} row${out.skipped.length === 1 ? '' : 's'} skipped:</strong>
          <ul>${out.skipped.slice(0, 20).map((s) => `<li>Line ${s.line}: ${esc(s.reason)}</li>`).join('')}</ul>
          ${out.skipped.length > 20 ? `<p>and ${out.skipped.length - 20} more.</p>` : ''}</div>` : ''}`;
      upload.reset(); draw();
    } catch (err) { stop(err.message); }
  });

  // ---------- B. one class ----------
  function fill(t) {
    form.reset(); clearError();
    form.elements.id.value = t ? t.id : '';
    form.day_of_week.value = t ? t.day_of_week : day;
    if (t) {
      form.course_id.value = t.course_id; form.classroom_id.value = t.classroom_id;
      form.start_time.value = t.start_time; form.end_time.value = t.end_time; form.lecturer_name.value = t.lecturer_name || '';
    }
    $('#form-title').textContent = t ? `Edit ${t.course ? t.course.code : 'class'} on ${DAYS[t.day_of_week]}` : 'Add a class';
    $('#cancel').hidden = !t;
  }
  form.addEventListener('input', clearError);
  $('#cancel').addEventListener('click', () => fill(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    try {
      await API.saveTimetableEntry(d);
      toast(d.id ? 'Class updated.' : 'Class added.');
      day = Number(d.day_of_week);
      document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === String(day)));
      fill(null); draw();
    } catch (err) { showError(err.message); }
  });

  // ---------- C. table ----------
  onTabs((value) => { day = Number(value); if (!form.elements.id.value) form.day_of_week.value = day; draw(); });

  $('#rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const t = entries.find((x) => String(x.id) === btn.dataset.id);
    if (btn.dataset.act === 'edit') { fill(t); $('#form-title').scrollIntoView({ behavior: 'smooth', block: 'start' }); form.course_id.focus(); return; }
    if (!confirmTap(btn)) return;
    try { await API.deleteTimetableEntry(t.id); toast('Class removed.'); draw(); } catch (err) { toast(err.message); }
  });

  fill(null); draw();
};
