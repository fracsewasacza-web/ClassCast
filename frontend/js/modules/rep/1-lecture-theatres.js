/* =====================================================================
   MODULE 1 (part A) — Browse by lecture theatre
     #/theatres      the five lecture theatres, with how many rooms are free
     #/theatre/:id   every room in one theatre, marked Free or In use
   Clicking a room opens its details page (#/hall/:id in 1-student-features.js).
   The search-everything screen (#/halls) is still there, linked from this page.
   ===================================================================== */

// Date + time controls shared by both screens. They read and write state.filters,
// so the slot you pick here carries over to the room page and the request form.
function slotControls() {
  const f = state.filters;
  return `
    <form id="slot" class="card filters">
      <label>Date<input type="date" name="date" value="${f.date}" required></label>
      <label>From<input type="time" name="start" value="${f.start}" step="1800" required></label>
      <label>To<input type="time" name="end" value="${f.end}" step="1800" required></label>
    </form>`;
}
function readSlot(form) {
  Object.assign(state.filters, formData(form));
  const { date, start, end } = state.filters;
  return Boolean(date && start && end && end > start);
}
const slotLabel = () => `${fmtDate(state.filters.date)}, ${t12(state.filters.start)} – ${t12(state.filters.end)}`;

// ---------- Screen 1: list of lecture theatres ----------
Screens.theatres = async function theatresView() {
  const { buildings } = await API.getLookups();
  view.innerHTML = `
    <header class="page-head row between wrap">
      <div><h1>Lecture theatres</h1><p>Pick a theatre to see which of its rooms are free.</p></div>
      <a class="btn" href="#/halls">Search all rooms</a>
    </header>
    ${slotControls()}
    <p id="summary" class="muted" aria-live="polite"></p>
    <div id="theatres" class="grid theatres"></div>`;

  const form = $('#slot');
  async function run() {
    if (!readSlot(form)) {
      $('#summary').textContent = 'Choose a date, and an end time after the start time.';
      $('#theatres').innerHTML = ''; return;
    }
    const { date, start, end } = state.filters;
    const rooms = await API.searchHalls({ date, start, end });      // all rooms, every building
    if (!$('#theatres')) return;   // the rep already left this screen

    $('#summary').textContent = `Showing availability for ${slotLabel()}`;
    $('#theatres').innerHTML = buildings.map((b) => {
      const mine = rooms.filter((r) => r.building_id === b.id);
      const free = mine.filter((r) => r.is_free).length;
      const pct = mine.length ? Math.round((free / mine.length) * 100) : 0;
      return `
        <a class="theatre" href="#/theatre/${b.id}">
          <span class="t-code">${esc(b.code)}</span>
          <h2>${esc(b.name)}</h2>
          <div class="avail" role="img" aria-label="${free} of ${mine.length} rooms free"><i style="width:${pct}%"></i></div>
          <p class="t-count"><strong>${free}</strong> of ${mine.length} rooms free, ${mine.length - free} in use</p>
        </a>`;
    }).join('');
  }
  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  run();
};

// ---------- Screen 2: rooms in one lecture theatre ----------
Screens.theatre = async function theatreView(id) {
  const { buildings } = await API.getLookups();
  const b = buildings.find((x) => String(x.id) === String(id));
  if (!b) { location.hash = '#/theatres'; return; }

  let show = 'all';                                                  // all | free | busy
  view.innerHTML = `
    <a class="back" href="#/theatres">← All lecture theatres</a>
    <header class="page-head"><h1>${esc(b.name)} (${esc(b.code)})</h1><p>Every room in this theatre. Tap a room for its timetable.</p></header>
    ${slotControls()}
    <div class="tabs" role="group" aria-label="Show rooms">
      <button type="button" data-show="all" aria-pressed="true">All rooms</button>
      <button type="button" data-show="free" aria-pressed="false">Free</button>
      <button type="button" data-show="busy" aria-pressed="false">In use</button>
    </div>
    <p id="summary" class="muted" aria-live="polite"></p>
    <div id="rooms" class="grid rooms"></div>`;

  const form = $('#slot');

  async function run() {
    if (!readSlot(form)) {
      $('#summary').textContent = 'Choose a date, and an end time after the start time.';
      $('#rooms').innerHTML = ''; return;
    }
    const { date, start, end } = state.filters;
    const rooms = await API.searchHalls({ date, start, end, building: b.id });
    if (!$('#rooms')) return;   // the rep already left this screen

    const free = rooms.filter((r) => r.is_free).length;
    $('#summary').textContent = `${free} of ${rooms.length} rooms free on ${slotLabel()}`;

    const list = rooms
      .filter((r) => show === 'all' || (show === 'free') === r.is_free)
      .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0));    // room order: 1, 2, 3 ...
    $('#rooms').innerHTML = list.length ? list.map(roomPlate).join('') : `<p class="empty">No rooms are ${show === 'free' ? 'free' : 'in use'} at this time.</p>`;
  }

  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  $('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    show = btn.dataset.show;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-pressed', x === btn));
    run();
  });
  run();
};
