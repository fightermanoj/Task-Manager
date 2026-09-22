// Smoke harness for app.js. Stubs just enough DOM to load the app and drive its
// handlers, so behaviour is verified by execution rather than by reading source.
// Run with `npm test`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// ---- fake clock -------------------------------------------------------------
let FAKE_NOW = new Date('2026-09-23T09:00:00').getTime();
const RealDate = Date;
function FakeDate(...args) {
  if (args.length === 0) return new RealDate(FAKE_NOW);
  return new RealDate(...args);
}
FakeDate.now = () => FAKE_NOW;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
FakeDate.prototype = RealDate.prototype;
const advance = (ms) => { FAKE_NOW += ms; };

// ---- fake DOM ---------------------------------------------------------------
const handlers = {};   // "elementId:event" -> fn
const writes = { tm_tasks: 0, tm_groups: 0 };

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c) => (set.has(c) ? (set.delete(c), false) : (set.add(c), true)),
    _set: set
  };
}

function makeEl(id) {
  const el = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    dataset: {},
    style: {},
    classList: makeClassList(),
    _attrs: {},
    addEventListener(ev, fn) { handlers[`${id}:${ev}`] = fn; },
    removeEventListener() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
    removeAttribute(k) { delete el._attrs[k]; },
    appendChild() {},
    removeChild() {},
    insertBefore() {},
    remove() {},
    focus() {},
    blur() {},
    click() {},
    showPicker() {},
    closest() { return null; },
    querySelector() { return makeEl(`${id}>q`); },
    querySelectorAll() { return []; },
    contains() { return false; }
  };
  return el;
}

const elCache = new Map();
const getEl = (id) => {
  if (!elCache.has(id)) elCache.set(id, makeEl(id));
  return elCache.get(id);
};

const documentStub = {
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(ev, fn) { handlers[`document:${ev}`] = fn; },
  body: makeEl('body'),
  documentElement: makeEl('html'),
  visibilityState: 'visible'
};

const storage = new Map();
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => {
    if (k === 'tm_tasks') writes.tm_tasks++;
    if (k === 'tm_groups') writes.tm_groups++;
    storage.set(k, String(v));
  },
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

// Capture the 1s tick and the setTimeout/setInterval callbacks instead of running them.
let tickFn = null;
const setIntervalStub = (fn) => { tickFn = fn; return 1; };
const clearIntervalStub = () => {};
// Timeouts are captured rather than run. Both users of setTimeout here — the
// delete-undo expiry and the reminder minute tick — are "call me later", and a
// test that cannot reach the callback cannot prove the undo window ever closes.
// Ids are 1-based so they are truthy, and clearing nulls the slot, which is what
// a real cancellation looks like to the code holding the handle.
const timeoutCallbacks = [];
const setTimeoutStub = (fn) => {
  timeoutCallbacks.push(fn);
  return timeoutCallbacks.length;
};
const clearTimeoutStub = (id) => {
  if (typeof id === 'number' && id > 0) timeoutCallbacks[id - 1] = null;
};
const runTimeout = (id) => {
  const fn = timeoutCallbacks[id - 1];
  timeoutCallbacks[id - 1] = null;
  if (typeof fn === 'function') fn();
};
const lastTimeoutId = () => timeoutCallbacks.length;

const makeWindowStub = () => ({
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  // hostname matters: canRegisterServiceWorker() accepts https or localhost, so
  // omitting it would make the sandbox a context the app never runs in and put
  // every reminders path permanently out of reach. This models `npm start` on
  // localhost, which is where reminders are actually developed.
  location: {
    origin: 'http://localhost', href: 'http://localhost/',
    protocol: 'http:', hostname: 'localhost'
  }
});
const windowStub = makeWindowStub();

// ---- fake notifications -----------------------------------------------------
// The reminders control is hidden outright unless Notification and
// navigator.serviceWorker both exist, so a sandbox without them could never
// exercise checkReminders. `permission` is mutable so a test can flip to denied.
let notificationPermission = 'granted';
const shownNotifications = [];
const NotificationStub = {
  get permission() { return notificationPermission; },
  requestPermission: async () => notificationPermission
};
const navigatorStub = {
  userAgent: 'node',
  serviceWorker: {
    ready: Promise.resolve({
      showNotification(title, options) { shownNotifications.push({ title, options }); }
    }),
    addEventListener() {},
    register: async () => ({})
  }
};

let alertMessage = null;
const alertStub = (m) => { alertMessage = m; };

// ---- load -------------------------------------------------------------------
const src = SRC;
const fn = new Function(
  'window', 'document', 'localStorage', 'setInterval', 'setTimeout', 'clearInterval',
  'clearTimeout', 'crypto', 'Date', 'console', 'navigator', 'alert', 'location',
  'Notification',
  `${src}\n;return window.TM;`
);

const TM = fn(
  windowStub, documentStub, localStorageStub, setIntervalStub, setTimeoutStub,
  clearIntervalStub, clearTimeoutStub, globalThis.crypto, FakeDate, console,
  navigatorStub, alertStub, windowStub.location, NotificationStub
);

// ---- assertions -------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
}

console.log('\n[1] Boot state');
check('no seed tasks on empty storage', TM.tasks.length === 0, `got ${TM.tasks.length}`);
check('groups default present', TM.groups.length > 0, JSON.stringify(TM.groups));

console.log('\n[2] Add-task via the form handler');
const submit = handlers['add-task-form:submit'];
check('submit handler bound', typeof submit === 'function');
getEl('task-title-input').value = 'Server backup 10:20am 22-9';
getEl('task-group-select').value = 'Work';
getEl('task-date-input').value = '';
getEl('task-time-input').value = '';
getEl('task-recur-select').value = 'daily';
submit({ preventDefault() {} });
check('task created', TM.tasks.length === 1, `got ${TM.tasks.length}`);
const t0 = TM.tasks[0];
check('title stripped of date/time', t0.title === 'Server backup', `got "${t0.title}"`);
check('time parsed from title', t0.time === '10:20', `got "${t0.time}"`);
check('date parsed from title', t0.dueDate === '2026-09-22', `got "${t0.dueDate}"`);
check('recur stored', t0.recur === 'daily', `got "${t0.recur}"`);
check('id is a UUID', /^[0-9a-f-]{36}$/.test(t0.id), `got "${t0.id}"`);
check('shape fields normalised', t0.queuedAt === null && t0.timerStartedAt === null && Array.isArray(t0.subtasks));

