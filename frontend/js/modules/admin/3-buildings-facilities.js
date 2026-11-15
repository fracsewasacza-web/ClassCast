/* =====================================================================
   ADMIN MODULE 3 — Manage buildings and classroom facilities
   Screen: #/buildings
   Two lists on one page: buildings (name + short code) and the facilities
   a room can have (projector, PA system ...).
   ===================================================================== */
Screens.buildings = async function buildingsView() {
  let buildings = [], facilities = [];

  view.innerHTML = `
    <header class="page-head"><h1>Buildings and facilities</h1><p>The lecture theatres on campus, and the equipment a room can have.</p></header>

    <div class="two-col">
      <!-- ---------- buildings ---------- -->
      <section>
        <h2 class="section first">Buildings</h2>
        <form id="b-form" class="card form" novalidate>
          <input type="hidden" name="id">
          <label>Building name<input type="text" name="name" placeholder="e.g. New Lecture Theatre" required></label>
          <label>Short code<input type="text" name="code" placeholder="e.g. NLT" maxlength="12" required></label>
          <p id="b-error" class="error" role="alert" hidden></p>
          <div class="row wrap">
            <button type="submit" class="btn primary" id="b-save">Add building</button>
            <button type="button" class="btn" id="b-cancel" hidden>Cancel edit</button>
          </div>
        </form>
        <div id="b-list" class="stack list-gap"></div>
      </section>

      <!-- ---------- facilities ---------- -->
      <section>
        <h2 class="section first">Facilities</h2>
        <form id="f-form" class="card form" novalidate>
          <input type="hidden" name="id">
          <label>Facility name<input type="text" name="name" placeholder="e.g. Smart board" required></label>
          <p id="f-error" class="error" role="alert" hidden></p>
          <div class="row wrap">
            <button type="submit" class="btn primary" id="f-save">Add facility</button>
            <button type="button" class="btn" id="f-cancel" hidden>Cancel edit</button>
          </div>
        </form>
        <div id="f-list" class="stack list-gap"></div>
      </section>
    </div>`;

  async function draw() {
    [buildings, { facilities }] = await Promise.all([API.listBuildings(), API.getLookups()]);
    if (!$('#b-list')) return;   // the admin already left this screen
    $('#b-list').innerHTML = buildings.map((b) => `
      <article class="card line">
        <div><h2>${esc(b.name)}</h2><p class="muted">${esc(b.code)} · ${b.rooms} room${b.rooms === 1 ? '' : 's'}</p></div>
        <div class="actions">
          <button type="button" class="btn sm" data-kind="b" data-act="edit" data-id="${b.id}">Edit</button>
          <button type="button" class="btn sm" data-kind="b" data-act="remove" data-id="${b.id}">Remove</button>
        </div>
      </article>`).join('') || '<p class="empty">No buildings yet.</p>';
    $('#f-list').innerHTML = facilities.map((f) => `
      <article class="card line">
        <h2>${esc(f.name)}</h2>
        <div class="actions">
          <button type="button" class="btn sm" data-kind="f" data-act="edit" data-id="${f.id}">Rename</button>
          <button type="button" class="btn sm" data-kind="f" data-act="remove" data-id="${f.id}">Remove</button>
        </div>
      </article>`).join('') || '<p class="empty">No facilities yet.</p>';
  }

  // The two forms work the same way, so one function sets either of them up
  function setUp(kind, noun, save) {
    const form = $(`#${kind}-form`), error = $(`#${kind}-error`);
    const fill = (item) => {
      form.reset(); error.hidden = true;
      form.elements.id.value = item ? item.id : '';
      if (item) { form.elements.name.value = item.name; if (form.code) form.code.value = item.code; }
      $(`#${kind}-save`).textContent = item ? `Save ${noun}` : `Add ${noun}`;
      $(`#${kind}-cancel`).hidden = !item;
    };
    form.addEventListener('input', () => { error.hidden = true; });
    $(`#${kind}-cancel`).addEventListener('click', () => fill(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form);
      try { await save(d); toast(`${noun[0].toUpperCase()}${noun.slice(1)} ${d.id ? 'updated' : 'added'}.`); fill(null); draw(); }
      catch (err) { error.textContent = err.message; error.hidden = false; }
    });
    return fill;
  }
  const fillBuilding = setUp('b', 'building', API.saveBuilding);
  const fillFacility = setUp('f', 'facility', API.saveFacility);

  view.querySelector('.two-col').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const isBuilding = btn.dataset.kind === 'b';
    const item = (isBuilding ? buildings : facilities).find((x) => String(x.id) === btn.dataset.id);
    if (btn.dataset.act === 'edit') {
      (isBuilding ? fillBuilding : fillFacility)(item);
      $(isBuilding ? '#b-form' : '#f-form').elements.name.focus();
      return;
    }
    if (!confirmTap(btn)) return;
    try {
      await (isBuilding ? API.deleteBuilding : API.deleteFacility)(item.id);
      toast(`${isBuilding ? 'Building' : 'Facility'} removed.`); draw();
    } catch (err) { toast(err.message); }
  });

  draw();
};
