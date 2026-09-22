/* Sign-in gate and session handling.

   Loaded last, after config.js, vendor/supabase.js and app.js. The app itself
   knows nothing about any of this — it boots identically whether or not there is
   an account, because localStorage is still what it reads and writes.

   Two things this deliberately does NOT do:

     * It does not run when the page is opened off disk. index.html opened
       directly has no origin to redirect a sign-in link back to and no server
       to talk to, so the gate stays out of the way and the app works locally
       exactly as it did before.

     * It does not clear the task list on sign-out. Your tasks are your data,
       and losing them because a session expired would be far worse than the
       alternative. The trade-off is that a second person signing in on this
       device would see the first person's tasks until sync lands in Phase 3,
       which is when per-account storage gets separated. */

(function () {
  'use strict';

  const cfg = window.TM_CONFIG;

  const gate = document.getElementById('auth-gate');
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const codeInput = document.getElementById('auth-code');
  const codeRow = document.getElementById('auth-code-row');
  const submitBtn = document.getElementById('auth-submit');
  const note = document.getElementById('auth-note');
  const skipBtn = document.getElementById('auth-skip');
  const signOutBtn = document.getElementById('sign-out-btn');
  const who = document.getElementById('auth-who');

  const appWindow = document.getElementById('app-window');

  // The gate covers the app visually; `inert` takes it out of the tab order and
  // the accessibility tree as well, so the sign-in form is the only thing
  // reachable while it is up.
  //
  // Note there is no "hidden until auth resolves" class on <body>: if this file
  // ever failed to load, such a class would leave the app permanently hidden
  // with nothing on screen to explain why. Covering it instead means the worst
  // case is a moment of the app showing before the gate appears.
  const unlock = () => {
    if (!appWindow) return;
    appWindow.removeAttribute('inert');
    appWindow.removeAttribute('aria-hidden');
  };

  // Opening the file directly: no config script in play, or no origin to come
  // back to. Let the app through and never mention accounts.
  if (!cfg || !cfg.url || !cfg.anonKey ||
      !/^https?:$/.test(location.protocol) ||
      typeof supabase === 'undefined') {
    unlock();
    return;
  }

  const client = supabase.createClient(cfg.url, cfg.anonKey);
  // Kept on the bridge so the Phase 3 sync layer can reuse this exact client
  // rather than opening a second one with its own token refresh cycle.
  window.TM_AUTH = client;

  const show = (message, kind) => {
    if (!note) return;
    note.textContent = message || '';
    note.className = 'auth-note' + (kind ? ` auth-note-${kind}` : '');
  };

  // The exact URL to come back to, minus any fragment or query — a signed-in
  // link that lands on a URL still carrying an old token would be re-consumed.
  const returnTo = () => location.href.split('#')[0].split('?')[0];

  function showGate() {
    if (gate) gate.classList.remove('hidden');
    if (appWindow) {
      appWindow.setAttribute('inert', '');
      appWindow.setAttribute('aria-hidden', 'true');
    }
    if (emailInput) emailInput.focus();
  }

  function signedIn(session) {
    unlock();
    if (gate) gate.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.remove('hidden');
    if (who) {
      who.textContent = session && session.user && session.user.email
        ? session.user.email
        : '';
      who.classList.toggle('hidden', !who.textContent);
    }
  }

  function signedOut() {
    if (signOutBtn) signOutBtn.classList.add('hidden');
    if (who) who.classList.add('hidden');
    // A deliberate "continue without an account" is remembered, so the gate
    // does not reappear on every reload of a device that is never going to
    // sign in.
    let choseLocal = false;
    try { choseLocal = localStorage.getItem('tm_local_only') === '1'; } catch (err) { /* storage blocked */ }
    if (choseLocal) { unlock(); return; }
    showGate();
  }

  if (form) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const email = (emailInput && emailInput.value || '').trim();
      if (!email) return;

      if (submitBtn) submitBtn.disabled = true;
      show('Sending…');

      client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: returnTo(), shouldCreateUser: true }
      }).then(({ error }) => {
        if (submitBtn) submitBtn.disabled = false;
        if (error) { show(error.message, 'error'); return; }
        // The code field is revealed alongside the link because the two are not
        // interchangeable: on an installed iPhone app a link opens in Safari,
        // which means the session lands in Safari and the app you installed
        // stays signed out. Typing the code keeps you where you already are.
        if (codeRow) codeRow.classList.remove('hidden');
        show('Check your email — tap the link, or type the code below.', 'ok');
      }).catch(() => {
        if (submitBtn) submitBtn.disabled = false;
        show('Could not reach the server. Check your connection.', 'error');
      });
    });
  }

  if (codeInput) {
    codeInput.addEventListener('change', () => {
      const token = (codeInput.value || '').trim();
      const email = (emailInput && emailInput.value || '').trim();
      if (!token || !email) return;
      show('Checking…');
      client.auth.verifyOtp({ email, token, type: 'email' })
        .then(({ error }) => {
          if (error) show(error.message, 'error');
          else show('');
        })
        .catch(() => show('Could not reach the server.', 'error'));
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      try { localStorage.setItem('tm_local_only', '1'); } catch (err) { /* storage blocked */ }
      unlock();
      if (gate) gate.classList.add('hidden');
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      client.auth.signOut().then(() => {
        // Signing out is not the same as choosing to work locally — clear the
        // remembered choice so the gate comes back and can be signed into again.
        try { localStorage.removeItem('tm_local_only'); } catch (err) { /* storage blocked */ }
        location.reload();
      }).catch(() => {});
    });
  }

  client.auth.onAuthStateChange((event, session) => {
    if (session) signedIn(session);
    else if (event === 'SIGNED_OUT') signedOut();
  });

  // getSession reads local storage first, so this settles without a round trip
  // when there is already a session — the gate is never shown to someone who is
  // already signed in.
  client.auth.getSession().then(({ data }) => {
    if (data && data.session) signedIn(data.session);
    else signedOut();
  }).catch(() => signedOut());
})();