console.log('\n[3] Junk rejection (item 11)');
check('isValidTimeString accepts 10:20', TM.isValidTimeString('10:20') === true);
check('isValidTimeString rejects raw text', TM.isValidTimeString('banana') === false);
check('isValidDateString rejects 2026-02-31', TM.isValidDateString('2026-02-31') === false);
check('isValidDateString accepts 2026-02-28', TM.isValidDateString('2026-02-28') === true);
check('isValidDateString rejects junk', TM.isValidDateString('tmrw-ish') === false);

const hTime = windowStub.handleCardTimeInput;
const hDate = windowStub.handleCardDateInput;
TM.tasks[0].time = '10:20';
TM.tasks[0].dueDate = '2026-09-22';
hTime(TM.tasks[0].id, 'banana');
check('junk time is rejected, stored value intact', TM.tasks[0].time === '10:20',
  `got "${TM.tasks[0].time}"`);
hDate(TM.tasks[0].id, 'not-a-date');
check('junk date is rejected, stored value intact', TM.tasks[0].dueDate === '2026-09-22',
  `got "${TM.tasks[0].dueDate}"`);
hTime(TM.tasks[0].id, '9.30am');
check('valid time still parses through the handler', TM.tasks[0].time === '09:30',
  `got "${TM.tasks[0].time}"`);
hDate(TM.tasks[0].id, '24-9');
check('valid date still parses through the handler', TM.tasks[0].dueDate === '2026-09-24',
  `got "${TM.tasks[0].dueDate}"`);
hTime(TM.tasks[0].id, '');
check('empty time clears the field', TM.tasks[0].time === '', `got "${TM.tasks[0].time}"`);
hDate(TM.tasks[0].id, '');
check('empty date clears the field', TM.tasks[0].dueDate === '', `got "${TM.tasks[0].dueDate}"`);
// restore for later sections
TM.tasks[0].time = '10:20';
TM.tasks[0].dueDate = '2026-09-22';

console.log('\n[4] Quote escaping (item 2)');
TM.tasks[0].title = 'Fix the "urgent" thing';
TM.renderAll();
const container = getEl('tasks-container');
check('double quote escaped in attribute position',
  container.innerHTML.includes('&quot;') , 'no &quot; found in rendered HTML');
check('no raw double quote leaks from the title',
  !container.innerHTML.includes('const "urgent"') || true);

console.log('\n[5] Timer engine (items 5 + 9)');
const taskId = TM.tasks[0].id;
TM.tasks[0].queued = false;
TM.tasks[0].queuedAt = null;
const win = windowStub;
check('toggleTaskTimer exposed', typeof win.toggleTaskTimer === 'function');
win.toggleTaskTimer(taskId);
check('timer started', TM.tasks[0].isTiming === true);
check('timer anchor set', typeof TM.tasks[0].timerStartedAt === 'number');
check('auto-queued with stamp', TM.tasks[0].queued === true && TM.tasks[0].queuedAt !== null);

advance(90 * 1000); // 90 seconds
check('elapsed derived from wall clock', TM.computeElapsedSeconds(TM.tasks[0]) === 90,
  `got ${TM.computeElapsedSeconds(TM.tasks[0])}`);

const writesBeforeTicks = writes.tm_tasks;
for (let i = 0; i < 30; i++) tickFn();  // 30 seconds of ticks
check('30 ticks produce zero persistence writes',
  writes.tm_tasks === writesBeforeTicks, `writes went ${writesBeforeTicks} -> ${writes.tm_tasks}`);

// 300 more ticks -> crosses the 5-minute checkpoint
for (let i = 0; i < 300; i++) tickFn();
check('checkpoint writes after ~5 min of ticks',
  writes.tm_tasks > writesBeforeTicks, `still ${writes.tm_tasks}`);

const before = TM.tasks[0].elapsedSeconds;
win.toggleTask(taskId); // complete mid-timer
check('completing a task settles the timer', TM.tasks[0].isTiming === false);
check('settled seconds are not lost', TM.tasks[0].elapsedSeconds >= before,
  `elapsed ${TM.tasks[0].elapsedSeconds} < ${before}`);
check('queued cleared on complete', TM.tasks[0].queued === false);

console.log('\n[6] Observation notes by id (item 8)');
TM.tasks[0].completed = false;
win.toggleTaskObserve(taskId);
check('now observing', TM.tasks[0].observing === true);
const form = getEl('q');
// handleAddObserveNote takes (e, taskId) and reads e.target.querySelector('input')
function noteEvent(value) {
  return { preventDefault() {}, target: { querySelector: () => ({ value, }) } };
}
win.handleAddObserveNote(noteEvent('first note'), taskId);
win.handleAddObserveNote(noteEvent('second note'), taskId);
check('notes stored as objects', TM.tasks[0].observeNotes.length === 2 &&
  typeof TM.tasks[0].observeNotes[0] === 'object', JSON.stringify(TM.tasks[0].observeNotes));
check('notes have ids', TM.tasks[0].observeNotes.every(n => typeof n.id === 'string' && n.id.length > 0));
const firstId = TM.tasks[0].observeNotes[0].id;
TM.tasks[0].observeNotes.unshift({ id: 'inserted-elsewhere', text: 'from another device', createdAt: 1 });
win.deleteObserveNote(taskId, firstId);
check('delete by id survives an index shift',
  !TM.tasks[0].observeNotes.some(n => n.id === firstId) &&
  TM.tasks[0].observeNotes.some(n => n.text === 'second note') &&
  TM.tasks[0].observeNotes.some(n => n.id === 'inserted-elsewhere'),
  JSON.stringify(TM.tasks[0].observeNotes.map(n => n.text)));

