/* =====================================================================
   ADMIN MODULE 4 — Upload and update official timetables
   Screen: #/timetable
     A. Upload a CSV file, or a photo of a printed timetable (Claude reads
        the photo; the admin checks the rows before anything is saved)
     B. Upload history: every upload, and taking one back off
     C. Add or edit one class by hand
     D. The timetable: the whole week or one day, with search
   ===================================================================== */
const TIMETABLE_TEMPLATE = [
  'course_code,course_title,room,day,start,end,lecturer',
  'CSC 301,Operating Systems,NLT 1,Monday,08:00,10:00,Dr. A. Mensah',
  'MAT 204,Linear Algebra,LT 3,Tuesday,13:00,15:00,',
].join('\n');
const SHORT_DAYS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

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
  const roomNames = new Set(classrooms.map((c) => c.name.toLowerCase()));
  let day = 'all', search = '', fromUpload = null, entries = [], uploads = [], review = null;

  view.innerHTML = `
    <header class="page-head"><h1>Timetable</h1><p>The official weekly timetable. Rooms show as in use during these classes.</p></header>

    <!-- A. upload -->
    <form id="upload" class="card form" novalidate>
      <h2>Upload a timetable</h2>
      <p class="muted small">A CSV file with the columns course_code, course_title, room, day, start, end, lecturer (Excel can save a sheet as CSV),
        or a photo or screenshot of a printed timetable. ClassCast reads a photo with Claude, and you check every class before it is saved.</p>
      <label>CSV file or timetable photo<input type="file" name="file" accept=".csv,text/csv,image/jpeg,image/png,image/webp"></label>
      <label class="check"><input type="checkbox" name="replace">Replace the whole current timetable (otherwise the classes are added to it)</label>
      <p id="up-error" class="error" role="alert" hidden></p>
      <p id="up-status" class="muted small" role="status" hidden></p>
      <div class="row wrap">
        <button type="submit" class="btn primary" id="up-submit">Upload</button>
        <a class="btn" download="timetable-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(TIMETABLE_TEMPLATE)}">Download a template</a>
      </div>
      <div id="up-result" aria-live="polite"></div>
    </form>

    <!-- A2. check what Claude read from a photo -->
    <section id="review" class="card form" hidden aria-labelledby="review-title"></section>

    <!-- B. upload history -->
    <h2 class="section">Uploads</h2>
    <div class="card table-wrap"><table>
      <thead><tr><th>File</th><th>Uploaded</th><th>Classes</th><th></th></tr></thead>
      <tbody id="uploads"></tbody>
    </table></div>

    <!-- C. one class -->
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

    <!-- D. the timetable -->
    <h2 class="section">Classes</h2>
    ${tabsHtml(['all', '1', '2', '3', '4', '5', '6', '7'], 'all', { all: 'All week', ...SHORT_DAYS })}
    <label class="search">Search<input type="search" id="search" placeholder="Course, room or lecturer"></label>
    <p id="from-upload" class="notice ok" hidden></p>
    <p id="summary" class="muted"></p>
    <div class="card table-wrap"><table>
      <thead id="head"></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <datalist id="room-names">${classrooms.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>`;

  const upload = $('#upload'), form = $('#entry');

  // ---------- D. the table ----------
  function matches(t) {
    if (day !== 'all' && t.day_of_week !== Number(day)) return false;
    if (fromUpload && t.import_id !== fromUpload.id) return false;
    if (!search) return true;
    const text = `${t.course ? `${t.course.code} ${t.course.title}` : ''} ${t.classroom.name} ${t.lecturer_name || ''}`.toLowerCase();
    return search.split(/\s+/).every((word) => text.includes(word));
  }

  function drawTable() {
    const list = entries.filter(matches);
    const all = day === 'all';
    $('#head').innerHTML = `<tr>${all ? '<th>Day</th>' : ''}<th>Time</th><th>Course</th><th>Room</th><th>Lecturer</th><th></th></tr>`;
    const perDay = [1, 2, 3, 4, 5, 6, 7].map((d) => entries.filter((t) => t.day_of_week === d).length);
    const where = all ? 'in the whole week' : `on ${DAYS[day]}`;
    $('#summary').textContent = (search || fromUpload)
      ? `${list.length} of ${entries.length} classes match`
      : `${list.length} class${list.length === 1 ? '' : 'es'} ${where}` + (all ? ` · ${perDay.map((n, i) => `${SHORT_DAYS[i + 1]} ${n}`).join(' · ')}` : `, ${entries.length} in the whole week`);
    $('#rows').innerHTML = list.length ? list.map((t) => `
      <tr>
        ${all ? `<td class="nowrap">${DAYS[t.day_of_week]}</td>` : ''}
        <td class="nowrap">${t12(t.start_time)} – ${t12(t.end_time)}</td>
        <td><strong>${esc(t.course ? t.course.code : '')}</strong> ${esc(t.course ? t.course.title : '')}</td>
        <td>${esc(t.classroom.name)}</td>
        <td>${esc(t.lecturer_name || '')}</td>
        <td class="actions">
          <button type="button" class="btn sm" data-act="edit" data-id="${t.id}">Edit</button>
          <button type="button" class="btn sm" data-act="remove" data-id="${t.id}">Remove</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="${all ? 6 : 5}" class="muted">${search || fromUpload ? 'No classes match.' : `No classes ${where}.`}</td></tr>`;

    const note = $('#from-upload');
    note.hidden = !fromUpload;
    if (fromUpload) note.innerHTML = `Showing only the classes from <strong>${esc(fromUpload.file_name)}</strong>. <button type="button" class="link-btn" id="show-all">Show every class</button>`;
  }

  // ---------- B. upload history ----------
  function drawUploads() {
    $('#uploads').innerHTML = uploads.length ? uploads.map((u) => `
      <tr>
        <td><strong>${esc(u.file_name)}</strong><br><span class="muted small">${u.source === 'image' ? 'Photo read by Claude' : 'CSV file'}${u.replace ? ' · replaced the timetable' : ''}</span></td>
        <td class="nowrap">${fmtDateTime(u.created_at)}<br><span class="muted small">${esc(u.uploaded_by_name || '')}</span></td>
        <td class="nowrap">${u.classes_now} on the timetable<br><span class="muted small">${u.imported} imported${u.skipped ? `, ${u.skipped} skipped` : ''}</span></td>
        <td class="actions">
          <button type="button" class="btn sm" data-up="show" data-id="${u.id}" ${u.classes_now ? '' : 'disabled'}>Show classes</button>
          <button type="button" class="btn sm" data-up="remove" data-id="${u.id}">Remove</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted">No uploads yet. Files and photos you upload are listed here.</td></tr>';
  }

  async function draw() {
    [entries, uploads] = await Promise.all([API.listTimetable(), API.listTimetableImports()]);
    if (!$('#rows')) return;   // the admin already left this screen
    if (fromUpload) fromUpload = uploads.find((u) => u.id === fromUpload.id) || null;
    drawTable(); drawUploads();
  }

  // ---------- A. upload ----------
  const upError = $('#up-error'), upStatus = $('#up-status'), upResult = $('#up-result');
  const stop = (msg) => { upError.textContent = msg; upError.hidden = false; };

  function showResult(out) {
    upResult.innerHTML = `
      <div class="notice ${out.imported ? 'ok' : 'warn'}"><strong>${out.imported} class${out.imported === 1 ? '' : 'es'} imported.</strong>
        ${out.imported ? '' : ' Nothing was changed.'}</div>
      ${out.skipped.length ? `<div class="notice warn"><strong>${out.skipped.length} row${out.skipped.length === 1 ? '' : 's'} skipped:</strong>
        <ul>${out.skipped.slice(0, 20).map((s) => `<li>${review ? 'Row' : 'Line'} ${review ? s.line - 1 : s.line}: ${esc(s.reason)}</li>`).join('')}</ul>
        ${out.skipped.length > 20 ? `<p>and ${out.skipped.length - 20} more.</p>` : ''}</div>` : ''}`;
  }

  upload.addEventListener('submit', async (e) => {
    e.preventDefault();
    upError.hidden = true; upResult.innerHTML = '';
    const file = upload.file.files[0];
    if (!file) return stop('Choose a CSV file or a timetable photo first.');

    if (file.type.startsWith('image/')) return readPhoto(file);

    const { headers, rows } = parseCsv(await file.text());
    const missing = ['course_code', 'room', 'day', 'start', 'end'].filter((h) => !headers.includes(h));
    if (missing.length) return stop(`The file is missing these columns: ${missing.join(', ')}. Download the template to see the layout.`);
    if (!rows.length) return stop('The file has a header line but no classes.');
    try {
      const out = await API.importTimetable({ rows, replace: upload.replace.checked, file_name: file.name, source: 'csv' });
      showResult(out); upload.reset(); draw();
    } catch (err) { stop(err.message); }
  });

  // ---------- A2. photo: Claude reads it, the admin checks the rows ----------
  async function readPhoto(file) {
    const btn = $('#up-submit');
    btn.disabled = true; btn.textContent = 'Reading…';
    upStatus.textContent = 'Claude is reading the timetable. This usually takes 20 to 60 seconds…'; upStatus.hidden = false;
    try {
      const out = await API.readTimetableImage(file);
      if (!out.rows.length) return stop(`No classes could be read from that image.${out.notes ? ` ${out.notes}` : ''} Try a sharper, straight-on photo.`);
      review = { file, notes: out.notes, rows: out.rows.map((r) => ({ ...r })) };
      drawReview();
      $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      stop(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Upload'; upStatus.hidden = true;
    }
  }

  // What is wrong with one row, by field (empty object = fine). Same rules as the server.
  const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
  function problems(r) {
    const p = {};
    if (!r.course_code.trim()) p.course_code = 'Course code is missing';
    if (!roomNames.has(r.room.trim().toLowerCase())) p.room = r.room.trim() ? `"${r.room}" is not a ClassCast hall` : 'Hall is missing';
    if (!Object.values(DAYS).some((d) => d && d.toLowerCase() === r.day.trim().toLowerCase())) p.day = 'Choose the day';
    if (!CLOCK.test(r.start.trim())) p.start = 'Start must look like 08:00';
    if (!CLOCK.test(r.end.trim())) p.end = 'End must look like 10:00';
    else if (!p.start && r.end.trim().padStart(5, '0') <= r.start.trim().padStart(5, '0')) p.end = 'End is not after the start';
    return p;
  }

  function drawReview() {
    const box = $('#review');
    if (!review) { box.hidden = true; box.innerHTML = ''; return; }
    const bad = review.rows.filter((r) => Object.keys(problems(r)).length).length;
    const cell = (i, key, r, p, extra = '') =>
      `<td><input name="${key}" data-row="${i}" value="${esc(r[key])}" ${extra} class="${p[key] ? 'bad' : ''}" aria-label="${key.replace('_', ' ')} ${i + 1}" ${p[key] ? `aria-invalid="true" title="${esc(p[key])}"` : ''}></td>`;
    box.hidden = false;
    box.innerHTML = `
      <h2 id="review-title">Check the classes Claude read</h2>
      <p class="muted small">From <strong>${esc(review.file.name)}</strong>. Claude can misread a photo, so compare each row with the timetable before importing.
        Fix a cell by typing in it; hover a red cell to see what is wrong.</p>
      ${review.notes ? `<p class="notice warn"><strong>Claude's note:</strong> ${esc(review.notes)}</p>` : ''}
      <div class="table-wrap review"><table>
        <thead><tr><th>Course code</th><th>Course title</th><th>Hall</th><th>Day</th><th>Start</th><th>End</th><th>Lecturer</th><th></th></tr></thead>
        <tbody>${review.rows.map((r, i) => { const p = problems(r); return `
          <tr>
            ${cell(i, 'course_code', r, p)}${cell(i, 'course_title', r, p)}${cell(i, 'room', r, p, 'list="room-names"')}
            <td><select name="day" data-row="${i}" class="${p.day ? 'bad' : ''}" aria-label="day ${i + 1}">
              <option value="">–</option>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option ${DAYS[d].toLowerCase() === r.day.trim().toLowerCase() ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select></td>
            ${cell(i, 'start', r, p, 'inputmode="numeric" placeholder="08:00"')}${cell(i, 'end', r, p, 'inputmode="numeric" placeholder="10:00"')}${cell(i, 'lecturer', r, p)}
            <td class="actions"><button type="button" class="btn sm" data-drop="${i}">Remove</button></td>
          </tr>`; }).join('')}</tbody>
      </table></div>
      <p class="${bad ? 'error' : 'muted small'}" id="review-count">${review.rows.length} class${review.rows.length === 1 ? '' : 'es'} read${bad ? `, ${bad} with something to fix. Rows still wrong when you import are skipped.` : ', all look complete.'}</p>
      <div class="row wrap">
        <button type="button" class="btn primary" id="review-import" ${review.rows.length ? '' : 'disabled'}>Import ${review.rows.length} class${review.rows.length === 1 ? '' : 'es'}</button>
        <button type="button" class="btn" id="review-discard">Discard</button>
      </div>`;
  }

  $('#review').addEventListener('input', (e) => {
    const el = e.target.closest('[data-row]'); if (!el) return;
    const r = review.rows[Number(el.dataset.row)];
    r[el.name] = el.value;
    // re-mark only this row's cells, so typing doesn't lose focus
    const p = problems(r), row = el.closest('tr');
    row.querySelectorAll('[data-row]').forEach((f) => {
      f.classList.toggle('bad', Boolean(p[f.name]));
      if (p[f.name]) { f.setAttribute('aria-invalid', 'true'); f.title = p[f.name]; } else { f.removeAttribute('aria-invalid'); f.removeAttribute('title'); }
    });
    const bad = review.rows.filter((x) => Object.keys(problems(x)).length).length;
    const count = $('#review-count');
    count.className = bad ? 'error' : 'muted small';
    count.textContent = `${review.rows.length} class${review.rows.length === 1 ? '' : 'es'} read${bad ? `, ${bad} with something to fix. Rows still wrong when you import are skipped.` : ', all look complete.'}`;
  });

  $('#review').addEventListener('click', async (e) => {
    const drop = e.target.closest('[data-drop]');
    if (drop) { review.rows.splice(Number(drop.dataset.drop), 1); drawReview(); return; }
    if (e.target.closest('#review-discard')) { review = null; drawReview(); upload.reset(); return; }
    const go = e.target.closest('#review-import'); if (!go) return;
    go.disabled = true;
    try {
      const out = await API.importTimetable({ rows: review.rows, replace: upload.replace.checked, file_name: review.file.name, source: 'image' });
      showResult(out);
      review = null; drawReview(); upload.reset(); draw();
      upload.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { go.disabled = false; toast(err.message); }
  });

  // ---------- B. upload history actions ----------
  $('#uploads').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-up]'); if (!btn) return;
    const u = uploads.find((x) => String(x.id) === btn.dataset.id);
    if (btn.dataset.up === 'show') {
      fromUpload = u; day = 'all'; search = ''; $('#search').value = '';
      document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === 'all'));
      drawTable(); $('#summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!confirmTap(btn)) return;
    try {
      await API.deleteTimetableImport(u.id);
      toast(`${u.file_name} removed: ${u.classes_now} class${u.classes_now === 1 ? '' : 'es'} taken off the timetable.`);
      if (fromUpload && fromUpload.id === u.id) fromUpload = null;
      draw();
    } catch (err) { toast(err.message); }
  });

  // ---------- C. one class ----------
  function fill(t) {
    form.reset(); clearError();
    form.elements.id.value = t ? t.id : '';
    form.day_of_week.value = t ? t.day_of_week : (day === 'all' ? 1 : day);
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
      if (day !== 'all') {
        day = Number(d.day_of_week);
        document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === String(day)));
      }
      fill(null); draw();
    } catch (err) { showError(err.message); }
  });

  // ---------- D. filters and row actions ----------
  onTabs((value) => { day = value === 'all' ? 'all' : Number(value); if (!form.elements.id.value && day !== 'all') form.day_of_week.value = day; drawTable(); });
  $('#search').addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); drawTable(); });
  $('#from-upload').addEventListener('click', (e) => { if (e.target.closest('#show-all')) { fromUpload = null; drawTable(); } });

  $('#rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const t = entries.find((x) => String(x.id) === btn.dataset.id);
    if (btn.dataset.act === 'edit') { fill(t); $('#form-title').scrollIntoView({ behavior: 'smooth', block: 'start' }); form.course_id.focus(); return; }
    if (!confirmTap(btn)) return;
    try { await API.deleteTimetableEntry(t.id); toast('Class removed.'); draw(); } catch (err) { toast(err.message); }
  });

  fill(null); draw();
};
