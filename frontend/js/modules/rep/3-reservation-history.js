/* =====================================================================
   MODULE 3 — View reservation history
   Screen: #/reservations
   Lists every request the rep has made, filterable by status, with cancel.
   The status chip and progress tracker on each card come from Module 4.
   ===================================================================== */
Screens.reservations = async function reservationsView() {
  let filter = 'all';
  view.innerHTML = `
    <header class="page-head row between wrap">
      <div><h1>My reservations</h1><p>Every request you have made, newest date first.</p></div>
      <a class="btn primary" href="#/reserve">New request</a>
    </header>
    <div class="tabs" role="group" aria-label="Filter by status">
      ${['all', 'pending', 'approved', 'rejected', 'cancelled'].map((s) => `<button type="button" data-filter="${s}" aria-pressed="${s === 'all'}">${s}</button>`).join('')}
    </div>
    <div id="list" class="stack"></div>`;

  async function draw() {
    const all = await API.listMyReservations();
    if (!$('#list')) return;   // the rep already left this screen
    const rows = all.filter((r) => filter === 'all' || r.status === filter);
    $('#list').innerHTML = rows.length ? rows.map((r) => {
      const upcoming = r.reservation_date >= API.today();
      const canCancel = upcoming && (r.status === 'pending' || r.status === 'approved');
      return `
      <article class="card res">
        <div class="row between"><h2>${esc(r.classroom.name)}</h2>${statusChip(r.status)}</div>
        <p>${esc(r.course ? r.course.code : '')} · ${fmtDate(r.reservation_date)} · ${t12(r.start_time)} – ${t12(r.end_time)}</p>
        <p class="muted">${esc(r.purpose)} · ${r.expected_attendance} students</p>
        ${statusTracker(r)}
        ${canCancel ? `<button type="button" class="btn" data-cancel="${r.id}">Cancel booking</button>` : ''}
      </article>`;
    }).join('') : `<p class="empty">No ${filter === 'all' ? '' : filter} reservations yet.</p>`;
  }

  // Status filter tabs
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    draw();
  });

  // Cancel: first tap asks, second tap confirms
  $('#list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]'); if (!b) return;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to confirm'; b.classList.add('danger'); return; }
    await API.cancelReservation(b.dataset.cancel);
    toast('Booking cancelled. The hall is free again.');
    draw();
  });
  draw();
};