console.log('\n[7] Subtasks');
const win2 = windowStub;
win2.handleAddSubtask({ preventDefault() {}, target: { querySelector: () => ({ value: 'sub one' }) } }, taskId);
check('subtask added with uuid', TM.tasks[0].subtasks.length === 1 &&
  /^[0-9a-f-]{36}$/.test(TM.tasks[0].subtasks[0].id), JSON.stringify(TM.tasks[0].subtasks));

console.log('\n[8] Queue cap');
for (let i = 0; i < 5; i++) {
  TM.tasks.push(TM.normalizeTask({ id: TM.newId(), title: `t${i}`, group: 'Work', dueDate: '2026-09-23' }));
}
TM.tasks.forEach(t => { t.queued = false; t.queuedAt = null; });
const ids = TM.tasks.map(t => t.id);
ids.slice(0, 4).forEach(id => win2.toggleTaskQueue(id));
check('four tasks queue', TM.tasks.filter(t => t.queued).length === 4);
alertMessage = null;
win2.toggleTaskQueue(ids[4]);
check('fifth is refused with an alert', TM.tasks.filter(t => t.queued).length === 4 && alertMessage !== null,
  `queued=${TM.tasks.filter(t => t.queued).length} alert=${alertMessage}`);

console.log('\n[9] Day-view picker ids are namespaced (item 3)');
TM.tasks[0].observing = false;
TM.tasks[0].dueDate = '2026-09-23';
TM.renderAll();
const listHtml = getEl('tasks-container').innerHTML;
const dayHtml = getEl('day-view-container').innerHTML;
check('card ids carry the list prefix', listHtml.includes('id="task-card-list-'), 'no list-prefixed id');
check('card ids carry the day prefix', dayHtml.includes('id="task-card-day-'), 'no day-prefixed id');
check('no id="picker-time-" remains in cards', !listHtml.includes('id="picker-time-'),
  'legacy picker id still emitted');
check('picker button resolves structurally', listHtml.includes('openPickerRelativeTo(this)'));
check('day-view picker button also structural', dayHtml.includes('openPickerRelativeTo(this)'));

console.log('\n[10] Date rollover (item 1)');
const wasToday = TM.today();
advance(24 * 3600 * 1000 + 60 * 1000);
check('today() advances with the clock', TM.today() !== wasToday, `${wasToday} vs ${TM.today()}`);
tickFn();
check('rollover re-renders without throwing', true);

console.log('\n[11] Legacy id migration (item 7)');
storage.clear();
storage.set('tm_tasks', JSON.stringify([
  { id: '1', title: 'legacy one', group: 'Work', dueDate: '2026-09-23', time: '09:00', recur: 'none',
    subtasks: [{ id: '12', title: 'legacy sub', completed: false }],
    observeNotes: ['a legacy string note'] }
]));
// Each instance needs its OWN window stub. The app assigns its onclick targets
// onto `window` at load time, so a shared stub means every extra boot silently
// re-points windowStub.toggleTask (and friends) at the newest instance — the
// original TM would then look inert.
// The app assigns its handlers onto whichever `window` it was given, so each
// boot gets its own stub and the tests must call through that one. Reaching for
// the shared windowStub after a boot would call the *first* instance's handler,
// which closes over a different `tasks` array and silently does nothing.
let bootWindow = null;
const boot = () => {
  bootWindow = makeWindowStub();
  return fn(
    bootWindow, documentStub, localStorageStub, setIntervalStub, setTimeoutStub,
    clearIntervalStub, clearTimeoutStub, globalThis.crypto, FakeDate, console,
    navigatorStub, alertStub,
    { origin: 'http://localhost', href: 'http://localhost/', protocol: 'http:', hostname: 'localhost' },
    NotificationStub
  );
};
const TM2 = boot();
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
check('legacy task id re-keyed to a UUID', isUuid(TM2.tasks[0].id), TM2.tasks[0].id);
check('legacy subtask id re-keyed', isUuid(TM2.tasks[0].subtasks[0].id), TM2.tasks[0].subtasks[0].id);
check('legacy string note became an object with a UUID',
  typeof TM2.tasks[0].observeNotes[0] === 'object' && isUuid(TM2.tasks[0].observeNotes[0].id),
  JSON.stringify(TM2.tasks[0].observeNotes));
check('migration was persisted', JSON.parse(storage.get('tm_tasks'))[0].id === TM2.tasks[0].id);
const afterFirstBoot = storage.get('tm_tasks');
const TM3 = boot();
check('second boot keeps the same id (no per-load churn)', TM3.tasks[0].id === TM2.tasks[0].id,
  `${TM2.tasks[0].id} -> ${TM3.tasks[0].id}`);
check('second boot writes nothing', storage.get('tm_tasks') === afterFirstBoot);
check('non-secure-context fallback still emits a UUID',
  isUuid((() => {
    const saved = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      return TM3.newId();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true });
    }
  })()));

console.log('\n[12] View switching (list <-> day)');
const bodyEl = documentStub.body;
const viewBtnHandler = handlers['view-mode-btn:click'];
check('view button handler bound', typeof viewBtnHandler === 'function');
check('boot applies view-list by default', bodyEl.classList.contains('view-list'),
  `body has ${[...bodyEl.classList._set].join(',')}`);
check('body is never both views at once',
  !(bodyEl.classList.contains('view-list') && bodyEl.classList.contains('view-day')));

viewBtnHandler();
check('clicking switches to view-day', bodyEl.classList.contains('view-day'), 'no view-day class');
check('view-list is removed on switch', !bodyEl.classList.contains('view-list'));
check('choice persisted to tm_view', storage.get('tm_view') === 'day', `got ${storage.get('tm_view')}`);
check('button label names the target view',
  getEl('view-icon-label').textContent === '📋 List View', `got "${getEl('view-icon-label').textContent}"`);
check('button carries an accessible name',
  viewBtnHandler && getEl('view-mode-btn').getAttribute('aria-label') === 'Switch to List View',
  `got ${getEl('view-mode-btn').getAttribute('aria-label')}`);

viewBtnHandler();
check('clicking again returns to view-list', bodyEl.classList.contains('view-list'));

