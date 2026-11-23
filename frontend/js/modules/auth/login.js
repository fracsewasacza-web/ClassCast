/* =====================================================================
   LOGIN PAGE
   Shown by router.js whenever nobody is signed in.
   After a correct email + password, router.js sends the person to the
   UI for their role:  course rep → Find a hall,  administrator → Overview.
   ===================================================================== */
Screens.login = async function loginView() {
  view.innerHTML = `
    <div class="login">
      <section class="login-art">
        <p class="login-brand">ClassCast</p>
        <div>
          <h1>Find a free hall. Book it in seconds.</h1>
          <p class="login-sub">Live lecture hall availability and booking for the University of Cape Coast.</p>
        </div>
        <div class="login-plates" aria-hidden="true">
          <div class="plate free"><span class="plate-status">Free</span><h2><span class="plate-code">NLT</span> <span class="plate-no">4</span></h2></div>
          <div class="plate busy"><span class="plate-status">In use</span><h2><span class="plate-code">LT</span> <span class="plate-no">12</span></h2></div>
          <div class="plate free"><span class="plate-status">Free</span><h2><span class="plate-code">CALC</span> <span class="plate-no">7</span></h2></div>
        </div>
      </section>

      <section class="login-side">
        <form id="login" class="login-form" novalidate>
          <h2>Log in</h2>
          <label>Email<input type="email" name="email" autocomplete="username" required></label>
          <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
          <p id="error" class="error" role="alert" hidden></p>
          <p id="waking" class="muted small" aria-live="polite" hidden>Starting the server. After a quiet spell this can take up to a minute…</p>
          <button type="submit" class="btn primary" id="submit">Log in</button>
          <button type="button" class="link-btn" id="forgot">Forgot password?</button>
        </form>

        <form id="reset" class="login-form" novalidate hidden>
          <h2>Reset password</h2>
          <p class="lead">Enter the email you log in with. We'll send you a link to choose a new password.</p>
          <label>Email<input type="email" name="email" autocomplete="username" required></label>
          <p id="reset-error" class="error" role="alert" hidden></p>
          <p id="reset-sent" class="notice ok" role="status" hidden></p>
          <button type="submit" class="btn primary" id="reset-submit">Send reset link</button>
          <button type="button" class="link-btn" id="back">Back to log in</button>
        </form>
      </section>
    </div>`;

  const form = $('#login');
  form.addEventListener('input', clearError);

  // ---------- forgot password: swap to the reset form and back ----------
  const reset = $('#reset'), resetError = $('#reset-error'), sent = $('#reset-sent');
  function show(which) {
    form.hidden = which !== 'login'; reset.hidden = which !== 'reset';
    if (which === 'reset') {
      reset.email.value = form.email.value.trim();       // carry over what they typed
      resetError.hidden = true; sent.hidden = true;
      reset.email.focus();
    } else {
      form.email.value = reset.email.value.trim() || form.email.value;
      form.password.focus();
    }
  }
  $('#forgot').addEventListener('click', () => show('reset'));
  $('#back').addEventListener('click', () => show('login'));
  reset.addEventListener('input', () => { resetError.hidden = true; });

  reset.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = reset.email.value.trim();
    const fail = (msg) => { resetError.textContent = msg; resetError.hidden = false; sent.hidden = true; };
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter the email address you log in with.');

    const btn = $('#reset-submit');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await API.sendPasswordReset(email);
      // The same message whether or not the email has an account, so the page gives nothing away
      sent.textContent = `If ${email} has a ClassCast account, a reset link is on its way. Check your inbox and spam folder, then log in with your new password.`;
      sent.hidden = false;
      btn.textContent = 'Send again';
    } catch (err) {
      fail(err.message);
      btn.textContent = 'Send reset link';
    } finally {
      btn.disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = formData(form);
    if (!email.trim()) return showError('Enter your email.');
    if (!password) return showError('Enter your password.');

    $('#submit').disabled = true;
    // A normal login takes a second or two; if it is slower, the server is probably waking up
    const slow = setTimeout(() => { const w = $('#waking'); if (w) w.hidden = false; }, 4000);
    try {
      await API.login(email, password);
      history.replaceState(null, '', '#/');      // router.js picks the home screen for the role
      await startSession();
    } catch (err) {
      showError(err.message);
      const btn = $('#submit'); if (btn) btn.disabled = false;
    } finally {
      clearTimeout(slow);
      const w = $('#waking'); if (w) w.hidden = true;
    }
  });
};
