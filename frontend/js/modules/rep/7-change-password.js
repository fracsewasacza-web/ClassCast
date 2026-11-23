/* =====================================================================
   MODULE 7 — Change my password
   Screen: #/password
   The rep types the current password (Firebase checks it again) and the
   new one twice. Nothing goes to the ClassCast server: Firebase holds passwords.
   ===================================================================== */
const MIN_PASSWORD = 6;                                // the same minimum the administrator's Accounts screen uses

Screens.password = async function passwordView() {
  view.innerHTML = `
    <header class="page-head"><h1>Change password</h1><p>Type your current password, then the new one twice. You stay signed in.</p></header>
    <form id="password" class="card form" novalidate>
      <label>Current password<input type="password" name="current" autocomplete="current-password" required></label>
      <label>New password<input type="password" name="next" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
        <span class="muted">At least ${MIN_PASSWORD} characters.</span></label>
      <label>New password again<input type="password" name="again" autocomplete="new-password" required></label>
      <label class="check"><input type="checkbox" id="show">Show passwords</label>
      <p id="error" class="error" role="alert" hidden></p>
      <button type="submit" class="btn primary" id="save">Change password</button>
    </form>`;

  const form = $('#password'), save = $('#save');
  form.addEventListener('input', clearError);
  $('#show').addEventListener('change', (e) => {
    form.querySelectorAll('input[name]').forEach((input) => { input.type = e.target.checked ? 'text' : 'password'; });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { current, next, again } = formData(form);
    if (!current) return showError('Type your current password.');
    if (next.length < MIN_PASSWORD) return showError(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next === current) return showError('The new password must be different from the current one.');
    if (next !== again) return showError('The two new passwords do not match.');

    save.disabled = true; save.textContent = 'Saving…';
    try {
      await API.changePassword(current, next);
      form.reset(); $('#show').dispatchEvent(new Event('change'));
      toast('Password changed. Use the new one next time you log in.');
    } catch (err) {
      showError(err.message);
    } finally {
      save.disabled = false; save.textContent = 'Change password';
    }
  });
};
