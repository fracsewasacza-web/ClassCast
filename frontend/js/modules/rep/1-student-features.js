/* =====================================================================
   MODULE 1 — Everything a student can do
     1.1 Search available classrooms
     1.2 Check classroom timetables
     1.3 View building and room locations
     1.4 Check classroom capacity and facilities
     1.5 View availability for specific dates and times
   Screens: #/halls (search)  and  #/hall/:id (details)
   ===================================================================== */

// ---------- 1.1 + 1.5: search halls, free / in use for a date and time ----------
Screens.halls = async function hallsView() {
  const { buildings, facilities } = await API.getLookups();
  const f = state.filters;
  view.innerHTML = `
    <header class="page-head"><h1>Find a hall</h1><p>See which halls are free for the time you need.</p></header>
    <form id="filters" class="card filters">
      <label>Date<input type="date" name="date" value="${f.date}" required></label>
      <label>From<input type="time" name="start" value="${f.start}" step="1800" required></label>
      <label>To<input type="time" name="end" value="${f.end}" step="1800" required></label>
      <label>Building<select name="building"><option value="">All buildings</option>${options(buildings, f.building, (x) => `${x.name} (${x.code})`)}</select></label>
      <label>Min. seats<input type="number" name="minCap" value="${esc(f.minCap)}" min="1" placeholder="Any"></label>
      <label>Facility<select name="facility"><option value="">Any</option>${options(facilities, f.facility, (x) => x.name)}</select></label>
      <label class="grow">Search<input type="search" name="q" value="${esc(f.q)}" placeholder="Hall or building"></label>
    </form>
    <p id="summary" class="muted" aria-live="polite"></p>
    <div id="results" class="grid rooms"></div>`;

  const form = $('#filters');

  async function run() {
    Object.assign(state.filters, formData(form));
    const { date, start, end } = state.filters;
    if (!date || !start || !end || end <= start) {
      $('#summary').textContent = 'Choose a date, and an end time after the start time.';
      $('#results').innerHTML = ''; return;
    }
    const halls = await API.searchHalls(state.filters);
    if (!$('#results')) return;   // the rep already left this screen
    const free = halls.filter((h) => h.is_free).length;
    $('#summary').textContent = `${free} of ${halls.length} halls free on ${fmtDate(date)}, ${t12(start)} – ${t12(end)}`;
    $('#results').innerHTML = halls.length ? halls.map(roomPlate).join('') : '<p class="empty">No halls match these filters.</p>';
  }
  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  run();
};

// ---------- 1.2 + 1.3 + 1.4: one hall's timetable, location, capacity, facilities ----------
Screens.hall = async function hallView(id) {
  const hall = await API.getHall(id);
  view.innerHTML = `
    <a class="back" href="#/theatre/${hall.building_id}">← ${esc(hall.building.name)}</a>
    <header class="page-head"><h1>${esc(hall.name)}</h1></header>

    <!-- 1.4 capacity and facilities -->
    <div class="tags big"><span class="tag strong">${hall.capacity} seats</span>${hall.facilities.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>

    <!-- 1.3 location -->
    <section class="card loc">
      <div><h2>Location</h2>
        <p>${esc(hall.building.name)} (${esc(hall.building.code)})${hall.floor ? ` · ${esc(hall.floor)}` : ''}</p></div>
      <a class="btn" href="${esc(hall.building.map_url)}" target="_blank" rel="noopener">Open in Google Maps</a>
    </section>

    <!-- 1.2 timetable -->
    <section class="card">
      <div class="row between wrap">
        <h2>Timetable</h2>
        <label class="inline">Date <input type="date" id="day" value="${state.filters.date}"></label>
      </div>
      <ul id="schedule" class="schedule"></ul>
    </section>`;

  async function draw() {
    const date = $('#day').value || API.today();
    state.filters.date = date;
    const blocks = await API.getDaySchedule(id, date);
    if (!$('#schedule')) return;   // the rep already left this screen
    // Fill the gaps between bookings with "free" rows (07:00 – 19:00)
    const rows = []; let cur = '07:00';
    for (const b of blocks) {
      if (b.start > cur) rows.push({ free: true, start: cur, end: b.start });
      rows.push(b); if (b.end > cur) cur = b.end;
    }
    if (cur < '19:00') rows.push({ free: true, start: cur, end: '19:00' });

    $('#schedule').innerHTML = rows.map((r) => r.free
      ? `<li><span class="time">${t12(r.start)} – ${t12(r.end)}</span>
           <button type="button" class="slot free" data-start="${r.start}" data-end="${r.end}">Free · request this slot</button></li>`
      : `<li><span class="time">${t12(r.start)} – ${t12(r.end)}</span>
           <span class="slot ${r.kind === 'class' ? 'busy' : 'held'}">${esc(r.label)}</span></li>`).join('');
  }
  $('#day').addEventListener('change', draw);

  // Tapping a free slot hands the hall, date and time to Module 2 (request form)
  $('#schedule').addEventListener('click', (e) => {
    const btn = e.target.closest('button.slot'); if (!btn) return;
    const { start, end } = btn.dataset;
    const twoHours = addHours(start, 2);
    state.prefill = { classroom_id: id, date: state.filters.date, start, end: twoHours < end ? twoHours : end };
    location.hash = '#/reserve';
  });
  draw();
};