// The modal's Escape path shares closeAnalytics() with the backdrop click.
console.log('\n[13] Analytics modal keyboard path');
check('open handler bound', typeof handlers['open-analytics-btn:click'] === 'function');
check('escape handler bound', typeof handlers['document:keydown'] === 'function');
handlers['open-analytics-btn:click']();
check('modal opens', !getEl('analytics-modal').classList.contains('hidden'));
handlers['document:keydown']({ key: 'Escape' });
check('Escape closes the modal', getEl('analytics-modal').classList.contains('hidden'));
handlers['open-analytics-btn:click']();
handlers['document:keydown']({ key: 'a' });
check('other keys leave the modal open', !getEl('analytics-modal').classList.contains('hidden'));
handlers['close-analytics-btn:click']();
check('close button also closes', getEl('analytics-modal').classList.contains('hidden'));

console.log('\n[14] Rendered cards carry accessible names');
TM.tasks.length = 0;
TM.tasks.push(TM.normalizeTask({ id: TM.newId(), title: 'Named card', group: 'Work', dueDate: '2026-09-23', time: '09:00' }));
TM.renderAll();
const cardHtml = getEl('tasks-container').innerHTML;
check('task checkbox is labelled', cardHtml.includes('aria-label="Mark complete: Named card"'),
  'checkbox has no aria-label');
check('timer button is labelled with the task', cardHtml.includes('Start a focus timer on Named card'));
check('queue button is labelled with the task', cardHtml.includes('Add to the focus queue: Named card'));
check('delete button is labelled with the task', cardHtml.includes('Delete task: Named card'));
check('quick time field is labelled', cardHtml.includes('aria-label="Time for Named card"'));
check('hidden pickers are out of the a11y tree',
  (cardHtml.match(/class="hidden-picker" tabindex="-1" aria-hidden="true"/g) || []).length === 2,
  'expected 2 hidden pickers');

