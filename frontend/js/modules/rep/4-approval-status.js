/* =====================================================================
   MODULE 4 — Track reservation approval status
   Three parts:
     statusChip()     coloured label: pending / approved / rejected ...
     statusTracker()  3-step progress line shown on each reservation
     #/alerts screen  messages from the admin (the unread number is drawn by router.js)
   ===================================================================== */

// Coloured status label. Also used for change reports (modules 5 and 6).
function statusChip(status) {
  return `<span class="chip ${status}">${status.replace('_', ' ')}</span>`;
}

// Submitted → Admin review → Decision
function statusTracker(r) {
  if (r.status === 'cancelled') return '<ol class="steps"><li>Cancelled by you</li></ol>';
  const decided = r.status !== 'pending';
  return `
    <ol class="steps" aria-label="Approval progress">
      <li class="done">1. Submitted</li>
      <li class="${decided ? 'done' : 'now pending'}">2. ${decided ? 'Reviewed by admin' : 'Waiting for admin'}</li>
      <li class="${decided ? `now ${r.status}` : ''}">3. ${decided ? r.status[0].toUpperCase() + r.status.slice(1) : 'Decision'}</li>
    </ol>
    ${r.rejection_reason ? `<p class="reason">Reason: ${esc(r.rejection_reason)}</p>` : ''}`;
}

// Alerts screen: approvals, rejections and verified reports
Screens.alerts = async function alertsView() {
  const rows = await API.listNotifications();
  view.innerHTML = `
    <header class="page-head"><h1>Alerts</h1><p>Updates on your requests and reports.</p></header>
    <div class="stack">${rows.length ? rows.map((n) => `
      <article class="card res ${n.is_read ? '' : 'unread'}">
        <h2>${esc(n.title)}</h2><p>${esc(n.message)}</p><p class="muted small">${fmtDate(String(n.created_at).slice(0, 10))}</p>
      </article>`).join('') : '<p class="empty">Nothing yet.</p>'}</div>`;
  await API.markAllRead();
  refreshBadges();                                 // clears the number on the Alerts link
};
