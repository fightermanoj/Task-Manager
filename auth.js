/* Sign-in gate and session handling.

   Loaded last, after config.js, vendor/supabase.js and app.js. The app itself
   knows nothing about any of this — it boots identically whether or not there is
   an account, because localStorage is still what it reads and writes.

   Two ways in, and they are not redundant:

     Password  — no email is sent, so nothing can be rate-limited, delayed or
                 filtered into a spam folder. This is the reliable one.

     Email link — nothing to remember or type. Better on a phone in principle,
                 but on an installed iPhone app the link opens in Safari rather
                 than in the app, so the session lands in Safari and the app you
                 installed stays signed out. The six-digit code exists for that
                 case: type it where you already are instead of following the
                 link somewhere else.

   "Remember me" chooses where the session is kept: localStorage, which outlives
   the browser closing, or sessionStorage, which does not. It defaults to the
   former, because that is what the app did before the control existed — a
   device that never touches it must keep behaving exactly as it did.

   Three things this deliberately does NOT do:

     * It does not store your password. Browsers offer to do that themselves,
       and a password sitting in localStorage is readable by any script that
       ever ends up on this origin.

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
  const appWindow = document.getElementById('app-window');
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const passwordRow = document.getElementById('auth-password-row');
  const codeInput = document.getElementById('auth-code');
  const codeRow = document.getElementById('auth-code-row');
  const submitBtn = document.getElementById('auth-submit');
  const createBtn = document.getElementById('auth-create');
  const tabPassword = document.getElementById('auth-tab-password');
  const tabLink = document.getElementById('auth-tab-link');
  const note = document.getElementById('auth-note');
  const skipBtn = document.getElementById('auth-skip');
  const signOutBtn = document.getElementById('sign-out-btn');
  const who = document.getElementById('auth-who');
  const rememberInput = document.getElementById('auth-remember');

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

  // --- Remember me ----------------------------------------------------------
  //
  // Where the session is kept. Checked — the default, and exactly what the app
  // did before this control existed — means localStorage, which survives the
  // browser closing. Unchecked means sessionStorage, which the browser drops
  // when it closes, so the device forgets you.
  //
  // The key is ours rather than one supabase-js generates, for a specific
  // reason: the session then lives under a name we know, in exactly one of two
  // stores, and can be moved between them without guessing at the library's
  // internal key shape.
  const REMEMBER_KEY = 'tm_remember';
  const SESSION_KEY = 'tm_auth_session';
  const EMAIL_KEY = 'tm_last_email';

  // Absent means remembered. A device that has never touched the checkbox has
  // no stored preference, and the behaviour it had before this existed is the
  // one it should keep.
  function wantsRemember() {
    try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (err) { return true; }
  }

  function storeFor(remember) {
    return remember ? localStorage : sessionStorage;
  }

  // supabase-js keeps a PKCE code verifier alongside the session, under a key
  // sharing this prefix. Moving only the session would strand it, so every key
  // with the prefix moves together.
  function sessionKeys() {
    const keys = [];
    const collect = (store) => {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (key && key.indexOf(SESSION_KEY) === 0 && keys.indexOf(key) === -1) keys.push(key);
        }
      } catch (err) { /* storage blocked */ }
    };
    collect(localStorage);
    collect(sessionStorage);
    return keys;
  }

  // The session must live in exactly one of the two stores. A copy left behind
  // in localStorage is precisely the bug that would make "don't remember me"
  // silently remember you: the next visit reads it straight back and the
  // checkbox appears to have done nothing.
  function settleSessionStore() {
    const keep = storeFor(wantsRemember());
    const drop = storeFor(!wantsRemember());
    try {
      sessionKeys().forEach(key => {
        const value = drop.getItem(key);
        if (value !== null) keep.setItem(key, value);
        drop.removeItem(key);
      });
    } catch (err) { /* storage blocked */ }
  }

  // supabase-js reads and writes the session through this, so the invariant
  // holds on every save and not only when the checkbox is toggled.
  const rememberAwareStorage = {
    getItem(key) {
      try { return storeFor(wantsRemember()).getItem(key); } catch (err) { return null; }
    },
    setItem(key, value) {
      try {
        storeFor(wantsRemember()).setItem(key, value);
        storeFor(!wantsRemember()).removeItem(key);
      } catch (err) { /* storage blocked */ }
    },
    removeItem(key) {
      try { localStorage.removeItem(key); } catch (err) { /* storage blocked */ }
      try { sessionStorage.removeItem(key); } catch (err) { /* storage blocked */ }
    }
  };

  function rememberEmail(email) {
    try {
      if (wantsRemember() && email) localStorage.setItem(EMAIL_KEY, email);
      else localStorage.removeItem(EMAIL_KEY);
    } catch (err) { /* storage blocked */ }
  }

  function recalledEmail() {
    try { return wantsRemember() ? (localStorage.getItem(EMAIL_KEY) || '') : ''; }
    catch (err) { return ''; }
  }

  // Settle before the client is built and reads the session, so a choice made
  // on a previous visit is already in force.
  settleSessionStore();

  const client = supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      storageKey: SESSION_KEY,
      storage: rememberAwareStorage,
      persistSession: true,
      autoRefreshToken: true
    }
  });
  // Kept on the bridge so the Phase 3 sync layer can reuse this exact client
  // rather than opening a second one with its own token refresh cycle.
  window.TM_AUTH = client;

  // Flipping the checkbox takes effect immediately, including for a session
  // that already exists — it is moved between stores rather than waiting for
  // the next sign-in to matter.
  if (rememberInput) {
    rememberInput.checked = wantsRemember();
    rememberInput.addEventListener('change', () => {
      try {
        localStorage.setItem(REMEMBER_KEY, rememberInput.checked ? '1' : '0');
      } catch (err) { /* storage blocked */ }
      settleSessionStore();
      rememberEmail(rememberInput.checked ? (emailInput && emailInput.value || '').trim() : '');
    });
  }

  // Prefilled only when the address was deliberately remembered.
  const recalled = recalledEmail();
  if (recalled && emailInput && !emailInput.value) emailInput.value = recalled;

  const show = (message, kind) => {
    if (!note) return;
    note.textContent = message || '';
    note.className = 'auth-note' + (kind ? ` auth-note-${kind}` : '');
  };

  // The exact URL to come back to, minus any fragment or query — a signed-in
  // link that lands on a URL still carrying an old token would be re-consumed.
  const returnTo = () => location.href.split('#')[0].split('?')[0];

  const setMode = (next) => {
    const link = next === 'link';
    if (passwordRow) passwordRow.classList.toggle('hidden', link);
    if (createBtn) createBtn.classList.toggle('hidden', link);
    if (tabPassword) {
      tabPassword.classList.toggle('is-active', !link);
      tabPassword.setAttribute('aria-selected', String(!link));
    }
    if (tabLink) {
      tabLink.classList.toggle('is-active', link);
      tabLink.setAttribute('aria-selected', String(link));
    }
    if (submitBtn) submitBtn.textContent = link ? 'Send sign-in link' : 'Sign in';
    if (passwordInput) passwordInput.value = '';
    show('');
  };

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

  if (tabPassword) tabPassword.addEventListener('click', () => setMode('password'));
  if (tabLink) tabLink.addEventListener('click', () => setMode('link'));

  if (form) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const email = (emailInput && emailInput.value || '').trim();
      if (!email) return;
      const usingLink = tabLink && tabLink.classList.contains('is-active');

      if (usingLink) {
        if (submitBtn) submitBtn.disabled = true;
        show('Sending…');
        client.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: returnTo(), shouldCreateUser: true }
        }).then(({ error }) => {
          if (submitBtn) submitBtn.disabled = false;
          if (error) { show(error.message, 'error'); return; }
          rememberEmail(email);
          if (codeRow) codeRow.classList.remove('hidden');
          show('Check your email — tap the link, or type the code below.', 'ok');
        }).catch(() => {
          if (submitBtn) submitBtn.disabled = false;
          show('Could not reach the server. Check your connection.', 'error');
        });
        return;
      }

      const password = (passwordInput && passwordInput.value) || '';
      // Checked here as well as in the markup so the message is ours rather
      // than the browser's, and so the same rule covers the create path.
      if (password.length < 6) {
        show('Password must be at least 6 characters.', 'error');
        if (passwordInput) passwordInput.focus();
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      show('Signing in…');
      client.auth.signInWithPassword({ email, password })
        .then(({ error }) => {
          if (submitBtn) submitBtn.disabled = false;
          if (error) {
            // The single most likely error by far, and Supabase's own wording
            // ("Invalid login credentials") does not say what to do about it.
            show(/invalid login/i.test(error.message)
              ? 'Wrong email or password. If you have not made an account yet, use Create an account below.'
              : error.message, 'error');
            return;
          }
          rememberEmail(email);
          show('');
        })
        .catch(() => {
          if (submitBtn) submitBtn.disabled = false;
          show('Could not reach the server. Check your connection.', 'error');
        });
    });
  }

  if (createBtn) {
    createBtn.addEventListener('click', () => {
      const email = (emailInput && emailInput.value || '').trim();
      const password = (passwordInput && passwordInput.value) || '';
      if (!email) { show('Enter your email first.', 'error'); if (emailInput) emailInput.focus(); return; }
      if (password.length < 6) {
        show('Password must be at least 6 characters.', 'error');
        if (passwordInput) passwordInput.focus();
        return;
      }
      createBtn.disabled = true;
      show('Creating your account…');
      client.auth.signUp({ email, password, options: { emailRedirectTo: returnTo() } })
        .then(({ data, error }) => {
          createBtn.disabled = false;
          if (error) { show(error.message, 'error'); return; }
          rememberEmail(email);
          // A session means we are already in. No session means the project is
          // still set to require email confirmation before first sign-in.
          if (data && data.session) { show(''); return; }
          show('Account created. Confirm your email, then sign in above.', 'ok');
        })
        .catch(() => {
          createBtn.disabled = false;
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
