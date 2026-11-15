/* =====================================================================
   core.js — shared helpers used by every module
   Each module adds its screen(s) to the Screens object; router.js shows them.
   ===================================================================== */
const Screens = {};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

// Shared between screens: who is signed in, and what the rep last searched for
const state = {
  me: null,                                         // the signed-in user (set by router.js)
  filters: { date: API.today(), start: '10:00', end: '12:00', building: '', minCap: '', facility: '', q: '' },
  prefill: null,
};

// ---------- text / date helpers ----------
// esc() must wrap anything a user typed before it goes into innerHTML
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const t12 = (t) => { let [h, m] = t.split(':').map(Number); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fmtDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
const addHours = (t, n) => { const [h, m] = t.split(':').map(Number); return `${pad(Math.min(h + n, 23))}:${pad(m)}`; };
const formData = (form) => Object.fromEntries(new FormData(form));

// ---------- small UI builders ----------
const options = (list, selected, label) => list.map((x) => `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');

// Hall dropdown grouped by building (94 halls is too long for a flat list)
function hallOptions(classrooms, selected) {
  const groups = {};
  for (const c of classrooms) (groups[c.building.name] ||= []).push(c);
  return Object.entries(groups).map(([name, rooms]) =>
    `<optgroup label="${esc(name)}">${options(rooms, selected, (c) => `${c.name} (${c.capacity} seats)`)}</optgroup>`).join('');
}

// Room card drawn as a door plate: status strip, big room number, when it frees up
const clockTimes = (s) => s.replace(/\b(\d\d:\d\d)\b/g, (t) => t12(t));
function roomPlate(h) {
  const m = h.name.match(/^(.*)\s(\S+)$/);                 // "NLT 12" → code "NLT", number "12"
  const code = m ? m[1] : '', no = m ? m[2] : h.name;
  const extras = h.facilities.length ? `, ${h.facilities.join(', ').toLowerCase()}` : '';
  return `
    <a class="plate ${h.is_free ? 'free' : 'busy'}" href="#/hall/${h.id}">
      <span class="plate-status">${h.is_free ? 'Free' : 'In use'}</span>
      <h2><span class="plate-code">${esc(code)}</span> <span class="plate-no">${esc(no)}</span></h2>
      <p class="hint">${esc(clockTimes(h.hint.replace(/^In use: /, '')))}</p>
      <p class="plate-meta">${h.capacity} seats${esc(extras)}</p>
    </a>`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- change reports: shared by modules 5 and 6 ----------
const REPORT_LABELS = {
  class_cancelled: 'Class cancelled', venue_moved: 'Venue moved', time_changed: 'Time changed',
  hall_in_use: 'Hall is in use', hall_free: 'Hall is free',
};

function reportCard(r) {
  const extra = r.type === 'venue_moved' ? ` → ${esc(r.proposed_classroom.name)}`
    : r.type === 'time_changed' ? ` → ${t12(r.proposed_start_time)} – ${t12(r.proposed_end_time)}` : '';
  return `<article class="card res">
    <div class="row between"><h2>${REPORT_LABELS[r.type]}${extra}</h2>${statusChip(r.status)}</div>
    <p>${r.course ? `${esc(r.course.code)} · ` : ''}${esc(r.classroom.name)} · ${fmtDate(r.affected_date)}</p>
    ${r.details ? `<p class="muted">${esc(r.details)}</p>` : ''}
  </article>`;
}

// ---------- helpers for the admin screens ----------
const fmtDateTime = (isoString) => new Date(isoString).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

// A group of tick boxes: checks('facility_ids', facilities, [1, 4], (f) => f.name)
const checks = (name, list, selected, label) => list.map((x) => `
  <label class="check"><input type="checkbox" name="${name}" value="${x.id}" ${selected.map(String).includes(String(x.id)) ? 'checked' : ''}>${esc(label(x))}</label>`).join('');

// Show / hide the error line of a form (every form has <p id="error">)
const showError = (msg) => { const el = $('#error'); el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'nearest' }); };
const clearError = () => { const el = $('#error'); if (el) el.hidden = true; };

// Destructive buttons need two taps: the first asks, the second does it.
function confirmTap(btn) {
  if (btn.dataset.sure) return true;
  const label = btn.textContent;
  btn.dataset.sure = '1'; btn.textContent = 'Tap again to confirm'; btn.classList.add('danger');
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = label; btn.classList.remove('danger'); } }, 4000);
  return false;
}

// Filter tabs: tabsHtml(['pending', 'approved'], 'pending') + onTabs((value) => ...)
const tabsHtml = (values, current, labels = {}) => `<div class="tabs" role="group" aria-label="Filter">${values.map((v) =>
  `<button type="button" data-tab="${v}" aria-pressed="${v === current}">${esc(labels[v] || v.replace(/_/g, ' '))}</button>`).join('')}</div>`;
function onTabs(handler) {
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    handler(b.dataset.tab);
  });
}
