/* =====================================================================
   router.js — decides what the signed-in person sees
     1. Nobody signed in      → login page
     2. Course rep signed in  → course rep UI   (js/modules/rep/)
     3. Admin signed in       → admin UI        (js/modules/admin/)
   Each role has its own menu below. A role can only open the screens
   listed in its menu, even if someone types another address by hand.
   Must be loaded last, after every module has added itself to Screens.
   ===================================================================== */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  calendarX: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M10 13l4 4M14 13l-4 4"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14 12h.01"/>',
  building: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
};

// label, address, the screens that count as "this menu item", icon, optional badge number
const NAV = {
  course_rep: [
    { label: 'Find a hall', href: '#/theatres', routes: ['theatres', 'theatre', 'hall', 'halls'], icon: 'search' },
    { label: 'Request', href: '#/reserve', routes: ['reserve'], icon: 'plus' },
    { label: 'My reservations', href: '#/reservations', routes: ['reservations'], icon: 'list' },
    { label: 'Report change', href: '#/changes', routes: ['changes'], icon: 'calendarX' },
    { label: 'Hall correction', href: '#/corrections', routes: ['corrections'], icon: 'flag' },
    { label: 'Alerts', href: '#/alerts', routes: ['alerts'], icon: 'bell', badge: () => API.unreadCount() },
  ],
  admin: [
    { label: 'Overview', href: '#/overview', routes: ['overview'], icon: 'chart' },
    { label: 'Requests', href: '#/requests', routes: ['requests'], icon: 'inbox', badge: async () => (await API.pendingCounts()).requests },
    { label: 'Reports', href: '#/reports', routes: ['reports'], icon: 'flag', badge: async () => (await API.pendingCounts()).reports },
    { label: 'Timetable', href: '#/timetable', routes: ['timetable'], icon: 'calendar' },
    { label: 'Rooms', href: '#/rooms', routes: ['rooms'], icon: 'door' },
    { label: 'Buildings', href: '#/buildings', routes: ['buildings'], icon: 'building' },
    { label: 'Accounts', href: '#/accounts', routes: ['accounts'], icon: 'users' },
  ],
};
const ROLE_NAMES = { course_rep: 'Course rep', admin: 'Administrator', student: 'Student' };

// ---------- sidebar: menu for this role + who is signed in ----------
function drawShell() {
  const me = state.me;
  document.body.classList.toggle('guest', !me);        // .guest hides the sidebar (see styles.css)
  if (!me) { $('#nav').innerHTML = ''; $('#me').innerHTML = ''; return; }

  $('#nav').innerHTML = NAV[me.role].map((item, i) => `
    <a href="${item.href}" data-nav="${i}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[item.icon]}</svg>
      <span>${item.label}</span>${item.badge ? '<span class="badge" hidden></span>' : ''}
    </a>`).join('');

  const detail = me.role === 'course_rep' && me.courses.length ? ` · ${me.courses.map((c) => esc(c.code)).join(', ')}` : '';
  $('#me').innerHTML = `
    <strong>${esc(me.full_name)}</strong><span>${ROLE_NAMES[me.role]}${detail}</span>
    <button type="button" class="logout" data-logout>Log out</button>`;
}

// Numbers on menu items (unread alerts, pending requests ...). Call after anything that changes them.
// Also runs by itself every CHECK_EVERY ms (see below), so new alerts appear without a page refresh.
let lastCounts = {};                               // label → number shown last time
async function refreshBadges({ announce = false } = {}) {
  if (!state.me) return;
  const items = NAV[state.me.role];
  const grew = [];
  for (let i = 0; i < items.length; i++) {
    if (!items[i].badge) continue;
    const n = Number(await items[i].badge()) || 0;
    const el = $(`#nav [data-nav="${i}"] .badge`);
    if (el) { el.hidden = !n; el.textContent = n; }
    if (n > (lastCounts[items[i].label] ?? n)) grew.push(items[i]);
    lastCounts[items[i].label] = n;
  }
  if (!announce || !grew.length) return;
  const current = location.hash.replace(/^#\/?/, '').split('/')[0];
  // Already reading the Alerts screen: redraw it with the new alert. (Other screens are not redrawn,
  // so an admin half-way through typing a rejection reason doesn't lose it — they get a message instead.)
  if (grew.some((item) => item.label === 'Alerts' && item.routes.includes(current))) { await router(); return; }
  toast(grew[0].label === 'Alerts' ? 'You have a new alert.' : `New item in ${grew[0].label}.`);
}

// Check for new alerts / requests every 20 seconds while the tab is open and visible,
// and straight away when the person comes back to the tab.
const CHECK_EVERY = 20000;
let checking = false;
async function checkForNews() {
  if (checking || !state.me || document.hidden) return;
  checking = true;
  try { await refreshBadges({ announce: true }); } catch { /* offline for a moment: try again next time */ }
  checking = false;
}
setInterval(checkForNews, CHECK_EVERY);
document.addEventListener('visibilitychange', checkForNews);

// ---------- show the screen for the current address ----------
async function router() {
  if (!state.me) { await Screens.login(); return; }

  const items = NAV[state.me.role];
  const allowed = items.flatMap((item) => item.routes);
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (!allowed.includes(name) || !Screens[name]) {       // unknown address, or another role's screen → home
    name = items[0].routes[0]; arg = undefined;
    history.replaceState(null, '', `#/${name}`);
  }

  items.forEach((item, i) => {
    const link = $(`#nav [data-nav="${i}"]`);
    if (item.routes.includes(name)) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });

  try {
    await Screens[name](arg);
  } catch (err) {
    showProblem(err);
  }
  view.focus({ preventScroll: true }); window.scrollTo(0, 0);
}

// A screen could not load (server stopped, no internet ...): say so instead of a blank page
function showProblem(err) {
  view.innerHTML = `
    <div class="card form">
      <h1>Something went wrong</h1>
      <p class="error">${esc(err.message)}</p>
      <div class="row wrap"><button type="button" class="btn primary" id="retry">Try again</button></div>
    </div>`;
  $('#retry').addEventListener('click', () => startSession());
}

// ---------- sign in / sign out ----------
// Called at start-up and by the login page after a successful sign-in
async function startSession() {
  try {
    state.me = await API.getMe();
  } catch (err) {
    state.me = null; drawShell(); showProblem(err); return;
  }
  lastCounts = {};
  drawShell();
  refreshBadges().catch(() => {});                 // a missing badge number is not worth an error
  await router();
}

async function signOut() {
  await API.logout();
  state.me = null; state.prefill = null;
  $('#toast').classList.remove('show');             // don't carry a message over to the next person
  history.replaceState(null, '', '#/login');
  drawShell();
  await router();
}

window.addEventListener('hashchange', router);
document.addEventListener('click', (e) => { if (e.target.closest('[data-logout]')) signOut(); });
startSession();
