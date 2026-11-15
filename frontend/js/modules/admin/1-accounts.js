/* =====================================================================
   ADMIN MODULE 1 — Manage student and course rep accounts
   Screen: #/accounts
   Add, edit, disable / enable and remove accounts. One form is used for
   both "add" and "edit": pressing Edit on a row loads it into the form.
   ===================================================================== */
Screens.accounts = async function accountsView() {
  const { courses } = await API.getLookups();
  let filter = 'all';
  let users = [];

  view.innerHTML = `
    <header class="page-head"><h1>Accounts</h1><p>Create and manage student, course rep and administrator accounts.</p></header>

    <form id="user-form" class="card form" novalidate>
      <h2 id="form-title">Add an account</h2>
      <input type="hidden" name="id">
      <div class="cols">
        <label>Full name<input type="text" name="full_name" required></label>
        <label>Email<input type="email" name="email" required></label>
      </div>
      <div class="cols">
        <label>Role<select name="role">
          <option value="student">Student</option><option value="course_rep">Course rep</option><option value="admin">Administrator</option>
        </select></label>
        <label>Index or staff number<input type="text" name="index_number"></label>
        <label><span id="pw-label">Password</span><input type="password" name="password" autocomplete="new-password"></label>
      </div>
      <fieldset class="checks" id="course-box"><legend>Courses (a rep can book and report only for these)</legend>
        ${checks('course_ids', courses, [], (c) => `${c.code} ${c.title}`)}
      </fieldset>
      <p id="error" class="error" role="alert" hidden></p>
      <div class="row wrap">
        <button type="submit" class="btn primary">Save account</button>
        <button type="button" class="btn" id="cancel" hidden>Cancel edit</button>
      </div>
    </form>

    <h2 class="section">All accounts</h2>
    ${tabsHtml(['all', 'student', 'course_rep', 'admin'], filter, { all: 'All', student: 'Students', course_rep: 'Course reps', admin: 'Administrators' })}
    <div class="card table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Courses</th><th>Status</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const form = $('#user-form');

  // ---------- table ----------
  async function draw() {
    users = await API.listUsers();
    if (!$('#rows')) return;   // the admin already left this screen
    const list = users.filter((u) => filter === 'all' || u.role === filter);
    $('#rows').innerHTML = list.length ? list.map((u) => `
      <tr>
        <td><strong>${esc(u.full_name)}</strong>${u.index_number ? `<br><span class="muted small">${esc(u.index_number)}</span>` : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${ROLE_NAMES[u.role]}</td>
        <td>${u.courses.map((c) => esc(c.code)).join(', ') || '<span class="muted">None</span>'}</td>
        <td><span class="chip ${u.is_active ? 'approved' : 'cancelled'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
        <td class="actions">
          <button type="button" class="btn sm" data-act="edit" data-id="${u.id}">Edit</button>
          <button type="button" class="btn sm" data-act="toggle" data-id="${u.id}">${u.is_active ? 'Disable' : 'Enable'}</button>
          <button type="button" class="btn sm" data-act="remove" data-id="${u.id}">Remove</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No accounts in this group.</td></tr>';
  }

  // ---------- form: add or edit ----------
  function fill(u) {
    form.reset(); clearError();
    form.elements.id.value = u ? u.id : '';
    if (u) {
      form.full_name.value = u.full_name; form.email.value = u.email; form.role.value = u.role; form.index_number.value = u.index_number || '';
      form.querySelectorAll('[name=course_ids]').forEach((box) => { box.checked = u.course_ids.map(String).includes(box.value); });
    }
    $('#form-title').textContent = u ? `Edit ${u.full_name}` : 'Add an account';
    $('#pw-label').textContent = u ? 'New password (leave blank to keep)' : 'Password';
    $('#cancel').hidden = !u;
    $('#course-box').hidden = form.role.value === 'admin';
  }
  form.role.addEventListener('change', () => { $('#course-box').hidden = form.role.value === 'admin'; });
  form.addEventListener('input', clearError);
  $('#cancel').addEventListener('click', () => fill(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    d.course_ids = new FormData(form).getAll('course_ids');     // every ticked course, not just the last
    try {
      await API.saveUser(d);
      toast(d.id ? 'Account updated.' : 'Account created.');
      fill(null); draw();
    } catch (err) { showError(err.message); }
  });

  // ---------- row buttons ----------
  $('#rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const u = users.find((x) => String(x.id) === btn.dataset.id);
    try {
      if (btn.dataset.act === 'edit') { fill(u); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.full_name.focus(); return; }
      if (btn.dataset.act === 'toggle') { await API.setUserActive(u.id, !u.is_active); toast(u.is_active ? 'Account disabled.' : 'Account enabled.'); }
      if (btn.dataset.act === 'remove') { if (!confirmTap(btn)) return; await API.deleteUser(u.id); toast('Account removed.'); }
      draw();
    } catch (err) { toast(err.message); }
  });

  onTabs((value) => { filter = value; draw(); });
  fill(null); draw();
};
