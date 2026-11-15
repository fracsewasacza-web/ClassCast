/* =====================================================================
   ADMIN MODULE 7 — Monitor classroom usage and system activities
   Screen: #/overview  (the administrator's home page)
     - what is waiting for the admin
     - how heavily each building and room is used
     - a log of who did what
   ===================================================================== */
Screens.overview = async function overviewView() {
  const o = await API.getOverview();

  // One bar per item; the longest bar belongs to the highest number of hours
  const bars = (items, label) => {
    const max = Math.max(...items.map((x) => x.hours), 1);
    return items.map((x) => `
      <div class="bar-row">
        <span class="bar-label">${esc(label(x))}</span>
        <div class="bar" role="img" aria-label="${x.hours} hours"><i style="width:${Math.round((x.hours / max) * 100)}%"></i></div>
        <span class="bar-value">${x.hours} h</span>
      </div>`).join('');
  };

  view.innerHTML = `
    <header class="page-head"><h1>Overview</h1><p>What needs your attention, and how the halls are being used.</p></header>

    <div class="stats">
      <a class="stat ${o.pending_requests ? 'alert' : ''}" href="#/requests"><strong>${o.pending_requests}</strong><span>Reservation request${o.pending_requests === 1 ? '' : 's'} waiting</span></a>
      <a class="stat ${o.pending_reports ? 'alert' : ''}" href="#/reports"><strong>${o.pending_reports}</strong><span>Reported change${o.pending_reports === 1 ? '' : 's'} to verify</span></a>
      <a class="stat" href="#/rooms"><strong>${o.rooms_active}</strong><span>Rooms open, of ${o.rooms_total}</span></a>
      <a class="stat" href="#/timetable"><strong>${o.classes}</strong><span>Classes on the weekly timetable</span></a>
      <a class="stat" href="#/accounts"><strong>${o.accounts}</strong><span>Active accounts</span></a>
    </div>

    <div class="two-col">
      <section class="card">
        <h2>Hours in use, by building</h2>
        <p class="muted small">Weekly timetabled hours plus approved bookings.</p>
        <div class="bars">${bars(o.buildings, (b) => b.code)}</div>
      </section>
      <section class="card">
        <h2>Busiest rooms</h2>
        <p class="muted small">Rooms with the most hours in use.</p>
        <div class="bars">${o.top_rooms.length ? bars(o.top_rooms, (r) => r.name) : '<p class="muted">No room has been used yet.</p>'}</div>
      </section>
    </div>

    <h2 class="section">Recent activity</h2>
    <div class="card table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>What happened</th></tr></thead>
      <tbody>${o.activity.map((a) => `
        <tr><td class="nowrap">${fmtDateTime(a.created_at)}</td><td class="nowrap">${esc(a.user)}</td><td>${esc(a.text)}</td></tr>`).join('')
        || '<tr><td colspan="3" class="muted">Nothing has happened yet.</td></tr>'}</tbody>
    </table></div>`;
};
