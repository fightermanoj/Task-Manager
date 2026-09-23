// Exercises sync.js against a stubbed app, localStorage and Supabase client.
//
// This suite exists because sync is the one part of the app that cannot be
// verified by opening it: the deployed build needs an account, a live database
// and a second device, and none of those are available while the sign-in flow
// is still being set up. So the merge rules — which is where a sync layer is
// actually wrong when it is wrong — are driven here instead, against the real
// sync.js rather than a copy of its logic.
//
// The failures worth catching, in order of how much they would hurt:
//
//   * a local edit being reverted by a stale server row while the user watches
//   * a delete coming back from the dead
//   * a row that round-trips through the database never matching its own
//     fingerprint again, so every sync re-uploads everything forever
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'sync.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
}

// ---- fake clock -------------------------------------------------------------
// The pull is throttled to one per 20s, so a test that syncs twice has to move
// the clock rather than wait.
let FAKE_NOW = new Date('2026-09-23T09:00:00Z').getTime();
const RealDate = Date;
function FakeDate(...args) {
  if (args.length === 0) return new RealDate(FAKE_NOW);
  return new RealDate(...args);
}
FakeDate.now = () => FAKE_NOW;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
FakeDate.prototype = RealDate.prototype;

// ---- fake storage -----------------------------------------------------------
function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i],
    get length() { return map.size; },
    _map: map
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// ---- environment ------------------------------------------------------------
function buildEnv(opts) {
  const remote = opts.remote || [];
  const localStorage = makeStore();
  const sessionStorage = makeStore();

  // The debounce is captured rather than scheduled, so a test decides when the
  // flush happens instead of racing a real 2s timer.
  const timers = new Map();
  let timerSeq = 0;

  const state = {
    upserts: [],
    upsertError: null,
    // The inverse of upsertError: the groups endpoint alone fails, which is what
    // a live project whose (user_id, name) index is still the partial one from
    // an older schema.sql actually does — 42P10, every cycle.
    groupsError: null,
    selects: 0,
    // Runs during the pull, which is how "the user typed while the request was
    // in flight" is reproduced.
    duringSelect: null
  };

  const client = {
    from(table) {
      return {
        select() {
          state.selects++;
          if (state.duringSelect) state.duringSelect();
          return Promise.resolve({ data: remote.filter(r => r._table !== 'groups').slice(), error: null });
        },
        upsert(rows) {
          // Only the task table fails, so a test can hold the task push down
          // without the group push failing first and short-circuiting the cycle
          // before it ever reaches the pull.
          if (state.upsertError && table !== 'task_groups') {
            return Promise.resolve({ error: state.upsertError });
          }
          // And the reverse: the groups endpoint fails on its own. This is the
          // shape that shipped to a live project, and it used to abort the whole
          // cycle — no pull, no push, on every sync, indefinitely.
          if (state.groupsError && table === 'task_groups') {
            return Promise.resolve({ error: state.groupsError });
          }
          const target = table === 'task_groups' ? (opts.remoteGroups || []) : remote;
          rows.forEach(row => {
            const i = target.findIndex(x => (table === 'task_groups'
              ? x.user_id === row.user_id && x.name === row.name
              : x.id === row.id));
            if (i === -1) target.push({ ...row });
            else target[i] = { ...target[i], ...row };
          });
          if (table !== 'task_groups') state.upserts.push(...rows);
          return Promise.resolve({ error: null });
        }
      };
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: opts.session === undefined ? { user: { id: 'user-1' } } : opts.session } }),
      onAuthStateChange: () => {}
    }
  };

  const TM = {
    _tasks: (opts.tasks || []).map(t => ({ ...t })),
    _groups: (opts.groups || ['Home']).slice(),
    _observer: null,
    saves: 0,
    renders: 0,
    get tasks() { return this._tasks; },
    set tasks(v) { this._tasks = v; },
    get groups() { return this._groups; },
    set groups(v) { this._groups = v; },
    saveToStorage() { this.saves++; },
    renderAll() { this.renders++; },
    setPersistObserver(fn) { this._observer = fn; }
  };

  const pill = { textContent: '', classList: { _s: new Set(),
    add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
    toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
    contains(c) { return this._s.has(c); } } };

  const sandbox = {
    window: {
      TM_CONFIG: { url: 'https://example.supabase.co', anonKey: 'eyJx' },
      TM,
      TM_AUTH: client,
      addEventListener: () => {}
    },
    document: {
      getElementById: (id) => (id === 'sync-pill' ? pill : null),
      addEventListener: () => {},
      visibilityState: 'visible'
    },
    localStorage,
    sessionStorage,
    location: { protocol: 'https:' },
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: (fn) => { const id = ++timerSeq; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    Date: FakeDate
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  return {
    TM, state, remote, localStorage, sessionStorage, pill,
    // Fire the debounced flush the way the 2s timer would have.
    runTimers() {
      const fns = [...timers.values()];
      timers.clear();
      fns.forEach(fn => fn());
    }
  };
}

// A task in exactly the shape normalizeTask produces, so fingerprints computed
// here match the ones sync.js computes from the live array.
function task(over) {
  return Object.assign({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Server backup', group: 'Work', dueDate: '2026-09-23', time: '10:20',
    recur: 'none', completed: false, completedAt: '', observing: false,
    queued: false, queuedAt: null, elapsedSeconds: 0, isTiming: false,
    timerStartedAt: null, observeNotes: [], subtasks: []
  }, over);
}

// The same task as the database would hand it back.
function row(over) {
  return Object.assign({
    id: '11111111-1111-4111-8111-111111111111', user_id: 'user-1',
    title: 'Server backup', group_name: 'Work', due_date: '2026-09-23',
    scheduled_time: '10:20:00', recur: 'none', completed: false,
    completed_at: null, observing: false, queued: false, queued_at: null,
    elapsed_seconds: 0, timer_started_at: null, subtasks: [], observe_notes: [],
    created_at: '2026-09-23T08:00:00Z', updated_at: '2026-09-23T08:00:00Z',
    deleted_at: null
  }, over);
}

async function main() {
  console.log('\n[sync-1] A local change reaches the outbox and the server');
  {
    const env = buildEnv({ tasks: [task()] });
    await tick(); await tick();
    check('the first sync uploads the task', env.remote.length === 1,
      `remote has ${env.remote.length} rows`);
    const sent = env.remote[0] || {};
    check('it is stamped with the signed-in user', sent.user_id === 'user-1');
    check('the group is mapped to group_name', sent.group_name === 'Work', String(sent.group_name));
    check('the date is mapped to due_date', sent.due_date === '2026-09-23');
    check('updated_at is supplied by the client, not left to a trigger',
      typeof sent.updated_at === 'string' && !Number.isNaN(RealDate.parse(sent.updated_at)),
      String(sent.updated_at));
    check('the outbox is drained afterwards',
      env.localStorage.getItem('tm_sync_outbox') === '[]',
      String(env.localStorage.getItem('tm_sync_outbox')));
  }

  console.log('\n[sync-2] A row that round-trips does not look like a new edit');
  {
    // The failure this guards: if fromRow and normalizeTask disagree by even one
    // field, the fingerprint computed from the pulled row never matches the one
    // computed from the live task, and every single sync re-uploads everything.
    const env = buildEnv({ tasks: [task()] });
    await tick(); await tick();
    const uploaded = { ...env.remote[0] };

    env.TM._tasks = [task()];
    FAKE_NOW += 60000;
    env.runTimers();
    await tick(); await tick();

    check('a second sync makes no request at all',
      env.state.upserts.length === 1,
      `${env.state.upserts.length} upserts total`);
    check('and the row is unchanged', JSON.stringify(env.remote[0]) === JSON.stringify(uploaded));
  }

  console.log('\n[sync-3] A newer server edit wins; an older one does not');
  {
    // First contact: this device has never synced, so it has no idea when its
    // own copy was written and cannot claim it is newer. The server's row wins.
    // That is also what stops a device with a stale local copy from reverting
    // the server on its very first sync.
    const env = buildEnv({
      tasks: [task({ title: 'local title' })],
      remote: [row({ title: 'server title', updated_at: '2099-01-01T00:00:00Z' })]
    });
    await tick(); await tick();
    check('on first contact the newer server title is taken',
      env.TM._tasks[0].title === 'server title', env.TM._tasks[0].title);
    check('the app repaints after a remote change', env.TM.renders > 0);
  }
  {
    // Once a sync has happened the device knows what it last agreed with the
    // server, so a row older than that no longer gets to overwrite anything.
    const env = buildEnv({ tasks: [task({ title: 'local title' })] });
    await tick(); await tick();
    check('the first sync uploads the local task', env.remote.length === 1);

    env.remote[0] = row({ title: 'stale server title', updated_at: '2000-01-01T00:00:00Z' });
    FAKE_NOW += 60000;
    env.runTimers();
    await tick(); await tick();

    check('a server row older than the known local edit is ignored',
      env.TM._tasks[0].title === 'local title', env.TM._tasks[0].title);
  }

  console.log('\n[sync-4] A local edit survives a stale server row');
  {
    // The edit is made while the request is in flight — the one window in which
    // the outbox still holds an entry as the pull lands. Letting the server win
    // here would revert what the user is watching themselves type.
    const env = buildEnv({
      tasks: [task({ title: 'before' })],
      remote: [row({ title: 'server', updated_at: '2099-01-01T00:00:00Z' })]
    });
    env.state.duringSelect = () => {
      env.TM._tasks = [task({ title: 'typed just now' })];
      if (env.TM._observer) env.TM._observer();
    };
    await tick(); await tick(); await tick();
    check('the unpushed local edit is not reverted',
      env.TM._tasks[0].title === 'typed just now', env.TM._tasks[0].title);
    check('and it is queued for upload, not dropped',
      /typed just now|upsert/.test(env.localStorage.getItem('tm_sync_outbox') || '') ||
      env.state.upserts.some(u => u.title === 'typed just now'));
  }

  console.log('\n[sync-5] Deletes are tombstones and stay deleted');
  {
    const env = buildEnv({ tasks: [task(), task({ id: '22222222-2222-4222-8222-222222222222', title: 'keep' })] });
    await tick(); await tick();
    check('both tasks uploaded', env.remote.length === 2);

    // Drop one, the way app.js's delete would.
    env.TM._tasks = env.TM._tasks.filter(t => t.title === 'keep');
    if (env.TM._observer) env.TM._observer();
    FAKE_NOW += 60000;
    env.runTimers();
    await tick(); await tick();

    const gone = env.remote.find(r => r.id === '11111111-1111-4111-8111-111111111111');
    check('the row is still present, not hard-deleted', !!gone);
    check('and carries a tombstone', !!gone && !!gone.deleted_at, String(gone && gone.deleted_at));
    check('the local copy is not resurrected', env.TM._tasks.length === 1);
  }

  console.log('\n[sync-6] A server tombstone removes the local copy');
  {
    const env = buildEnv({
      tasks: [task({ title: 'doomed' })],
      remote: [row({ deleted_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z' })]
    });
    await tick(); await tick();
    check('the deleted task is gone locally', env.TM._tasks.length === 0,
      `${env.TM._tasks.length} tasks left`);
  }

  console.log('\n[sync-7] Timers convert cleanly in both directions');
  {
    const started = new RealDate('2026-09-23T09:30:00Z').getTime();
    const env = buildEnv({ tasks: [task({ isTiming: true, timerStartedAt: started, elapsedSeconds: 120 })] });
    await tick(); await tick();
    check('epoch milliseconds go out as an ISO instant',
      env.remote[0] && env.remote[0].timer_started_at === '2026-09-23T09:30:00.000Z',
      String(env.remote[0] && env.remote[0].timer_started_at));

    // And back again: a string here would be silently dropped by normalizeTask,
    // which only accepts a finite number.
    const env2 = buildEnv({
      tasks: [],
      remote: [row({ timer_started_at: '2026-09-23T09:30:00Z', updated_at: '2099-01-01T00:00:00Z' })]
    });
    await tick(); await tick();
    const pulled = env2.TM._tasks[0] || {};
    check('an ISO instant comes back as epoch milliseconds',
      pulled.timerStartedAt === started, String(pulled.timerStartedAt));
    check('and isTiming agrees with it',
      pulled.isTiming === true,
      'a start time with no flag would never be folded into the elapsed base');
  }

  console.log('\n[sync-8] A time column survives the round trip');
  {
    // PostgREST returns a `time` as HH:MM:SS. The app's parser only recognises
    // HH:MM, so an untruncated value silently loses the task's time.
    const env = buildEnv({
      tasks: [],
      remote: [row({ scheduled_time: '10:20:00', updated_at: '2099-01-01T00:00:00Z' })]
    });
    await tick(); await tick();
    check('HH:MM:SS is truncated to HH:MM',
      (env.TM._tasks[0] || {}).time === '10:20', String((env.TM._tasks[0] || {}).time));
  }

  console.log('\n[sync-9] Nothing runs without a session or a config');
  {
    const noSession = buildEnv({ tasks: [task()], session: null });
    await tick(); await tick();
    check('with no session, nothing is uploaded', noSession.remote.length === 0);
    check('and no observer is installed', noSession.TM._observer === null);

    const noConfig = buildEnv({ tasks: [task()] });
    // Rebuild with the config removed by handing the sandbox an empty object.
    const localStore = makeStore();
    const sandbox = {
      window: { TM_CONFIG: undefined, TM: noConfig.TM, TM_AUTH: {}, addEventListener: () => {} },
      document: { getElementById: () => null, addEventListener: () => {} },
      localStorage: localStore, sessionStorage: makeStore(),
      location: { protocol: 'https:' },
      console: { warn: () => {} },
      setTimeout: () => 0, clearTimeout: () => {}, Date: FakeDate
    };
    vm.createContext(sandbox);
    let threw = null;
    try { vm.runInContext(SRC, sandbox); } catch (err) { threw = err; }
    check('an unconfigured copy does not throw', threw === null, String(threw));
    check('and writes nothing', localStore.length === 0);
  }

  console.log('\n[sync-10] A failed push keeps the work queued');
  {
    const env = buildEnv({ tasks: [task()] });
    env.state.upsertError = { message: 'network down' };
    await tick(); await tick(); await tick();
    check('the outbox still holds the entry',
      (env.localStorage.getItem('tm_sync_outbox') || '[]') !== '[]',
      String(env.localStorage.getItem('tm_sync_outbox')));
    check('nothing reached the server', env.remote.length === 0);
    check('the failure is shown, not swallowed', env.pill.textContent === 'Not synced',
      env.pill.textContent || '(empty)');

    env.state.upsertError = null;
    FAKE_NOW += 60000;
    env.runTimers();
    await tick(); await tick();
    check('the retry succeeds', env.remote.length === 1);
    check('and the pill recovers', env.pill.textContent === 'Synced', env.pill.textContent);
  }

  console.log('\n[sync-11] A group failure cannot take task sync down with it');
  {
    // The failure this guards is the one that actually shipped. pushGroups ran
    // first and unguarded, so a project whose (user_id, name) index was still
    // the partial one from an older schema.sql threw here on every cycle and
    // took the pull and the push with it. The symptom was a red "Not synced"
    // and nothing moving in either direction, while the tasks themselves were
    // perfectly healthy the whole time. A group is a label on a task, not the
    // task, and it must not be able to hold the dataset hostage.
    const env = buildEnv({
      tasks: [task({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Local only' })],
      remote: [row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'From the server' })],
      groups: ['Home']
    });
    env.state.groupsError = {
      code: '42P10',
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification'
    };

    await tick(); await tick(); await tick();

    check('the local task is still uploaded',
      env.remote.some(r => r.title === 'Local only'),
      JSON.stringify(env.remote.map(r => r.title)));
    check('the server row is still pulled and applied',
      env.TM._tasks.some(t => t.title === 'From the server'),
      JSON.stringify(env.TM._tasks.map(t => t.title)));
    check('the group failure is still reported, and named',
      env.pill.textContent === 'Groups not synced', env.pill.textContent || '(empty)');
    check('and it is still flagged as something being wrong',
      env.pill.classList.contains('is-error'));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
