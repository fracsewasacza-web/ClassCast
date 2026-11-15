/* =====================================================================
   ADMIN MODULE 2 — Add, edit and remove classrooms
   Screen: #/rooms
   The table shows one building at a time (there are 94 rooms).
   A disabled room stays in the records but is hidden from course reps.
   ===================================================================== */
Screens.rooms = async function roomsView() {
  let { buildings, facilities } = await API.getLookups();
  let building = buildings.length ? String(buildings[0].id) : '';
  let rooms = [];

  view.innerHTML = `
    <header class="page-head"><h1>Rooms</h1><p>Add rooms, and keep their seat counts and facilities correct.</p></header>

    <form id="room-form" class="card form" novalidate>
      <h2 id="form-title">Add a room</h2>
      <input type="hidden" name="id">
      <div class="cols">
        <label>Room name<input type="text" name="name" placeholder="e.g. NLT 20" required></label>
        <label>Building<select name="building_id">${options(buildings, building, (b) => `${b.name} (${b.code})`)}</select></label>
      </div>
      <div class="cols">
        <label>Seats<input type="number" name="capacity" min="1" required></label>
        <label>Floor (optional)<input type="text" name="floor" placeholder="e.g. Ground floor"></label>
      </div>
      <fieldset class="checks"><legend>Facilities</legend>${checks('facility_ids', facilities, [], (f) => f.name)}</fieldset>
      <label class="check"><input type="checkbox" name="is_active" checked>Open for use (untick to hide the room from course reps)</label>
      <p id="error" class="error" role="alert" hidden></p>
      <div class="row wrap">
        <button type="submit" class="btn primary">Save room</button>
        <button type="button" class="btn" id="cancel" hidden>Cancel edit</button>
      </div>
    </form>

    <div class="row between wrap section-row">
      <h2 class="section">Rooms by building</h2>
      <label class="inline">Building <select id="pick">${options(buildings, building, (b) => b.name)}</select></label>
    </div>
    <p id="summary" class="muted"></p>
    <div class="card table-wrap"><table>
      <thead><tr><th>Room</th><th>Seats</th><th>Floor</th><th>Facilities</th><th>Status</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const form = $('#room-form');

  async function draw() {
    rooms = await API.listClassrooms();
    if (!$('#rows')) return;   // the admin already left this screen
    const list = rooms.filter((r) => String(r.building_id) === building);
    $('#summary').textContent = `${list.length} room${list.length === 1 ? '' : 's'}, ${list.filter((r) => r.is_active).length} open for use`;
    $('#rows').innerHTML = list.length ? list.map((r) => `
      <tr>
        <td><strong>${esc(r.name)}</strong></td>
        <td>${r.capacity}</td>
        <td>${esc(r.floor || '')}</td>
        <td>${r.facilities.map(esc).join(', ') || '<span class="muted">None</span>'}</td>
        <td><span class="chip ${r.is_active ? 'approved' : 'cancelled'}">${r.is_active ? 'Open' : 'Disabled'}</span></td>
        <td class="actions">
          <button type="button" class="btn sm" data-act="edit" data-id="${r.id}">Edit</button>
          <button type="button" class="btn sm" data-act="remove" data-id="${r.id}">Remove</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">This building has no rooms yet.</td></tr>';
  }

  function fill(r) {
    form.reset(); clearError();
    form.elements.id.value = r ? r.id : '';
    form.building_id.value = r ? r.building_id : building;
    if (r) {
      form.elements.name.value = r.name; form.capacity.value = r.capacity; form.floor.value = r.floor || ''; form.is_active.checked = r.is_active;
      form.querySelectorAll('[name=facility_ids]').forEach((box) => { box.checked = r.facility_ids.map(String).includes(box.value); });
    }
    $('#form-title').textContent = r ? `Edit ${r.name}` : 'Add a room';
    $('#cancel').hidden = !r;
  }
  form.addEventListener('input', clearError);
  $('#cancel').addEventListener('click', () => fill(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    d.facility_ids = new FormData(form).getAll('facility_ids');
    d.is_active = form.is_active.checked;
    try {
      await API.saveClassroom(d);
      toast(d.id ? 'Room updated.' : 'Room added.');
      building = String(d.building_id); $('#pick').value = building;   // show the building the room is in
      fill(null); draw();
    } catch (err) { showError(err.message); }
  });

  $('#pick').addEventListener('change', (e) => { building = e.target.value; if (!form.elements.id.value) form.building_id.value = building; draw(); });

  $('#rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const r = rooms.find((x) => String(x.id) === btn.dataset.id);
    if (btn.dataset.act === 'edit') { fill(r); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.name.focus(); return; }
    if (!confirmTap(btn)) return;
    try { await API.deleteClassroom(r.id); toast('Room removed.'); draw(); } catch (err) { toast(err.message); }
  });

  fill(null); draw();
};