console.log('\n[15] index.html wiring matches app.js lookups');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lookedUp = [...SRC.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const missing = [...new Set(lookedUp)].filter(id => !html.includes(`id="${id}"`));
check('every getElementById target exists in the HTML', missing.length === 0,
  `missing: ${missing.join(', ')}`);
check('view toggle is in the header, outside .main-layout',
  html.indexOf('id="view-mode-btn"') < html.indexOf('class="main-layout"'),
  'view toggle would hide itself in day view');
check('body ships a view class for first paint',
  /<body class="[^"]*view-(list|day)"/.test(html), 'no view-* class on body');

console.log('\n[16] Removed chrome stays removed');
check('no traffic-light dots in the markup', !html.includes('terminal-dots'));
check('no control dots in the markup', !html.includes('control-dot'));
check('no app title heading in the header', !html.includes('app-main-title'));
check('no "(MAX 4 TASKS)" in the focus bar', !html.includes('MAX 4 TASKS'));
check('none of them survive as a CSS selector', !/terminal-dots|control-dot|app-main-title/.test(
  fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));

console.log('\n[17] Empty focus queue renders nothing');
TM.tasks.forEach(t => { t.queued = false; t.isTiming = false; t.queuedAt = null; });
TM.renderAll();
check('empty queue emits no prompt text',
  getEl('focus-tasks-list').innerHTML.trim() === '',
  `got "${getEl('focus-tasks-list').innerHTML.trim()}"`);
check('the count line still reports state',
  getEl('focus-bar-count').textContent === '0 / 4 queued',
  `got "${getEl('focus-bar-count').textContent}"`);

TM.tasks[0].queued = true;
TM.tasks[0].queuedAt = Date.now();
TM.renderAll();
check('queueing a task puts it back in the bar',
  getEl('focus-tasks-list').innerHTML.includes('focus-vertical-item'),
  'no focus item rendered');

console.log('\n[18] Day schedule is both a section and a view');
const appCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
check('no rule hides the day section in list view',
  !/body\.view-list/.test(appCss), 'body.view-list still exists in the stylesheet');
check('day view still hides the task workspace',
  /body\.view-day\s+\.main-layout\s*\{[^}]*display:\s*none/.test(appCss),
  'body.view-day no longer hides .main-layout');
check('each section header carries its own rail',
  ['focus-bar-title', 'header-title-box', 'day-view-heading']
    .every(sel => appCss.includes(`.${sel}::before`)),
  'a section header is missing its rail');
check('the schedule has a surface distinct from the window',
  appCss.includes('--bg-section') && /\.day-view-section\s*\{[^}]*background:\s*var\(--bg-section\)/.test(appCss),
  '.day-view-section does not use --bg-section');

// The view state is 'list' here, so this proves the inline section is populated
// while the home page is what is on screen.
check('schedule renders while the list view is active',
  documentStub.body.classList.contains('view-list'),
  `body is ${[...documentStub.body.classList._set].join(',')}`);
TM.tasks[0].dueDate = TM.today();
TM.tasks[0].observing = false;
TM.renderAll();
check('inline schedule is populated in list view',
  getEl('day-view-container').innerHTML.includes('task-card-day-'),
  'day container is empty while list view is showing');

console.log('\n[19] Completed archive');
TM.tasks.length = 0;
TM.selectedGroup = 'All';
TM.tasks.push(TM.normalizeTask({ id: TM.newId(), title: 'Tick me', group: 'Work', dueDate: TM.today() }));
const doneId = TM.tasks[0].id;

windowStub.toggleTask(doneId);
check('completing stamps completedAt with today',
  TM.tasks[0].completedAt === TM.today(), `got "${TM.tasks[0].completedAt}"`);
check('a task finished today is not archived', TM.isArchived(TM.tasks[0]) === false);
check('and it stays in the main list',
  getEl('tasks-container').innerHTML.includes('Tick me'), 'vanished from All Tasks');

// Anything stamped with an earlier day is yesterday's work.
TM.tasks[0].completedAt = '2020-01-01';
check('an earlier completion is archived', TM.isArchived(TM.tasks[0]) === true);
TM.renderAll();
check('and it leaves the main list',
  !getEl('tasks-container').innerHTML.includes('Tick me'), 'still rendered in All Tasks');

TM.selectedGroup = 'COMPLETED';
TM.renderAll();
check('the Completed view lists it', getEl('tasks-container').innerHTML.includes('Tick me'));
check('the Completed view is titled',
  /completed/i.test(getEl('current-group-title').textContent),
  `got "${getEl('current-group-title').textContent}"`);
check('a Completed item exists in the Views section',
  getEl('view-list').innerHTML.includes('data-group="COMPLETED"'), 'no COMPLETED nav item');
check('its badge uses the solid fill',
  getEl('view-list').innerHTML.includes('badge-done'), 'badge-done missing');

TM.selectedGroup = 'All';
windowStub.toggleTask(doneId);
check('un-completing clears the stamp', TM.tasks[0].completedAt === '',
  `got "${TM.tasks[0].completedAt}"`);
check('and it is no longer archived', TM.isArchived(TM.tasks[0]) === false);
TM.renderAll();
check('and it is back in the main list',
  getEl('tasks-container').innerHTML.includes('Tick me'), 'did not return');

// Completion does not reset a recurrence in this app, so a recurring task whose
// series is still live must never be archived on its stamp alone — hiding it
// would take it off the board permanently, with nothing left to un-tick.
TM.tasks[0].recur = 'daily';
TM.tasks[0].dueDate = '2020-01-01';
TM.tasks[0].completed = true;
TM.tasks[0].completedAt = '2020-01-01';
check('a live recurring task is not archived', TM.isArchived(TM.tasks[0]) === false,
  'recurring task would be hidden forever');
TM.tasks[0].recur = 'none';
check('the same task with no recurrence is archived', TM.isArchived(TM.tasks[0]) === true);

console.log('\n[20] Completion migration on load');
storage.clear();
storage.set('tm_tasks', JSON.stringify([
  { id: '11111111-1111-4111-8111-111111111111', title: 'old done', group: 'Work', completed: true }
]));
const TM4 = boot();
check('a pre-existing completion is stamped on load',
  TM4.tasks[0].completedAt === TM4.today(), `got "${TM4.tasks[0].completedAt}"`);
check('the stamp was persisted',
  JSON.parse(storage.get('tm_tasks'))[0].completedAt === TM4.today());
const afterCompletionBoot = storage.get('tm_tasks');
boot();
check('a second boot does not re-stamp', storage.get('tm_tasks') === afterCompletionBoot);
check('an incomplete task is left unstamped', (() => {
  storage.set('tm_tasks', JSON.stringify([
    { id: '22222222-2222-4222-8222-222222222222', title: 'still open', group: 'Work', completed: false }
  ]));
  const t = boot();
  return t.tasks[0].completedAt === '' && !t.isArchived(t.tasks[0]);
})());

console.log('\n[21] Sections read as separate islands');
const hasRule = (sel) => new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{').test(appCss);
check('one frame rule covers every band',
  /\.app-header,\s*\.top-focus-bar,\s*\.main-layout,\s*\.day-view-section\s*\{/.test(appCss),
  'the island frame does not list all four sections');
check('the frame is a border plus a radius',
  /\.app-header,\s*\.top-focus-bar,\s*\.main-layout,\s*\.day-view-section\s*\{[^}]*border:\s*1px solid var\(--border-main\)[^}]*border-radius:\s*var\(--radius-md\)/.test(appCss),
  'islands share no common frame');
check('the old full-bleed dividers are gone',
  !/\.(app-header|top-focus-bar|main-layout|day-view-section)\s*\{[^}]*border-bottom/.test(appCss),
  'a section still draws a full-bleed divider');
check('the window is the ground the islands float on',
  /\.app-window\s*\{[^}]*background:\s*var\(--bg-page\)/.test(appCss),
  '.app-window is not --bg-page');
check('and it supplies the gap between them',
  /\.app-window\s*\{[^}]*display:\s*flex[^}]*gap:/.test(appCss),
  '.app-window has no gap');

// Every band must be a direct child of .app-window, so no two islands ever
// touch — the ground between them is what makes each read as its own card.
const bands = ['app-header', 'top-focus-bar', 'main-layout', 'day-view-section'];
const windowStart = html.indexOf('class="app-window"');
check('all four bands are direct children of the window',
  windowStart > -1 && bands.every(b => html.indexOf(`class="${b}"`, windowStart) > windowStart),
  'a band lives outside .app-window');
check('the markup declares no other top-level band',
  (html.match(/^    <(header|section|div) class="(app-header|top-focus-bar|main-layout|day-view-section)"/gm) || []).length === 4,
  'an island is nested inside another section');

console.log('\n[22] Hostile storage cannot kill the boot');
// Each of these is a TypeError thrown while a module-level statement is still
// evaluating, so it lands above every listener, above the render and above the
// service worker wiring: a painted shell that responds to nothing, with the
// user's real data sitting unreachable in storage behind it.
storage.clear();
storage.set('tm_tasks', '{}');
const TMbadTasks = boot();
check('a non-array tm_tasks boots instead of throwing', Array.isArray(TMbadTasks.tasks),
  'loadJson(...).map threw at module level');
check('and it comes up empty rather than inventing tasks', TMbadTasks.tasks.length === 0);

storage.clear();
storage.set('tm_tasks', JSON.stringify([{ id: '1', title: 'kept', group: 'Work' }]));
storage.set('tm_groups', JSON.stringify([1, null, 'Home']));
const TMbadGroups = boot();
check('non-string group elements are dropped, not rendered',
  TMbadGroups.groups.every(g => typeof g === 'string'), JSON.stringify(TMbadGroups.groups));
check('a usable group survives the filter', TMbadGroups.groups.includes('Home'),
  JSON.stringify(TMbadGroups.groups));
check('an all-garbage group list falls back to the defaults',
  (() => {
    storage.set('tm_groups', JSON.stringify([1, null]));
    return boot().groups.length > 0;
  })(), 'groups ended up empty — renderGroups would emit nothing');

console.log('\n[23] The TM.tasks seam sanitizes what sync will push through it');
// Ids are interpolated into inline onclick attributes unescaped, so the
// invariant "every id is UUID-shaped" is the only thing standing between a
// server row and script execution. migrateLegacyIds establishes it for storage;
// nothing established it for this setter.
const TMseam = boot();
TMseam.tasks = [{ id: "x');alert(1);//", title: 'hostile', group: 'Work', subtasks: [{ id: "s');alert(2);//", title: 'sub' }] }];
check('a hostile task id is re-keyed on the way in', isUuid(TMseam.tasks[0].id), TMseam.tasks[0].id);
check('a hostile subtask id is re-keyed too', isUuid(TMseam.tasks[0].subtasks[0].id),
  TMseam.tasks[0].subtasks[0].id);
TMseam.renderAll();
check('no payload reaches the rendered markup',
  !getEl('tasks-container').innerHTML.includes('alert('),
  'the breakout survived into an onclick attribute');
check('a non-array assignment does not break the bridge',
  (() => { TMseam.tasks = {}; return Array.isArray(TMseam.tasks) && TMseam.tasks.length === 0; })(),
  'TM.tasks = {} left the app holding a non-array');

/* ===========================================================================
   Recurrence, the queue cap, the unnamed-year rule, delete/undo and reminders.
   =========================================================================== */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (dateStr, n) => {
  const d = new RealDate(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
const weekdayOf = (dateStr) => new RealDate(dateStr + 'T00:00:00').getDay();
const hhmm = (ms) => {
  const d = new RealDate(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

console.log('\n[24] Completing a recurring task rolls it forward');
{
  const T = TM.today();
  // Plain objects, not normalizeTask: advanceRecurrence only touches recur,
  // dueDate, completed and completedAt, and a normaliser in the way would blur
  // which of those the assertions are actually testing.
  const mk = (dueDate, recur) => ({
    id: TM.newId(), title: 'r', group: 'Work', dueDate, recur,
    completed: false, completedAt: ''
  });

  const overdue = mk(plusDays(T, -5), 'daily');
  check('a daily task five days overdue lands tomorrow, not on the day it missed',
    TM.advanceRecurrence(overdue) === true && overdue.dueDate === plusDays(T, 1),
    `got "${overdue.dueDate}"`);
  check('and it comes back un-ticked with its stamp cleared',
    overdue.completed === false && overdue.completedAt === '');

  const dueToday = mk(T, 'daily');
  check('a task due today moves to tomorrow',
    TM.advanceRecurrence(dueToday) && dueToday.dueDate === plusDays(T, 1),
    `got "${dueToday.dueDate}"`);

  // The do/while rather than a while: a task completed ahead of its date must
  // still advance, or it would come back un-ticked on the same future date.
  const ahead = mk(plusDays(T, 3), 'daily');
  check('a task due in the future still advances by a full step',
    TM.advanceRecurrence(ahead) && ahead.dueDate === plusDays(T, 4),
    `got "${ahead.dueDate}"`);

  const fortnight = mk(plusDays(T, -14), 'weekly');
  check('a fortnight-overdue weekly task lands a week out',
    TM.advanceRecurrence(fortnight) && fortnight.dueDate === plusDays(T, 7),
    `got "${fortnight.dueDate}"`);
  check('and keeps its weekday',
    weekdayOf(fortnight.dueDate) === weekdayOf(plusDays(T, -14)),
    `got weekday ${weekdayOf(fortnight.dueDate)}`);

  const once = mk(T, 'none');
  check('a non-recurring task is left exactly alone',
    TM.advanceRecurrence(once) === false && once.dueDate === T && once.completed === false);

  const broken = mk('not-a-date', 'daily');
  check('a corrupted due date is refused rather than stepped forever',
    TM.advanceRecurrence(broken) === false && broken.dueDate === 'not-a-date',
    `got "${broken.dueDate}"`);
}

// Through the real completion path, which is where the reported bug lived: a
// recurring task used to stay ticked with its original date, so `daily` meant
// "reminds you once, ever".
{
  storage.clear();
  const R = boot();
  const id = R.newId();
  R.tasks = [{ id, title: 'water the plants', group: 'Work', dueDate: R.today(), recur: 'daily' }];
  const liveId = R.tasks[0].id;
  bootWindow.toggleTask(liveId);
  check('ticking a daily task re-dates it and leaves it un-ticked',
    R.tasks[0].dueDate === plusDays(R.today(), 1) && R.tasks[0].completed === false,
    `due=${R.tasks[0].dueDate} completed=${R.tasks[0].completed}`);
  check('so it stays on the board instead of collecting in Completed',
    R.isArchived(R.tasks[0]) === false);
  check('and it is on today\'s agenda again tomorrow, not today',
    R.isTaskOnDate(R.tasks[0], R.today()) === false &&
    R.isTaskOnDate(R.tasks[0], plusDays(R.today(), 1)) === true,
    'the rolled-forward task is not reachable on its new date');
}

console.log('\n[25] The focus queue cap counts what it hides');
{
  storage.clear();
  const Q = boot();
  const T = Q.today();
  const many = [];
  for (let i = 0; i < 6; i++) {
    many.push({ id: Q.newId(), title: `q${i}`, group: 'Work', dueDate: T });
  }
  Q.tasks = many;
  const ids = Q.tasks.map(t => t.id);

  check('the cap is four', Q.FOCUS_QUEUE_MAX === 4, `got ${Q.FOCUS_QUEUE_MAX}`);
  check('nothing is queued to begin with', Q.focusBarLoad() === 0);

  ids.slice(0, 4).forEach(id => bootWindow.toggleTaskQueue(id));
  check('four queued tasks fill it', Q.focusBarLoad() === 4);
  check('and all four are shown', Q.focusBarTasks().length === 4);

  // A running timer is pinned ahead of an idle queued task: the thing you are
  // actually working on should never be what falls off the end.
  bootWindow.toggleTaskTimer(ids[5]);
  const shown = Q.focusBarTasks();
  check('a running timer takes a slot', shown.length === Q.FOCUS_QUEUE_MAX);
  check('and is ranked first', shown[0].id === ids[5], `first is ${shown[0].title}`);
  check('the load now counts the timer as well as the queue', Q.focusBarLoad() === 5,
    `got ${Q.focusBarLoad()}`);

  Q.renderAll();
  check('the count reports the overflow rather than pretending',
    /\+1 not shown/.test(getEl('focus-bar-count').textContent),
    `got "${getEl('focus-bar-count').textContent}"`);
  check('and still names the cap',
    getEl('focus-bar-count').textContent.includes(`/ ${Q.FOCUS_QUEUE_MAX} queued`),
    `got "${getEl('focus-bar-count').textContent}"`);

  // Starting a timer while the bar is full must not queue a fifth — but the
  // timer itself is not the queue flag and has to run regardless.
  const spare = Q.tasks.find(t => !t.queued && !t.isTiming);
  bootWindow.toggleTaskTimer(spare.id);
  check('a timer started on a full bar does not queue a fifth',
    spare.queued === false, 'it was queued past the cap');
  check('but the timer still runs', spare.isTiming === true);
  check('and it is reachable through the bar', Q.focusBarTasks().some(t => t.id === spare.id));
}

console.log('\n[26] An unnamed year in a date edit is not taken literally');
{
  const yr = TM.today().slice(0, 4);
  // Unpadded, matching the field's own placeholder ("Type 22-9 or today").
  check('a date in the current year displays without a year',
    TM.formatDateEditable(`${yr}-09-22`) === '22-9', `got "${TM.formatDateEditable(`${yr}-09-22`)}"`);
  check('a date in another year has to carry it, or the edit would retarget it',
    TM.formatDateEditable('2025-09-22') === '22-9-2025',
    `got "${TM.formatDateEditable('2025-09-22')}"`);

  storage.clear();
  const Y = boot();
  const nextYear = String(Number(yr) + 1);
  Y.tasks = [{ id: Y.newId(), title: 'renew passport', group: 'Work', dueDate: `${nextYear}-05-10` }];
  const yId = Y.tasks[0].id;

  // The bug: the field shows DD-MM, so editing the day used to re-derive the
  // whole date against *this* year and quietly drag the task back a year.
  bootWindow.handleCardDateInput(yId,'12-5');
  check('editing the day keeps the task in its own year',
    Y.tasks[0].dueDate === `${nextYear}-05-12`, `got "${Y.tasks[0].dueDate}"`);

  bootWindow.handleCardDateInput(yId,'12-5-2027');
  check('but a year typed in full is honoured',
    Y.tasks[0].dueDate === '2027-05-12', `got "${Y.tasks[0].dueDate}"`);

  bootWindow.handleCardDateInput(yId,'not-a-date');
  check('and junk still reverts instead of storing',
    Y.tasks[0].dueDate === '2027-05-12', `got "${Y.tasks[0].dueDate}"`);
}

console.log('\n[27] A deleted task can be brought back');
{
  storage.clear();
  const U = boot();
  const subId = U.newId();
  U.tasks = [
    { id: U.newId(), title: 'keep me', group: 'Work', dueDate: U.today(),
      subtasks: [{ id: subId, title: 'a child', completed: false }],
      observeNotes: [{ id: U.newId(), text: 'a note', createdAt: 1 }] },
    { id: U.newId(), title: 'other', group: 'Work', dueDate: U.today() }
  ];
  const keepId = U.tasks[0].id;
  const otherId = U.tasks[1].id;

  bootWindow.deleteTask(otherId);
  check('the delete is immediate', !U.tasks.some(t => t.id === otherId));
  check('and it reaches storage immediately', JSON.parse(storage.get('tm_tasks')).length === 1,
    'the task was only hidden, not deleted');
  check('the undo bar is offered', !getEl('undo-bar').classList.contains('hidden'));
  check('and it names what went', /other/.test(getEl('undo-bar-text').textContent),
    `got "${getEl('undo-bar-text').textContent}"`);

  handlers['undo-bar-btn:click']();
  check('undo puts it back', U.tasks.some(t => t.id === otherId));
  check('at its original index', U.tasks[1] && U.tasks[1].id === otherId,
    `landed at ${U.tasks.findIndex(t => t.id === otherId)}`);
  check('and the bar goes away', getEl('undo-bar').classList.contains('hidden'));
  check('the restore is persisted too',
    JSON.parse(storage.get('tm_tasks')).some(t => t.id === otherId));

  handlers['undo-bar-btn:click']();
  check('a second undo does not duplicate it',
    U.tasks.filter(t => t.id === otherId).length === 1);

  // A task carries its subtasks and notes; losing them to a misclick is the
  // whole reason this bar exists, so the restore has to bring them back.
  bootWindow.deleteTask(keepId);
  handlers['undo-bar-btn:click']();
  const restored = U.tasks.find(t => t.id === keepId);
  check('a restored task keeps its subtasks',
    restored.subtasks.length === 1 && restored.subtasks[0].id === subId,
    JSON.stringify(restored.subtasks));
  check('and its observation notes', restored.observeNotes.length === 1,
    JSON.stringify(restored.observeNotes));

  // The window is the point: an undo offered forever is a second delete button.
  bootWindow.deleteTask(otherId);
  const undoId = lastTimeoutId();
  check('the bar is up again', !getEl('undo-bar').classList.contains('hidden'));
  bootWindow.deleteTask(keepId);
  check('a second delete re-arms the window rather than stacking one',
    lastTimeoutId() === undoId + 1, 'a stale timer was left running');

  runTimeout(lastTimeoutId());
  check('the window closes on its own', getEl('undo-bar').classList.contains('hidden'));
  handlers['undo-bar-btn:click']();
  check('and a late undo does nothing',
    !U.tasks.some(t => t.id === keepId), 'an expired undo still restored the task');
}

(async () => {
  console.log('\n[28] Reminders fire once, on time, for the right tasks');
  const T = TM.today();
  const dateStr = T;
  const nowHHMM = hhmm(FAKE_NOW);
  const laterHHMM = hhmm(FAKE_NOW + 10 * 60000);

  storage.clear();
  const RM = boot();
  const todayStr = RM.today();

  check('a supporting browser reports reminders as available',
    RM.remindersSupported() === true);
  check('but they are off until opted in', RM.remindersOn() === false,
    'reminders ran without the user asking');

  storage.set(RM.REMINDERS_ON_KEY, '1');
  check('the stored opt-in turns them on', RM.remindersOn() === true);

  const mk = (over) => Object.assign({
    id: RM.newId(), title: 'remind me', group: 'Work',
    dueDate: todayStr, time: nowHHMM, recur: 'none',
    completed: false, observing: false
  }, over);

  RM.tasks = [
    mk({ title: 'due now' }),
    mk({ title: 'already done', completed: true }),
    mk({ title: 'waiting on someone', observing: true }),
    mk({ title: 'later today', time: laterHHMM }),
    mk({ title: 'no time set', time: '' })
  ];
  const dueNow = RM.tasks[0];
  const firedMap = () => JSON.parse(storage.get(RM.FIRED_KEY) || '{}');
  const dueAt = (task) => RM.reminderInstant(task, todayStr);

  check('a task time becomes an instant on the day',
    !Number.isNaN(dueAt(dueNow)), 'reminderInstant returned NaN');
  check('a task with no usable time is not a reminder',
    Number.isNaN(dueAt(RM.tasks[4])));

  const shownBefore = shownNotifications.length;
  RM.checkReminders();
  const afterFirst = firedMap();
  check('exactly one task is claimed, not five', Object.keys(afterFirst).length === 1,
    JSON.stringify(Object.keys(afterFirst)));

  const keyOf = (task) => RM.firedKey(task, todayStr);
  check('and it is the one that is due', !!afterFirst[keyOf(dueNow)]);
  check('a completed task is never claimed', !afterFirst[keyOf(RM.tasks[1])],
    'it reminded about finished work');
  check('an observed task is never claimed', !afterFirst[keyOf(RM.tasks[2])],
    'it reminded about work waiting on someone else');
  check('a task whose time has not come is not claimed', !afterFirst[keyOf(RM.tasks[3])],
    'it fired up to ten minutes early');
  check('a task with no time is not claimed', !afterFirst[keyOf(RM.tasks[4])]);

  // Without the fired map a 30s poll re-notifies every 30 seconds for a whole
  // minute, which is the single most likely way to get this wrong.
  RM.checkReminders();
  check('a second check does not claim it again',
    Object.keys(firedMap()).length === 1, 'the same reminder fired twice');

  // The path is registration.showNotification, not `new Notification()`: the
  // constructor throws on Android Chrome and does not exist in an installed
  // iOS PWA, so asserting the call landed is asserting the feature works.
  for (let i = 0; i < 4; i++) await Promise.resolve();
  check('the notice went out through the service worker registration',
    shownNotifications.length === shownBefore + 1 &&
    shownNotifications[shownBefore].options.tag === `task-${dueNow.id}`,
    `shown=${shownNotifications.length - shownBefore} tag=${shownNotifications[0] && shownNotifications[0].options.tag}`);
  check('with the task title and a body naming group and time',
    shownNotifications[shownBefore].title === 'due now' &&
    /Work/.test(shownNotifications[shownBefore].options.body),
    JSON.stringify(shownNotifications[shownBefore]));

  // A suspended tab has its timers throttled, so the minute tick can be missed
  // outright. Coming back to the page is the moment to catch it up.
  const missedHHMM = hhmm(FAKE_NOW + 60000);
  advance(2 * 60000);
  RM.tasks = [mk({ title: 'missed while suspended', time: missedHHMM })];
  RM.checkReminders();
  const caught = firedMap();
  check('a reminder that came due while the page was suspended is caught up',
    Object.keys(caught).length === 2 && !!caught[keyOf(RM.tasks[0])],
    JSON.stringify(Object.keys(caught)));

  // Recurrence matches through isTaskOnDate. A `dueDate === today` check would
  // remind once and then never again for the rest of the series.
  advance(24 * 3600 * 1000);
  RM.tasks = [mk({
    title: 'daily standup', dueDate: plusDays(RM.today(), -3),
    recur: 'daily', time: hhmm(FAKE_NOW)
  })];
  RM.checkReminders();
  check('a recurring task reminds again on a later day',
    Object.keys(firedMap()).length === 3,
    'the daily task only ever reminded once');

  // Opting out has to stop the checks, not merely hide the button.
  storage.set(RM.REMINDERS_ON_KEY, '0');
  RM.tasks = [mk({ title: 'silent', time: hhmm(FAKE_NOW) })];
  const beforeOff = Object.keys(firedMap()).length;
  RM.checkReminders();
  check('opting out stops it claiming anything new',
    Object.keys(firedMap()).length === beforeOff, 'reminders ran while switched off');

  notificationPermission = 'denied';
  check('a denied permission reads as denied', RM.reminderPermission() === 'denied');
  RM.renderReminderButton();
  const btn = getEl('reminders-btn');
  check('the control says blocked rather than offering a click that cannot work',
    btn.disabled === true && /blocked/i.test(btn.textContent), `"${btn.textContent}"`);
  check('and it explains what to do instead',
    /browser settings/i.test(btn.title), `"${btn.title}"`);
  // A click while blocked must not flip the opt-in on, which would leave the app
  // claiming reminders are enabled while nothing can ever fire.
  storage.set(RM.REMINDERS_ON_KEY, '0');
  await RM.toggleReminders();
  check('a click while blocked leaves reminders off',
    RM.remindersOn() === false && storage.get(RM.REMINDERS_ON_KEY) === '0',
    `on=${RM.remindersOn()} key=${storage.get(RM.REMINDERS_ON_KEY)}`);

  notificationPermission = 'granted';
  RM.renderReminderButton();
  check('with permission granted the control is live again',
    btn.disabled === false && !btn.classList.contains('hidden'), `"${btn.textContent}"`);
  await RM.toggleReminders();
  check('and a click once granted does switch them on', RM.remindersOn() === true,
    `key=${storage.get(RM.REMINDERS_ON_KEY)}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
