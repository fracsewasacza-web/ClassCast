/* =====================================================================
   ADMIN MODULE 5 — Approve or reject reservation requests
   Screen: #/requests
   Each pending request shows whether the slot is still free. Rejecting
   needs a reason, which the course rep sees on their reservation.
   ===================================================================== */
Screens.requests = async function requestsView() {
  let filter = 'pending';

  view.innerHTML = `
    <header class="page-head"><h1>Reservation requests</h1><p>Approve or reject the halls course reps have asked for.</p></header>
    ${tabsHtml(['pending', 'approved', 'rejected', 'cancelled', 'all'], filter)}
    <div id="list" class="stack"></div>`;

  async function draw() {
    const all = await API.listAllReservations();
    if (!$('#list')) return;   // the admin already left this screen
    const rows = all.filter((r) => filter === 'all' || r.status === filter);

    $('#list').innerHTML = rows.length ? rows.map((r) => {
      const tooBig = r.expected_attendance > r.classroom.capacity;
      const check = r.status !== 'pending' ? ''
        : r.clashes.length
          ? `<div class="notice warn"><strong>The slot is no longer free:</strong> ${esc(r.clashes[0].label)}, ${t12(r.clashes[0].start)} – ${t12(r.clashes[0].end)}</div>`
          : '<div class="notice ok"><strong>No clashes.</strong> The room is free at this time.</div>';
      return `
      <article class="card res" data-id="${r.id}">
        <div class="row between"><h2>${esc(r.classroom.name)}</h2>${statusChip(r.status)}</div>
        <p>${fmtDate(r.reservation_date)}, ${t12(r.start_time)} – ${t12(r.end_time)}</p>
        <p class="muted">${esc(r.course ? r.course.code : 'No course')}: ${esc(r.purpose)}. Requested by ${esc(r.requester)}.</p>
        <p class="${tooBig ? 'reason' : 'muted'}">${r.expected_attendance} students expected, room seats ${r.classroom.capacity}${tooBig ? ' (too small)' : ''}</p>
        ${r.rejection_reason ? `<p class="reason">Reason: ${esc(r.rejection_reason)}</p>` : ''}
        ${check}
        ${r.status === 'pending' ? `
          <div class="row wrap">
            <button type="button" class="btn primary" data-act="approve" ${r.clashes.length ? 'disabled' : ''}>Approve</button>
            <button type="button" class="btn" data-act="reject">Reject</button>
          </div>
          <form class="reject-form" hidden>
            <label>Reason for rejecting<input type="text" name="reason" maxlength="255" placeholder="e.g. Hall is reserved for exams that week"></label>
            <p class="error" role="alert" hidden></p>
            <div class="row wrap"><button type="submit" class="btn danger">Confirm rejection</button><button type="button" class="btn" data-act="back">Back</button></div>
          </form>` : ''}
      </article>`;
    }).join('') : `<p class="empty">No ${filter === 'all' ? '' : filter} requests.</p>`;
  }

  const done = (msg) => { toast(msg); refreshBadges(); draw(); };

  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const card = btn.closest('[data-id]'), box = card.querySelector('.reject-form');
    if (btn.dataset.act === 'reject') { box.hidden = false; box.reason.focus(); return; }
    if (btn.dataset.act === 'back') { box.hidden = true; return; }
    try { await API.reviewReservation(card.dataset.id, 'approved'); done('Request approved. The course rep has been told.'); }
    catch (err) { toast(err.message); draw(); }
  });

  $('#list').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = e.target, error = box.querySelector('.error');
    try { await API.reviewReservation(box.closest('[data-id]').dataset.id, 'rejected', box.reason.value); done('Request rejected. The course rep has been told.'); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
  });

  onTabs((value) => { filter = value; draw(); });
  draw();
};
