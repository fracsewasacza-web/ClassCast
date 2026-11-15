/* =====================================================================
   ADMIN MODULE 6 — Verify reported changes
   Screen: #/reports
   Course reps report cancelled / moved / rescheduled classes and wrong
   hall statuses. Verifying a class report updates that day's timetable
   and notifies everyone on the course.
   ===================================================================== */
Screens.reports = async function reportsView() {
  let filter = 'pending';

  // What will happen if the admin presses Verify
  const effect = (r) => ({
    class_cancelled: `${r.classroom.name} becomes free at that time on ${fmtDate(r.affected_date)}.`,
    venue_moved: `The class moves to ${r.proposed_classroom ? r.proposed_classroom.name : 'the new hall'} for ${fmtDate(r.affected_date)} only.`,
    time_changed: `The class time changes for ${fmtDate(r.affected_date)} only.`,
    hall_in_use: 'Recorded and the reporter is told. Check the room, then fix the timetable or bookings if needed.',
    hall_free: 'Recorded and the reporter is told. Check the room, then fix the timetable or bookings if needed.',
  }[r.type]);

  view.innerHTML = `
    <header class="page-head"><h1>Reported changes</h1><p>Check what course reps have reported, then verify or reject it.</p></header>
    ${tabsHtml(['pending', 'verified', 'rejected', 'all'], filter)}
    <div id="list" class="stack"></div>`;

  async function draw() {
    const all = await API.listAllReports();
    if (!$('#list')) return;   // the admin already left this screen
    const rows = all.filter((r) => filter === 'all' || r.status === filter);

    $('#list').innerHTML = rows.length ? rows.map((r) => {
      const change = r.type === 'venue_moved' && r.proposed_classroom ? `: to ${esc(r.proposed_classroom.name)}`
        : r.type === 'time_changed' ? `: to ${t12(r.proposed_start_time)} – ${t12(r.proposed_end_time)}` : '';
      const usual = r.entry ? `, usually ${t12(r.entry.start_time)} – ${t12(r.entry.end_time)} in ${esc(r.classroom.name)}` : '';
      return `
      <article class="card res" data-id="${r.id}">
        <div class="row between"><h2>${REPORT_LABELS[r.type]}${change}</h2>${statusChip(r.status)}</div>
        <p>${r.course ? `${esc(r.course.code)} ${esc(r.course.title)}${usual}` : esc(r.classroom.name)}</p>
        <p>Date affected: ${fmtDate(r.affected_date)}</p>
        <p class="muted">Reported by ${esc(r.reporter)}${r.details ? `: “${esc(r.details)}”` : ''}</p>
        ${r.status === 'pending' ? `
          <p class="muted small">If verified: ${esc(effect(r))}</p>
          <div class="row wrap">
            <button type="button" class="btn primary" data-act="verified">Verify</button>
            <button type="button" class="btn" data-act="rejected">Reject</button>
          </div>` : ''}
      </article>`;
    }).join('') : `<p class="empty">No ${filter === 'all' ? '' : filter} reports.</p>`;
  }

  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const decision = btn.dataset.act;
    if (decision === 'rejected' && !confirmTap(btn)) return;
    try {
      await API.reviewReport(btn.closest('[data-id]').dataset.id, decision);
      toast(decision === 'verified' ? 'Report verified. The people affected have been told.' : 'Report rejected. The reporter has been told.');
      refreshBadges(); draw();
    } catch (err) { toast(err.message); }
  });

  onTabs((value) => { filter = value; draw(); });
  draw();
};
