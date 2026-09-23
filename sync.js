/* Offline-first sync.

   localStorage stays the source of truth for everything the UI reads. This file
   only ever catches the cloud up to it in the background, and folds back what
   other devices wrote. Nothing here sits between a tap and the screen, which is
   what keeps the app working on a plane, in a tunnel, and with the server down.

   Loaded last, after auth.js, and inert unless auth.js produced a session — so
   with no account configured the app behaves exactly as it did before this file
   existed, and a failure in here can never be why the app fails to start.

   Three decisions worth knowing:

     * Change detection is a fingerprint, not a list of call sites. Every
       mutation in app.js ends at saveToStorage(), so observing that one function
       and diffing against the last-seen fingerprints catches edits from any
       code path — including ones added later — without touching app.js again.

     * Last-write-wins compares the *client's* edit time, which is why the
       database must not stamp updated_at itself. A server-side trigger makes a
       device that was offline all week win over a newer edit made online
       yesterday, because the trigger records when the row arrived rather than
       when it was written. sql/phase3.sql drops those two triggers.

     * Deletes are tombstones. A row that is simply gone cannot be propagated:
       the other device still holds it, sees nothing missing, and uploads it
       straight back. */

(function () {
  'use strict';

  const cfg = window.TM_CONFIG;
  const client = window.TM_AUTH;
  const TM = window.TM;

  // Not configured, not signed in, or opened straight off disk. The app is
  // fully usable in all three cases; there is simply nothing to sync.
  if (!cfg || !cfg.url || !client || !TM || !/^https?:$/.test(location.protocol)) return;

  const OUTBOX_KEY = 'tm_sync_outbox';
  const SEEN_KEY = 'tm_sync_seen';
  const GROUPS_KEY = 'tm_sync_groups';

  // Long enough that a burst of edits becomes one request, short enough that it
  // feels immediate.
  const FLUSH_DELAY_MS = 2000;
  // Focus fires constantly when switching windows; a pull is a full round trip.
  const MIN_PULL_GAP_MS = 20000;
  // How often a tab that is actually on screen re-checks the server. Nothing
  // else covers that case. Startup, regaining focus and coming back online are
  // the only other triggers, and a window left open on a desk — which is the
  // normal shape of "I added it on my phone and expected to see it here" —
  // fires none of them, so it never looked at all. Cheap, because it only runs
  // while the tab is visible; a hidden tab has its timers throttled by the
  // browser regardless.
  const POLL_MS = 15000;

  let suppress = false;      // true while writing state that came from the server
  let running = false;
  let flushTimer = null;
  let pollTimer = null;
  let lastSyncAt = 0;

  /* ---------------------------------------------------------------- storage */

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { /* quota or storage blocked; the next flush will retry */ }
  }

  const loadOutbox = () => {
    const raw = readJson(OUTBOX_KEY, []);
    return Array.isArray(raw) ? raw.filter(e => e && typeof e.id === 'string') : [];
  };
  const saveOutbox = (list) => writeJson(OUTBOX_KEY, list);

  const loadSeen = () => {
    const raw = readJson(SEEN_KEY, {});
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  };
  const saveSeen = (map) => writeJson(SEEN_KEY, map);

  // Coalesced by id: twenty edits to one task, and one delete at the end, become
  // a single entry. Without this a rename typed a character at a time would be
  // twenty round trips.
  function enqueue(id, op, at) {
    const outbox = loadOutbox();
    const existing = outbox.findIndex(e => e.id === id);
    const entry = { id, op, at };
    if (existing === -1) outbox.push(entry);
    else outbox[existing] = entry;
    saveOutbox(outbox);
  }

  /* ------------------------------------------------------------ row <-> task */

  // Property order is fixed by normalizeTask and every task in the array has
  // been through it, so this is stable between runs and between reloads.
  const fingerprint = (task) => JSON.stringify(task);

  function toRow(task, userId, stamp) {
    return {
      id: task.id,
      user_id: userId,
      title: task.title,
      group_name: task.group,
      due_date: task.dueDate || null,
      scheduled_time: task.time || null,
      recur: task.recur,
      completed: task.completed,
      completed_at: task.completedAt || null,
      observing: task.observing,
      queued: task.queued,
      queued_at: task.queuedAt === null || task.queuedAt === undefined
        ? null : Math.round(task.queuedAt),
      elapsed_seconds: task.elapsedSeconds,
      // Epoch milliseconds in the app, an ISO instant on the wire. Postgres will
      // not take a number for timestamptz and normalizeTask will not take a
      // string back, so the conversion belongs here, on both sides.
      timer_started_at: task.timerStartedAt
        ? new Date(task.timerStartedAt).toISOString() : null,
      subtasks: task.subtasks,
      observe_notes: task.observeNotes,
      updated_at: stamp,
      deleted_at: null
    };
  }

  // Mirrors normalizeTask exactly. If it ever drifts, the fingerprints computed
  // from a pulled row stop matching the ones computed after it round-trips
  // through the app, and every sync re-uploads everything forever.
  function fromRow(row) {
    const startedAt = row.timer_started_at ? Date.parse(row.timer_started_at) : NaN;
    const timing = Number.isFinite(startedAt);
    return {
      id: String(row.id),
      title: row.title || '',
      group: row.group_name || 'Personal',
      dueDate: row.due_date || '',
      // PostgREST returns a time as HH:MM:SS; the app's shape is HH:MM, and the
      // time parser will not recognise the longer form.
      time: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : '',
      recur: row.recur || 'none',
      completed: !!row.completed,
      completedAt: row.completed_at || '',
      observing: !!row.observing,
      queued: !!row.queued,
      queuedAt: row.queued_at === null || row.queued_at === undefined
        ? null : Number(row.queued_at),
      elapsedSeconds: Number(row.elapsed_seconds) || 0,
      // isTiming and timerStartedAt have to agree: checkpointRunningTimers and
      // settleTaskTimer both gate on isTiming, so a start time with no flag
      // would display a climbing number that is never folded into the base.
      isTiming: timing,
      timerStartedAt: timing ? startedAt : null,
      observeNotes: Array.isArray(row.observe_notes) ? row.observe_notes : [],
      subtasks: Array.isArray(row.subtasks) ? row.subtasks : []
    };
  }

  /* ------------------------------------------------------------ change watch */

  // Called on every persist, and once at startup. Anything whose fingerprint
  // moved since we last looked is a local edit the server has not seen.
  function observe() {
    if (suppress) return;
    const now = Date.now();
    const seen = loadSeen();
    const next = {};
    let dirty = false;

    (TM.tasks || []).forEach(task => {
      const print = fingerprint(task);
      const prior = seen[task.id];
      if (prior && prior.h === print) {
        next[task.id] = prior;
        return;
      }
      // A task we have never seen is not necessarily new — it may predate sync —
      // but either way the server has no copy at this timestamp, so stamping it
      // now is what uploads it exactly once.
      next[task.id] = { h: print, at: now };
      enqueue(task.id, 'upsert', now);
      dirty = true;
    });

    Object.keys(seen).forEach(id => {
      if (next[id]) return;
      enqueue(id, 'delete', now);
      dirty = true;
    });

    saveSeen(next);
    if (dirty) scheduleFlush();
  }

  /* ------------------------------------------------------------------- push */

  async function push(session) {
    const outbox = loadOutbox();
    if (outbox.length === 0) return;

    const byId = new Map((TM.tasks || []).map(t => [t.id, t]));
    const upserts = [];
    const tombstones = [];

    outbox.forEach(entry => {
      const stamp = new Date(entry.at).toISOString();
      if (entry.op === 'delete') {
        // Only the identifying columns. On conflict this updates just these,
        // leaving the rest of an existing row intact; on a row that never
        // existed it inserts a tombstone, which is harmless and stops the other
        // device re-creating it.
        tombstones.push({
          id: entry.id, user_id: session.user.id,
          updated_at: stamp, deleted_at: stamp
        });
        return;
      }
      const task = byId.get(entry.id);
      // Queued for upload, then deleted before we got there. The delete entry
      // supersedes this one.
      if (!task) return;
      upserts.push(toRow(task, session.user.id, stamp));
    });

    if (upserts.length) {
      const { error } = await client.from('tasks').upsert(upserts, { onConflict: 'id' });
      if (error) throw error;
    }
    if (tombstones.length) {
      const { error } = await client.from('tasks').upsert(tombstones, { onConflict: 'id' });
      if (error) throw error;
    }

    // Clear only what was actually sent. Anything enqueued while the request was
    // in flight — the user is still typing — has to survive to the next flush.
    const sent = new Set(outbox.map(e => `${e.id}|${e.at}`));
    saveOutbox(loadOutbox().filter(e => !sent.has(`${e.id}|${e.at}`)));
  }

  /* ----------------------------------------------------------------- groups */

  // Push-only, and only when the set actually changed. There is no rename or
  // delete-group UI, so nothing here needs tombstones or conflict resolution —
  // but a name removed by a future UI would be re-uploaded by a device that
  // still has it, and that is the thing to fix when such a UI is added.
  async function pushGroups(session) {
    const names = (TM.groups || []).slice();
    if (names.length === 0) return;
    const last = readJson(GROUPS_KEY, null);
    if (Array.isArray(last) && JSON.stringify(last) === JSON.stringify(names)) return;

    const stamp = new Date().toISOString();
    const rows = names.map(name => ({
      user_id: session.user.id, name, updated_at: stamp, deleted_at: null
    }));
    const { error } = await client.from('task_groups')
      .upsert(rows, { onConflict: 'user_id,name' });
    if (error) throw error;
    writeJson(GROUPS_KEY, names);
  }

  function mergeGroups(rows) {
    if (!Array.isArray(rows)) return false;
    const local = TM.groups || [];
    const merged = local.slice();
    rows.forEach(row => {
      if (row && !row.deleted_at && row.name && merged.indexOf(row.name) === -1) {
        merged.push(row.name);
      }
    });
    if (merged.length === local.length) return false;
    suppress = true;
    try {
      TM.groups = merged;
      TM.saveToStorage();
    } finally { suppress = false; }
    return true;
  }

  /* ------------------------------------------------------------------- pull */

  // Everything for this user, tombstones included — a pull that filtered them
  // out could never learn about a delete. RLS is what scopes this to one
  // account. At a few hundred rows a full pull is cheaper than the class of
  // bugs an incremental cursor brings, and this is the thing to revisit first
  // if the table ever grows past that.
  async function pull() {
    const { data, error } = await client.from('tasks').select('*');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function applyRemote(rows) {
    const pending = new Set(loadOutbox().map(e => e.id));
    const seen = loadSeen();
    const byId = new Map((TM.tasks || []).map(t => [t.id, t]));
    const appliedAt = new Map();
    let changed = false;

    rows.forEach(row => {
      const id = String(row.id);
      // An edit this device has made but not yet pushed always wins. The server
      // has not seen it, so its copy is by definition the older one — comparing
      // timestamps here would let the server's stale row silently revert an
      // edit the user is still looking at.
      if (pending.has(id)) return;

      const rowAt = row.updated_at ? Date.parse(row.updated_at) : 0;
      const mine = byId.get(id);
      const mineAt = seen[id] ? seen[id].at : 0;

      if (row.deleted_at) {
        if (mine && rowAt > mineAt) { byId.delete(id); changed = true; }
        return;
      }
      if (!mine) {
        byId.set(id, fromRow(row));
        appliedAt.set(id, rowAt);
        changed = true;
        return;
      }
      if (rowAt > mineAt) {
        byId.set(id, fromRow(row));
        appliedAt.set(id, rowAt);
        changed = true;
      }
    });

    if (!changed) return false;

    suppress = true;
    try {
      TM.tasks = [...byId.values()];
      TM.saveToStorage();
    } finally { suppress = false; }

    // Anything the server just overwrote no longer needs uploading — the local
    // edit lost the comparison, and pushing it now would undo the merge that
    // was just applied.
    if (appliedAt.size) {
      saveOutbox(loadOutbox().filter(e => !appliedAt.has(e.id)));
    }

    // Re-derive the fingerprints from what the app actually holds rather than
    // from the rows just read: both then describe the identical object, which is
    // the only way observe() stops seeing a phantom edit next time. The
    // timestamps stay the server's so the next comparison is still meaningful.
    //
    // A task the server has never heard of gets NO entry here, on purpose.
    // Recording one would make observe() pass over it as already-seen and it
    // would never be uploaded at all.
    const fresh = {};
    (TM.tasks || []).forEach(task => {
      const prior = seen[task.id];
      if (appliedAt.has(task.id)) {
        fresh[task.id] = { h: fingerprint(task), at: appliedAt.get(task.id) };
      } else if (prior) {
        fresh[task.id] = { h: fingerprint(task), at: prior.at };
      }
    });
    saveSeen(fresh);

    TM.renderAll();
    return true;
  }

  /* --------------------------------------------------------------- the cycle */

  async function session() {
    const { data } = await client.auth.getSession();
    return data && data.session ? data.session : null;
  }

  async function syncNow(force, quiet) {
    if (running) return;
    const current = await session();
    if (!current) return;

    // A pull on every focus change is a round trip for nothing.
    if (!force && Date.now() - lastSyncAt < MIN_PULL_GAP_MS) return;

    running = true;
    // A poll fires every few seconds and nearly always finds nothing. Announcing
    // each one would make the pill blink "Syncing…" then "Synced" all day, which
    // reads as a fault rather than as health. Quiet runs speak only when the
    // answer actually changes.
    if (!quiet) setStatus('Syncing…');
    try {
      // The group push gets its own try, and that isolation is the whole point
      // of this shape. It used to sit unguarded at the top of the cycle, so one
      // failure here aborted everything after it — pull() never ran, push()
      // never ran, and nothing moved in either direction. Worse, the marker
      // that would have stopped it retrying is written at the end of the same
      // call that threw, so it failed identically on every sync forever.
      //
      // That is not hypothetical: it is what a project whose (user_id, name)
      // index is still the partial one from an older schema.sql does on every
      // cycle. A group is a label on a task, not the task. Losing one is worth
      // reporting; it is not worth the whole dataset.
      let groupsFailed = false;
      try {
        await pushGroups(current);
      } catch (groupErr) {
        groupsFailed = true;
        // The pill is what the user sees; this is what a developer sees.
        if (typeof console !== 'undefined') {
          console.warn('[sync] group push failed; tasks continue', groupErr);
        }
      }

      // Pull before pushing, and this order is not cosmetic. Pushing first
      // uploads this device's copy over whatever the server already holds, and
      // on a device that has never synced that copy is the older one by
      // definition — so the first sync from a second device would quietly
      // revert everything the first device had done, including un-deleting
      // tasks, because a fresh row overwrites a tombstone like any other.
      const rows = await pull();
      applyRemote(rows);
      // Only now is it known what the server is missing: whatever the merge did
      // not already account for. Doing this after the merge also means the
      // upload carries the reconciled state rather than this device's stale
      // idea of it.
      observe();
      await push(current);
      // Named precisely rather than a flat "Synced". The tasks did go, and
      // saying so while still flagging the groups is the honest report — the
      // old wording could only say everything worked or nothing did.
      if (groupsFailed) setStatus('Groups not synced', true);
      else if (!quiet || currentStatus() !== 'Synced') setStatus('Synced');
    } catch (err) {
      // Never surfaced as a modal or a lost edit. The outbox still holds
      // everything unsent, and the next flush retries.
      setStatus('Not synced', true);
    } finally {
      running = false;
      lastSyncAt = Date.now();
    }
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      syncNow(true);
    }, FLUSH_DELAY_MS);
  }

  /* ------------------------------------------------------------------ status */

  function setStatus(text, isError) {
    const pill = document.getElementById('sync-pill');
    if (!pill) return;
    if (!text) { pill.classList.add('hidden'); return; }
    pill.textContent = text;
    pill.classList.remove('hidden');
    pill.classList.toggle('is-error', !!isError);
  }

  // What the pill currently reads, so a quiet run can leave it alone when the
  // answer has not moved.
  function currentStatus() {
    const pill = document.getElementById('sync-pill');
    return pill ? pill.textContent : '';
  }

  /* ------------------------------------------------------------------- wiring */

  function start() {
    TM.setPersistObserver(observe);
    // Deliberately no observe() here. Stamping every task with "now" before the
    // first pull would mark the whole local set as a pending edit, and a pending
    // edit outranks the server — so a device meeting the server for the first
    // time would keep its own copy of anything both sides have. syncNow runs the
    // merge first, which is what tells local-only tasks apart from stale ones.
    syncNow(true);

    // The missing trigger. Everything above is event-driven, so a tab that is
    // simply open and on screen never looks again — it waits to be switched away
    // from and back before it notices anything another device did. This is the
    // only thing that makes "add it on the phone, watch it appear here" work
    // without touching either device. Guarded, because the test sandbox models a
    // browser that may not have it, and armed once however often start() is
    // called.
    if (typeof setInterval === 'function' && !pollTimer) {
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') syncNow(true, true);
      }, POLL_MS);
    }
  }

  function stop() {
    TM.setPersistObserver(null);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    setStatus('');
  }

  window.addEventListener('online', () => syncNow(true));

  document.addEventListener('visibilitychange', () => {
    // Leaving: best effort, so an edit made a moment ago is not left sitting in
    // the outbox until the next visit.
    if (document.visibilityState !== 'visible') { syncNow(true); return; }
    syncNow(false);
  });

  client.auth.onAuthStateChange((event, current) => {
    if (current) start();
    else if (event === 'SIGNED_OUT') stop();
  });

  client.auth.getSession().then(({ data }) => {
    if (data && data.session) start();
  }).catch(() => { /* offline at boot: sync starts on the next sign-in event */ });
})();
