// --- Date & Time Parsers & Helpers ---

function getLocalDateString(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateFriendly(dateStr) {
  if (!dateStr) return 'No Date';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateDDMM(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10);
  return `${day}-${month}`;
}

function formatTime12Hour(timeStr) {
  if (!timeStr) return '';
  const [hoursStr, minutesStr] = timeStr.split(':');
  if (hoursStr === undefined || minutesStr === undefined) return timeStr;
  let hours = parseInt(hoursStr, 10);
  const minutes = minutesStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) totalSeconds = 0;
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDurationHuman(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return '0m';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m ${totalSeconds % 60}s`;
}

function parseTimeString(input) {
  if (!input || !input.trim()) return '';
  const s = input.trim().toLowerCase().replace(/\s+/g, '');

  const ampmMatch = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? ampmMatch[2].padStart(2, '0') : '00';
    const ampm = ampmMatch[3].toLowerCase();
    if (hours === 12) {
      hours = ampm === 'pm' ? 12 : 0;
    } else if (ampm === 'pm') {
      hours += 12;
    }
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  const colonMatch = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (colonMatch) {
    let hours = parseInt(colonMatch[1], 10);
    const minutes = colonMatch[2];
    if (hours >= 0 && hours < 24 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) < 60) {
      return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
  }

  const numMatch = s.match(/^(\d{1,2})$/);
  if (numMatch) {
    let hours = parseInt(numMatch[1], 10);
    if (hours >= 0 && hours < 24) {
      return `${String(hours).padStart(2, '0')}:00`;
    }
  }

  return input;
}

function parseDateString(input) {
  if (!input || !input.trim()) return '';
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const now = new Date();
  const currentYear = now.getFullYear();

  if (s === 'today') return getLocalDateString(now);
  if (s === 'tomorrow' || s === 'tmrw') {
    const tmrw = new Date(now);
    tmrw.setDate(tmrw.getDate() + 1);
    return getLocalDateString(tmrw);
  }

  const dmMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const month = parseInt(dmMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return s;

  return input;
}

function extractDateTimeFromTitle(text) {
  let title = text;
  let extractedTime = '';
  let extractedDate = '';

  const timeRegex = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;
  const timeMatch = title.match(timeRegex);
  if (timeMatch) {
    extractedTime = parseTimeString(timeMatch[1]);
    title = title.replace(timeMatch[0], '').trim();
  }

  const dateRegex = /\b(\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|today|tomorrow)\b/i;
  const dateMatch = title.match(dateRegex);
  if (dateMatch) {
    extractedDate = parseDateString(dateMatch[1]);
    title = title.replace(dateMatch[0], '').trim();
  }

  return { cleanTitle: title || text, extractedTime, extractedDate };
}

function sortTasksByDateTime(taskList) {
  return [...taskList].sort((a, b) => {
    const dateA = a.dueDate || '9999-99-99';
    const dateB = b.dueDate || '9999-99-99';
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const timeA = a.time || '99:99';
    const timeB = b.time || '99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);

    return 0;
  });
}

function sortTasksByTimeOnly(taskList) {
  return [...taskList].sort((a, b) => {
    const timeA = a.time || '99:99';
    const timeB = b.time || '99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return 0;
  });
}

// Recomputed on every call. A tab left open overnight, or a page restored from
// the bfcache, must never keep serving yesterday's date.
function today() {
  return getLocalDateString();
}

let currentViewDate = today();
let lastKnownToday = today();

// Initial State
const DEFAULT_GROUPS = ['Home', 'Work', 'Personal'];

const RECUR_VALUES = ['none', 'daily', 'weekly'];

// How many tasks the focus queue holds. Declared up here rather than beside the
// renderer that uses it, because applyUIMode() below calls renderAll() during
// boot: a `const` referenced before its declaration is a TDZ crash, and a boot
// crash lands above every listener — the app would paint once and then ignore
// every click.
const FOCUS_QUEUE_MAX = 4;

// Shape checks for parsed values. These are `const`, so they must be declared above
// every load-time caller — a function declaration hoists, but its `const` body
// dependencies do not, and referencing one early is a hard TDZ crash on boot.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// Coerces anything loaded from storage (or, from Phase 2, from the server) into
// the shape the renderers expect. `subtasks` and `observeNotes` in particular
// must never be undefined — renderTaskCardHtml reads them unguarded.
function normalizeTask(raw) {
  const t = (raw && typeof raw === 'object') ? raw : {};
  return {
    id: t.id ? String(t.id) : newId(),
    title: typeof t.title === 'string' ? t.title : '',
    group: (typeof t.group === 'string' && t.group) ? t.group : 'Personal',
    dueDate: typeof t.dueDate === 'string' ? t.dueDate : '',
    time: typeof t.time === 'string' ? t.time : '',
    recur: RECUR_VALUES.includes(t.recur) ? t.recur : 'none',
    completed: !!t.completed,
    // Local YYYY-MM-DD of the day the box was ticked, or '' when not completed.
    // The Completed view needs it to tell yesterday's work from today's.
    completedAt: typeof t.completedAt === 'string' ? t.completedAt : '',
    observing: !!t.observing,
    queued: !!t.queued,
    queuedAt: Number.isFinite(t.queuedAt) ? t.queuedAt : null,
    elapsedSeconds: Number.isFinite(t.elapsedSeconds) ? Math.max(0, Math.floor(t.elapsedSeconds)) : 0,
    isTiming: !!t.isTiming,
    timerStartedAt: Number.isFinite(t.timerStartedAt) ? t.timerStartedAt : null,
    // Notes are objects, not bare strings: deletion is by id, because deleting by
    // array index cannot survive a set-based sync (an insert on another device
    // shifts every index). Legacy string entries are migrated here.
    observeNotes: Array.isArray(t.observeNotes)
      ? t.observeNotes.map(n => (typeof n === 'string')
          ? { id: newId(), text: n, createdAt: Date.now() }
          : { id: n && n.id ? String(n.id) : newId(), text: n && typeof n.text === 'string' ? n.text : '', createdAt: n && n.createdAt ? n.createdAt : Date.now() })
      : [],
    subtasks: Array.isArray(t.subtasks)
      ? t.subtasks.map(s => ({
          id: (s && s.id) ? String(s.id) : newId(),
          title: (s && typeof s.title === 'string') ? s.title : '',
          completed: !!(s && s.completed)
        }))
      : []
  };
}

function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    console.warn(`Ignoring unreadable ${key}`, err);
    return fallback;
  }
}

// Scalars. loadJson covers the JSON keys; these three read raw strings, and
// getItem itself throws where storage is unavailable (some private modes, a site
// with storage blocked by policy). A throw here is at module level, above every
// getElementById and every addEventListener, so the app would paint and then do
// nothing at all — no handler wired, no error on screen.
function readStored(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}

// No seed data: with sync in place, a hard-coded fallback would re-upload these
// tasks from any device holding empty storage, resurrecting ones you deleted.
let groups = loadJson('tm_groups', DEFAULT_GROUPS);
// The elements, not just the container. Group names are rendered through
// .toLowerCase() in terminal mode — which is the default — so one non-string
// element throws inside renderAll(): on boot, and again on every handler that
// re-renders, leaving an app that paints once and then ignores every click.
// There is no rename or delete-group UI yet, so a bad name is unrecoverable
// from inside the app.
if (!Array.isArray(groups)) groups = [...DEFAULT_GROUPS];
groups = groups.filter(g => typeof g === 'string' && g !== '');
if (groups.length === 0) groups = [...DEFAULT_GROUPS];

// `tasks` gets the same container guard `groups` has. `.map` on a non-array is a
// TypeError thrown while this module-level statement is still evaluating, so the
// failure lands above the render, above every listener, and above the service
// worker wiring — a painted shell that responds to nothing, with the user's data
// still in storage and no way to reach it. `{}` is exactly what an empty or
// errored sync response looks like, so this is the shape Phase 3 is most likely
// to hand us.
// Set by a later script to observe every persist. Deliberately generic — this
// file must keep working with no account, offline, and from file://, so it
// knows nothing about what the observer does or whether one exists at all.
// Declared above the boot migration below, which is the first thing that can
// call saveToStorage().
let persistObserver = null;

const storedTasks = loadJson('tm_tasks', []);
let tasks = (Array.isArray(storedTasks) ? storedTasks : []).map(normalizeTask);

// A reload or a cold start ends any focus session. The elapsed time already
// folded into elapsedSeconds is kept; anything since the last checkpoint is not,
// which is why checkpoints are frequent. Without this, reopening the app next
// day would credit a full day to a timer you left running.
tasks.forEach(t => { t.isTiming = false; t.timerStartedAt = null; });

// Re-key legacy ids before anything can observe them, and backfill the stamp the
// completed-archive rule reads. saveToStorage() is defined below but function
// declarations hoist, so calling them here is safe.
const legacyIdsMigrated = migrateLegacyIds();
const completionsMigrated = migrateCompletedAt();
if (legacyIdsMigrated || completionsMigrated) saveToStorage();

let selectedGroup = 'All';

// DOM Elements
const uiModeBtn = document.getElementById('ui-mode-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = document.getElementById('theme-icon');
const viewModeBtn = document.getElementById('view-mode-btn');
const viewIconLabel = document.getElementById('view-icon-label');

const topFocusBar = document.getElementById('top-focus-bar');
const focusTasksList = document.getElementById('focus-tasks-list');
const focusBarCount = document.getElementById('focus-bar-count');

const taskTitleInput = document.getElementById('task-title-input');
const taskGroupSelect = document.getElementById('task-group-select');
const taskDateInput = document.getElementById('task-date-input');
const taskDatePickerHidden = document.getElementById('task-date-picker-hidden');
const openDatePickerBtn = document.getElementById('open-date-picker-btn');

const taskTimeInput = document.getElementById('task-time-input');
const taskTimePickerHidden = document.getElementById('task-time-picker-hidden');
const openTimePickerBtn = document.getElementById('open-time-picker-btn');

const taskRecurSelect = document.getElementById('task-recur-select');
const addTaskForm = document.getElementById('add-task-form');

const viewList = document.getElementById('view-list');
const groupList = document.getElementById('group-list');
const addGroupForm = document.getElementById('add-group-form');
const newGroupInput = document.getElementById('new-group-input');
const sidebarTotalTime = document.getElementById('sidebar-total-time');

const tasksContainer = document.getElementById('tasks-container');
const currentGroupTitle = document.getElementById('current-group-title');
const taskCount = document.getElementById('task-count');

const dayViewPicker = document.getElementById('day-view-picker');
const dayViewDateLabel = document.getElementById('day-view-date-label');
const dayViewContainer = document.getElementById('day-view-container');
const prevDayBtn = document.getElementById('prev-day-btn');
const nextDayBtn = document.getElementById('next-day-btn');
const todayBtn = document.getElementById('today-btn');

// Analytics Modal Elements
const openAnalyticsBtn = document.getElementById('open-analytics-btn');
const closeAnalyticsBtn = document.getElementById('close-analytics-btn');
const analyticsModal = document.getElementById('analytics-modal');
const analyticsBackdrop = document.getElementById('analytics-backdrop');
const analyticsContent = document.getElementById('analytics-content');

// Delete undo. Declared with the other refs so nothing below can reach it before
// it exists.
const undoBar = document.getElementById('undo-bar');
const undoBarText = document.getElementById('undo-bar-text');
const undoBarBtn = document.getElementById('undo-bar-btn');

// --- Timer Engine ---

// Elapsed time is DERIVED from a wall-clock anchor rather than incremented by a
// counter. That fixes two things at once: browsers throttle timers in background
// tabs (so a counter silently undercounts), and nothing has to be persisted per
// second. Math.max(0, ...) absorbs a backwards system-clock jump (e.g. an NTP
// correction) so elapsed can never go negative.
function computeElapsedSeconds(task) {
  const base = task.elapsedSeconds || 0;
  if (!task.timerStartedAt) return base;
  return base + Math.max(0, Math.floor((Date.now() - task.timerStartedAt) / 1000));
}

const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
let sinceCheckpointMs = 0;

// The ONLY periodic write. Folds derived time into the stored base and restarts
// the wall clock from now. 12 writes/hour per running timer instead of 3600.
function checkpointRunningTimers() {
  const now = Date.now();
  let dirty = false;
  tasks.forEach(t => {
    if (t.isTiming && t.timerStartedAt) {
      t.elapsedSeconds = computeElapsedSeconds(t);
      t.timerStartedAt = now;
      dirty = true;
    }
  });
  if (dirty) {
    sinceCheckpointMs = 0;
    saveToStorage();
  }
}

// Settles one task's derived time into its stored base. Used when a timer stops
// for ANY reason — stopping, completing, observing, or leaving the page.
function settleTaskTimer(task) {
  if (!task) return;
  if (task.isTiming && task.timerStartedAt) {
    task.elapsedSeconds = computeElapsedSeconds(task);
  }
  task.isTiming = false;
  task.timerStartedAt = null;
}

function anyTimerRunning() {
  return tasks.some(t => t.isTiming);
}

// A tab left open across midnight keeps a stale "today" until something notices.
function checkDateRollover() {
  const now = today();
  if (now === lastKnownToday) return;
  const previous = lastKnownToday;
  lastKnownToday = now;
  // Follow the day forward only if the user was looking at the day that ended.
  if (currentViewDate === previous) {
    currentViewDate = now;
    if (dayViewPicker) dayViewPicker.value = currentViewDate;
    renderDayView();
  }
  if (taskDateInput) taskDateInput.value = formatDateDDMM(now);
  renderAll();
}

setInterval(() => {
  checkDateRollover();
  if (!anyTimerRunning()) return;

  updateLiveTaskTimerLabels();   // UI only — reads, never mutates
  sinceCheckpointMs += 1000;
  if (sinceCheckpointMs >= CHECKPOINT_INTERVAL_MS) checkpointRunningTimers();
}, 1000);

// A hidden/unloading page is the last chance to fold in derived time.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkDateRollover();
    if (anyTimerRunning()) updateLiveTaskTimerLabels();
  } else {
    checkpointRunningTimers();
  }
});

window.addEventListener('pagehide', () => {
  checkpointRunningTimers();
});

// bfcache restore re-runs no timers, so re-check the date explicitly.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    checkDateRollover();
    if (anyTimerRunning()) updateLiveTaskTimerLabels();
  }
});

// --- View switching (list vs day) ---
// The day schedule is both a section of the home page and a view of its own: in
// the list view it renders under the task workspace, and the toggle hides the
// workspace so the schedule has the page to itself. The choice sticks across
// reloads. The focus queue stays visible either way — it is a persistent working
// set rather than part of either view.
let currentView = readStored('tm_view') === 'day' ? 'day' : 'list';

function applyView(view) {
  currentView = view === 'day' ? 'day' : 'list';
  document.body.classList.remove('view-list', 'view-day');
  document.body.classList.add(currentView === 'day' ? 'view-day' : 'view-list');
  localStorage.setItem('tm_view', currentView);

  // The button is named for where it takes you, matching #ui-mode-btn.
  const target = currentView === 'day' ? 'List' : 'Day';
  if (viewIconLabel) viewIconLabel.textContent = target === 'Day' ? '📅 Day View' : '📋 List View';
  if (viewModeBtn) {
    viewModeBtn.setAttribute('aria-label', `Switch to ${target} View`);
  }

  // Day View's contents are only rendered by renderDayView(), which renderAll()
  // calls unconditionally — so a switch needs no re-render. Kept explicit in
  // case that ever stops being true.
  if (currentView === 'day' && dayViewPicker) dayViewPicker.value = currentViewDate;
}

// UI Mode & Theme Management
let currentUIMode = readStored('tm_ui_mode') || 'mode-terminal';
let currentTheme = readStored('tm_theme') || 'theme-dark';

function applyUIMode(mode) {
  currentUIMode = mode;
  document.body.classList.remove('mode-terminal', 'mode-gui');
  document.body.classList.add(mode);
  localStorage.setItem('tm_ui_mode', mode);
  renderAll();
}

function applyTheme(theme) {
  currentTheme = theme;
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(theme);
  if (themeIcon) {
    themeIcon.textContent = theme === 'theme-dark' ? '🌙 Dark' : '☀️ Light';
  }
  localStorage.setItem('tm_theme', theme);
}

applyUIMode(currentUIMode);
applyTheme(currentTheme);
applyView(currentView);

if (viewModeBtn) {
  viewModeBtn.addEventListener('click', () => {
    applyView(currentView === 'day' ? 'list' : 'day');
  });
}

if (uiModeBtn) {
  uiModeBtn.addEventListener('click', () => {
    applyUIMode(currentUIMode === 'mode-terminal' ? 'mode-gui' : 'mode-terminal');
  });
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    applyTheme(currentTheme === 'theme-dark' ? 'theme-light' : 'theme-dark');
  });
}

// Initialize default date in text input (e.g. "22-9")
if (taskDateInput) taskDateInput.value = formatDateDDMM(today());
if (dayViewPicker) dayViewPicker.value = currentViewDate;

// Save State
function saveToStorage() {
  try {
    localStorage.setItem('tm_groups', JSON.stringify(groups));
    localStorage.setItem('tm_tasks', JSON.stringify(tasks));
  } catch (err) {
    // Quota exhausted, or storage unavailable at all — some private modes and
    // any site with storage blocked by policy. Losing this write is bad, but
    // throwing from the middle of a render leaves the app dead and the failure
    // unexplained; the in-memory state is still correct either way.
    console.warn('Could not save to storage', err);
  }
  // Every mutation passes through here, which makes this the one place a later
  // script can watch writes without app.js knowing what it does with them.
  if (typeof persistObserver === 'function') persistObserver();
}

// Check if a task occurs on a specific date
function isTaskOnDate(task, dateStr) {
  if (task.dueDate === dateStr) return true;
  if (!task.dueDate) return false;

  const taskDate = new Date(task.dueDate + 'T00:00:00');
  const targetDate = new Date(dateStr + 'T00:00:00');

  if (targetDate < taskDate) return false;

  if (task.recur === 'daily') return true;
  if (task.recur === 'weekly') return taskDate.getDay() === targetDate.getDay();
  return false;
}

// What the focus bar shows: running timers first, then queued tasks, capped.
// A running timer takes a slot ahead of an idle queued one — the task you are
// actually working on should never be the one that falls off the end. Ordering
// within each group is by the explicit stamp, not array order, which does not
// survive a round-trip through a database.
function focusBarTasks() {
  const byStamp = (a, b) => (a.queuedAt || 0) - (b.queuedAt || 0);
  const running = tasks.filter(t => t.isTiming).sort(byStamp);
  const queued = tasks.filter(t => t.queued && !t.isTiming).sort(byStamp);
  return running.concat(queued).slice(0, FOCUS_QUEUE_MAX);
}

// Everything competing for a slot, whether or not the bar can show it. This is
// what the queue button caps on, so starting a timer cannot push the total past
// the cap behind the button's back — which is exactly how a fifth task used to
// get queued while the bar rendered four.
function focusBarLoad() {
  return tasks.filter(t => t.queued || t.isTiming).length;
}

// Render Top Focus Bar in Vertical Order (Max 4 queued tasks)
function renderFocusBar() {
  if (!focusTasksList) return;
  const shown = focusBarTasks();

  if (focusBarCount) {
    // Says so when something is over the cap rather than quietly dropping it. A
    // task the bar cannot show still exists and still has a timer or a queue
    // flag on it; a count reading "4 / 4" while a fifth sits queued is how that
    // goes unnoticed.
    const hidden = focusBarLoad() - shown.length;
    focusBarCount.textContent = hidden > 0
      ? `${shown.length} / ${FOCUS_QUEUE_MAX} queued (+${hidden} not shown)`
      : `${shown.length} / ${FOCUS_QUEUE_MAX} queued`;
  }

  // Nothing queued: render nothing. The header line above still reports the
  // count, and the CSS collapses the bar so it does not leave a gap where the
  // prompt used to be.
  if (shown.length === 0) {
    focusTasksList.innerHTML = '';
    return;
  }

  focusTasksList.innerHTML = shown.map((task, idx) => `
    <div class="focus-vertical-item ${task.isTiming ? 'is-running' : ''}">
      <div class="focus-item-left">
        <span class="focus-rank-badge" aria-hidden="true">#${idx + 1}</span>
        <span class="tag-group">${escapeHtml(task.group)}</span>
        <span class="focus-item-title-text">${escapeHtml(task.title)}</span>
      </div>

      <div class="focus-item-right">
        <div class="focus-live-timer">
          ${task.isTiming ? '<span class="pulse-dot" aria-hidden="true"></span>' : ''}
          <span class="timer-tick" data-task-id="${task.id}" aria-label="Elapsed time on ${escapeHtml(task.title)}">${formatDuration(computeElapsedSeconds(task))}</span>
        </div>
        <button
          class="btn-focus-action ${task.isTiming ? 'running' : ''}"
          aria-label="${task.isTiming ? 'Stop the timer on' : 'Start a focus timer on'} ${escapeHtml(task.title)}"
          onclick="toggleTaskTimer('${task.id}')"
        >
          ${task.isTiming ? '⏸ STOP' : '▶ START'}
        </button>
        <button class="btn-unque" title="Remove from Focus Queue" aria-label="Remove ${escapeHtml(task.title)} from the focus queue" onclick="toggleTaskQueue('${task.id}')">&times;</button>
      </div>
    </div>
  `).join('');
}

// Update live clock labels without redrawing whole card
function updateLiveTaskTimerLabels() {
  tasks.forEach(t => {
    if (t.isTiming) {
      const secs = computeElapsedSeconds(t);
      document.querySelectorAll(`.task-tracked-time[data-task-id="${t.id}"]`)
        .forEach(el => { el.textContent = `⏱ ${formatDuration(secs)}`; });
      document.querySelectorAll(`.timer-tick[data-task-id="${t.id}"]`)
        .forEach(el => { el.textContent = formatDuration(secs); });
    }
  });

  if (sidebarTotalTime) {
    sidebarTotalTime.textContent = formatDurationHuman(totalTrackedSeconds());
  }
}

// Includes derived time from running timers, so the sidebar total ticks with the
// card labels rather than jumping only at each checkpoint.
function totalTrackedSeconds() {
  return tasks.reduce((sum, t) => sum + computeElapsedSeconds(t), 0);
}

// Render Sidebar: Views + Groups
function renderGroups() {
  if (taskGroupSelect) {
    taskGroupSelect.innerHTML = groups
      .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`)
      .join('');
  }

  // Archived tasks are excluded here so every badge matches the list it opens.
  const activeCount = tasks.filter(t => !t.observing && !isArchived(t)).length;
  const observeCount = tasks.filter(t => t.observing && !isArchived(t)).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const isTerminal = currentUIMode === 'mode-terminal';

  if (viewList) {
    viewList.innerHTML = `
      <li class="nav-item ${selectedGroup === 'All' ? 'active' : ''}" data-group="All">
        <span>${isTerminal ? '$ all-tasks' : '📋 All Tasks'}</span>
        <span class="badge">${activeCount}</span>
      </li>
      <li class="nav-item observing-item ${selectedGroup === 'OBSERVE' ? 'active' : ''}" data-group="OBSERVE">
        <span>${isTerminal ? '$ observing' : '👀 Observing'}</span>
        <span class="badge badge-observe">${observeCount}</span>
      </li>
      <li class="nav-item completed-item ${selectedGroup === 'COMPLETED' ? 'active' : ''}" data-group="COMPLETED">
        <span>${isTerminal ? '$ completed' : '✅ Completed'}</span>
        <span class="badge badge-done">${completedCount}</span>
      </li>
    `;
  }

  let html = '';
  groups.forEach(group => {
    const count = tasks.filter(t => t.group === group && !t.observing && !isArchived(t)).length;
    html += `
      <li class="nav-item ${selectedGroup === group ? 'active' : ''}" data-group="${escapeHtml(group)}">
        <span>${isTerminal ? '# ' + escapeHtml(group.toLowerCase()) : escapeHtml(group)}</span>
        <span class="badge">${count}</span>
      </li>
    `;
  });

  groupList.innerHTML = html;

  if (sidebarTotalTime) {
    sidebarTotalTime.textContent = formatDurationHuman(totalTrackedSeconds());
  }
}

// Helper to generate task HTML card.
// `ctx` namespaces the card id so the same task can appear in both the main list
// and the Day View without producing duplicate ids on the page.
function renderTaskCardHtml(task, ctx = 'list') {
  const isTerminal = currentUIMode === 'mode-terminal';
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const notes = Array.isArray(task.observeNotes) ? task.observeNotes : [];
  const subtaskCount = subtasks.length;
  const completedSubtasks = subtasks.filter(s => s.completed).length;
  const subtaskStatus = subtaskCount > 0
    ? (isTerminal ? `[${completedSubtasks}/${subtaskCount}]` : `(${completedSubtasks}/${subtaskCount} done)`)
    : '';

  const recurBadge = task.recur && task.recur !== 'none'
    ? `<span class="tag-recur">${isTerminal ? '⟳ ' : '🔄 '}${escapeHtml(task.recur)}</span>`
    : '';

  const observeBadge = task.observing
    ? `<span class="tag-observe">${isTerminal ? '◉ OBSERVING' : '👀 Observing'}</span>`
    : '';

  const timeVal = task.time ? formatTime12Hour(task.time) : '';
  const dateVal = task.dueDate ? formatDateEditable(task.dueDate) : '';

  const elapsed = computeElapsedSeconds(task);
  const timerLabel = (elapsed > 0 || task.isTiming)
    ? `<span class="task-tracked-time" data-task-id="${task.id}">⏱ ${formatDuration(elapsed)}</span>`
    : '';

  // Observation notes HTML
  let observeNotesHtml = '';
  if (task.observing) {
    const notesList = notes.map(note => `
      <li class="observe-item">
        <span>${isTerminal ? '&gt; ' : '• '}${escapeHtml(note.text)}</span>
        <button class="btn-delete" title="Delete note" aria-label="Delete note: ${escapeHtml(note.text)}" onclick="deleteObserveNote('${task.id}', '${note.id}')">&times;</button>
      </li>
    `).join('');

    observeNotesHtml = `
      <div class="observe-box">
        <div class="observe-box-title">
          <span>${isTerminal ? '// OBSERVATION_LOGS' : '👀 Observation Updates'}</span>
          <small>${notes.length} note(s)</small>
        </div>
        ${notesList ? `<ul class="observe-list">${notesList}</ul>` : ''}
        <form class="add-observe-form" onsubmit="handleAddObserveNote(event, '${task.id}')">
          <input type="text" placeholder="${isTerminal ? 'append update...' : 'Add follow-up note...'}" aria-label="Add a follow-up note for ${escapeHtml(task.title)}" required />
          <button type="submit">${isTerminal ? '[ +LOG ]' : 'Add Note'}</button>
        </form>
      </div>
    `;
  }

  // Subtasks HTML
  const subtasksHtml = subtasks.map(st => `
    <li class="subtask-item ${st.completed ? 'completed' : ''}">
      <label class="subtask-left">
        <input
          type="checkbox"
          class="task-checkbox"
          ${st.completed ? 'checked' : ''}
          onchange="toggleSubtask('${task.id}', '${st.id}')"
        />
        <span>${escapeHtml(st.title)}</span>
      </label>
      <button class="btn-delete" title="Delete subtask" aria-label="Delete subtask: ${escapeHtml(st.title)}" onclick="deleteSubtask('${task.id}', '${st.id}')">&times;</button>
    </li>
  `).join('');

  return `
    <div class="task-card ${task.completed ? 'completed' : ''} ${task.observing ? 'observing' : ''} ${task.isTiming ? 'active-timing' : ''} ${task.queued ? 'in-queue' : ''}" id="task-card-${ctx}-${task.id}">
      <div class="task-header">
        <div class="task-left">
          <input
            type="checkbox"
            class="task-checkbox"
            aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}: ${escapeHtml(task.title)}"
            ${task.completed ? 'checked' : ''}
            onchange="toggleTask('${task.id}')"
          />
          <span class="task-title">${escapeHtml(task.title)}</span>
          <span class="tag-group">${escapeHtml(task.group)}</span>
          ${observeBadge}
          ${timerLabel}

          <!-- Quick Text Parsed Time & Date Controls with Picker Icons.
               The picker button is resolved structurally from its own pill, not
               by id, so the main-list and Day-View copies never collide. -->
          <div class="datetime-pill">
            <input
              type="text"
              class="quick-field-input time-input"
              value="${escapeHtml(timeVal)}"
              placeholder="⏰ Time"
              aria-label="Time for ${escapeHtml(task.title)}"
              onchange="handleCardTimeInput('${task.id}', this.value)"
            />
            <input type="time" class="hidden-picker" tabindex="-1" aria-hidden="true" onchange="handleCardTimeInput('${task.id}', this.value)" />
            <button type="button" class="btn-picker-trigger" aria-label="Pick a time" onclick="openPickerRelativeTo(this)">&#9200;</button>
          </div>

          <div class="datetime-pill">
            <input
              type="text"
              class="quick-field-input"
              value="${escapeHtml(dateVal)}"
              placeholder="📅 Date"
              aria-label="Date for ${escapeHtml(task.title)}"
              onchange="handleCardDateInput('${task.id}', this.value)"
            />
            <input type="date" class="hidden-picker" tabindex="-1" aria-hidden="true" onchange="handleCardDateInput('${task.id}', this.value)" />
            <button type="button" class="btn-picker-trigger" aria-label="Pick a date" onclick="openPickerRelativeTo(this)">&#128197;</button>
          </div>

          ${recurBadge}
          <small style="color: var(--text-dim);">${subtaskStatus}</small>
        </div>

        <div class="task-actions">
          <!-- Start / Stop Focus Timer Button -->
          <button
            class="btn-timer-toggle ${task.isTiming ? 'running' : ''}"
            title="${task.isTiming ? 'Pause/Stop Timer' : 'Start Focus Timer'}"
            aria-label="${task.isTiming ? 'Stop the timer on' : 'Start a focus timer on'} ${escapeHtml(task.title)}"
            onclick="toggleTaskTimer('${task.id}')"
          >
            ${task.isTiming ? '⏸ STOP' : '▶ START'}
          </button>

          <!-- Queue Toggle Button beside Start -->
          <button
            class="btn-que-toggle ${task.queued ? 'in-queue' : ''}"
            title="${task.queued ? 'Remove from Focus Queue' : 'Add to Top Focus Queue (Max 4)'}"
            aria-label="${task.queued ? 'Remove from the focus queue' : 'Add to the focus queue'}: ${escapeHtml(task.title)}"
            onclick="toggleTaskQueue('${task.id}')"
          >
            ${task.queued ? '⚡ Queued' : '+ Que'}
          </button>

          <button
            class="btn-observe ${task.observing ? 'active' : ''}"
            title="${task.observing ? 'Remove from Observation' : 'Move to Observation'}"
            aria-label="${task.observing ? 'Stop observing' : 'Move to observation'}: ${escapeHtml(task.title)}"
            onclick="toggleTaskObserve('${task.id}')"
          >
            ${task.observing ? (isTerminal ? '[ 👀 OBSERVING ]' : '👀 Observing') : (isTerminal ? '[ 👁 OBSERVE ]' : '👁️ Observe')}
          </button>
          <button class="btn-delete" title="Delete task" aria-label="Delete task: ${escapeHtml(task.title)}" onclick="deleteTask('${task.id}')">${isTerminal ? '[✕]' : '&times;'}</button>
        </div>
      </div>

      <!-- Observation Section if active -->
      ${observeNotesHtml}

      <!-- Subtasks Section -->
      <div class="subtasks-section">
        ${subtaskCount > 0 ? `<ul class="subtask-list">${subtasksHtml}</ul>` : ''}
        <form class="add-subtask-form" onsubmit="handleAddSubtask(event, '${task.id}')">
          <input type="text" placeholder="+ Add a subtask" aria-label="New subtask for ${escapeHtml(task.title)}" required />
          <button type="submit">+</button>
        </form>
      </div>
    </div>
  `;
}

// Render Main Task List
function renderTasks() {
  const isTerminal = currentUIMode === 'mode-terminal';
  let filteredTasks = [];
  if (selectedGroup === 'All') {
    currentGroupTitle.textContent = isTerminal ? 'ALL_TASKS' : 'All Tasks';
    filteredTasks = tasks.filter(t => !t.observing && !isArchived(t));
  } else if (selectedGroup === 'OBSERVE') {
    currentGroupTitle.textContent = isTerminal ? 'OBSERVE_FOLLOWUPS' : '👀 Observing / Follow-up Tasks';
    filteredTasks = tasks.filter(t => t.observing && !isArchived(t));
  } else if (selectedGroup === 'COMPLETED') {
    currentGroupTitle.textContent = isTerminal ? 'COMPLETED_TASKS' : '✅ Completed Tasks';
    filteredTasks = tasks.filter(t => t.completed);
  } else {
    currentGroupTitle.textContent = isTerminal ? `GROUP_${selectedGroup.toUpperCase()}` : `${selectedGroup} Tasks`;
    filteredTasks = tasks.filter(t => t.group === selectedGroup && !t.observing && !isArchived(t));
  }

  if (selectedGroup === 'COMPLETED') {
    // Most recently finished first — that is the question this view answers.
    filteredTasks = filteredTasks
      .slice()
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  } else {
    filteredTasks = sortTasksByDateTime(filteredTasks);
  }

  taskCount.textContent = isTerminal
    ? `[ ${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'} ]`
    : `${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'}`;

  if (filteredTasks.length === 0) {
    if (selectedGroup === 'OBSERVE') {
      tasksContainer.innerHTML = `<div class="empty-state">No tasks under observation right now. Click "Observe" on any task to track it!</div>`;
    } else if (selectedGroup === 'COMPLETED') {
      tasksContainer.innerHTML = `<div class="empty-state">Nothing completed yet. Tick a task off and it collects here.</div>`;
    } else {
      tasksContainer.innerHTML = `<div class="empty-state">No active tasks in this view. Add one below!</div>`;
    }
    return;
  }

  tasksContainer.innerHTML = filteredTasks.map(task => renderTaskCardHtml(task, 'list')).join('');
}

// Render Day View
function renderDayView() {
  dayViewPicker.value = currentViewDate;
  dayViewDateLabel.textContent = formatDateFriendly(currentViewDate);

  const dayTasks = tasks.filter(t => isTaskOnDate(t, currentViewDate) && !t.observing);

  if (dayTasks.length === 0) {
    // Escaped even though currentViewDate is only ever a date input's value or
    // today(): formatDateFriendly returns its argument verbatim when it is not
    // three dash-separated parts, so anything that ever widens this source
    // becomes markup. It is the one unescaped interpolation into innerHTML in
    // the file that is not an id.
    dayViewContainer.innerHTML = `<div class="empty-state">No active tasks scheduled for ${escapeHtml(formatDateFriendly(currentViewDate))}.</div>`;
    return;
  }

  let html = '';

  groups.forEach(groupName => {
    let tasksInGroup = dayTasks.filter(t => t.group === groupName);
    if (tasksInGroup.length > 0) {
      tasksInGroup = sortTasksByTimeOnly(tasksInGroup);

      html += `
        <div class="day-group-box">
          <div class="day-group-header">
            <span>${escapeHtml(groupName)}</span>
            <span style="font-weight: normal; color: var(--text-dim);">(${tasksInGroup.length})</span>
          </div>
          <div class="day-group-tasks">
            ${tasksInGroup.map(t => renderTaskCardHtml(t, 'day')).join('')}
          </div>
        </div>
      `;
    }
  });

  let otherTasks = dayTasks.filter(t => !groups.includes(t.group));
  if (otherTasks.length > 0) {
    otherTasks = sortTasksByTimeOnly(otherTasks);
    html += `
      <div class="day-group-box">
        <div class="day-group-header">
          <span>Other</span>
          <span style="font-weight: normal; color: var(--text-dim);">(${otherTasks.length})</span>
        </div>
        <div class="day-group-tasks">
          ${otherTasks.map(t => renderTaskCardHtml(t, 'day')).join('')}
        </div>
      </div>
    `;
  }

  dayViewContainer.innerHTML = html;
}

// --- Analytics Window Generator ---
function renderAnalyticsModal() {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const observingTasks = tasks.filter(t => t.observing).length;
  const activeTasks = tasks.filter(t => !t.completed && !t.observing).length;

  // Derived, not the stored counter: a timer that has been running since the last
  // 5-minute checkpoint would otherwise be invisible in analytics.
  const totalTrackedSecs = totalTrackedSeconds();
  const totalHoursFormatted = formatDurationHuman(totalTrackedSecs);

  // Group breakdown
  const groupTimeStats = groups.map(g => {
    const groupTasks = tasks.filter(t => t.group === g);
    const secs = groupTasks.reduce((sum, t) => sum + computeElapsedSeconds(t), 0);
    const completed = groupTasks.filter(t => t.completed).length;
    return { name: g, secs, total: groupTasks.length, completed };
  });

  const maxSecs = Math.max(...groupTimeStats.map(s => s.secs), 1);

  analyticsContent.innerHTML = `
    <!-- Top Stats Grid -->
    <div class="stat-grid">
      <div class="stat-card">
        <span class="stat-num">${totalHoursFormatted}</span>
        <span class="stat-label">Total Work Time</span>
      </div>
      <div class="stat-card">
        <span class="stat-num">${completedTasks} / ${totalTasks}</span>
        <span class="stat-label">Tasks Completed</span>
      </div>
      <div class="stat-card">
        <span class="stat-num">${activeTasks}</span>
        <span class="stat-label">Active Tasks</span>
      </div>
      <div class="stat-card">
        <span class="stat-num">${observingTasks}</span>
        <span class="stat-label">In Observation</span>
      </div>
    </div>

    <!-- Time Spent Per Group -->
    <div class="analytics-section-block">
      <h4>Time Spent by Group</h4>
      ${groupTimeStats.map(g => {
        const percentage = Math.round((g.secs / maxSecs) * 100);
        return `
          <div>
            <div class="group-progress-row">
              <strong>${escapeHtml(g.name)}</strong>
              <span>${formatDurationHuman(g.secs)} (${g.completed}/${g.total} done)</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width: ${percentage}%;"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Top Focus Tasks -->
    <div class="analytics-section-block">
      <h4>Top Focus Tasks</h4>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${tasks
          .map(t => ({ task: t, secs: computeElapsedSeconds(t) }))
          .filter(entry => entry.secs > 0)
          .sort((a, b) => b.secs - a.secs)
          .slice(0, 5)
          .map(({ task: t, secs }) => `
            <div style="display:flex; justify-content:space-between; font-size:12px; background:var(--bg-sidebar); padding:6px 10px; border-radius:4px; border:1px solid var(--border-main);">
              <span>${t.completed ? '✓ ' : '• '}${escapeHtml(t.title)} (${escapeHtml(t.group)})</span>
              <strong style="color:var(--accent-green);">${formatDurationHuman(secs)}</strong>
            </div>
          `).join('') || '<div style="font-size:12px; color:var(--text-dim);">No focus sessions recorded yet.</div>'}
      </div>
    </div>
  `;
}

// Refresh full UI
function renderAll() {
  renderGroups();
  renderFocusBar();
  renderTasks();
  renderDayView();
}

// Helpers

// Escapes quotes as well as angle brackets. This is used in *attribute* positions
// (value="...", data-group="..."), and the parsers return raw input when they
// cannot parse, so a `"` in a field would otherwise break out of the attribute.
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// crypto.randomUUID() needs a secure context, so it is unavailable when the app is
// opened from file://. The fallback still emits a v4-shaped UUID rather than a
// timestamp, because the tasks.id column is `uuid` and any non-UUID id would fail
// the very first sync — and because a timestamp fallback would look "legacy" to
// migrateLegacyIds() and be re-keyed on every single load.
function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Tasks written by earlier versions carry ids like '1' or a millisecond timestamp.
// Those cannot be sent to a `uuid` column, so re-key them (and any subtask or note
// still holding a legacy id) once, on load. Returns true if anything changed.
function migrateLegacyIds() {
  let changed = false;
  tasks.forEach(task => {
    if (!UUID_SHAPE.test(task.id)) { task.id = newId(); changed = true; }
    task.subtasks.forEach(st => {
      if (!UUID_SHAPE.test(st.id)) { st.id = newId(); changed = true; }
    });
    task.observeNotes.forEach(n => {
      if (!UUID_SHAPE.test(n.id)) { n.id = newId(); changed = true; }
    });
  });
  return changed;
}

// Tasks ticked off before completedAt existed carry no stamp, so they could never
// reach the archive. Stamping them with today is the honest default — we do not
// know when they were finished — and it keeps them in view until tomorrow, rather
// than having them vanish the moment this ships.
function migrateCompletedAt() {
  const now = today();
  let changed = false;
  tasks.forEach(task => {
    if (task.completed && !task.completedAt) { task.completedAt = now; changed = true; }
    if (!task.completed && task.completedAt) { task.completedAt = ''; changed = true; }
  });
  return changed;
}

// A task ticked off on an earlier day has left the working set: it collects in the
// Completed view instead of the list it was finished from. Today's completions stay
// where they are, so ticking a box never makes the row vanish from under the
// cursor.
//
// The recurrence clause below is a safety net rather than the main path now:
// completing a recurring task rolls it forward (advanceRecurrence), so it never
// sits completed to begin with. Tasks already stored as completed by an earlier
// version are still out there, though, and archiving one of those purely on the
// stamp would hide it permanently — so a recurring task is only archived once
// its next occurrence is not today.
function isArchived(task) {
  if (!task.completed || task.completedAt === '') return false;
  if (task.completedAt === today()) return false;
  if (task.recur !== 'none' && isTaskOnDate(task, today())) return false;
  return true;
}

// Completing a recurring task means it is done for *this* occurrence, not
// forever. Nothing used to clear the tick: isTaskOnDate kept advancing the day
// the task was shown on, so a `daily` task ticked once stayed struck through
// permanently.
//
// The next date comes from stepping the due date until it lands strictly after
// today, rather than from adding a single interval. A weekly task left untouched
// for a fortnight has to come back on its weekday, not on the day it was ticked.
function advanceRecurrence(task) {
  if (task.recur !== 'daily' && task.recur !== 'weekly') return false;
  const step = task.recur === 'daily' ? 1 : 7;

  const start = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : new Date(today() + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return false;
  const from = new Date(today() + 'T00:00:00');

  // At least one step, so completing something due in the future still advances
  // it. Bounded, because an unbounded date loop is not a thing to leave in a tab
  // that a corrupted `dueDate` could otherwise hang.
  let guard = 0;
  do { start.setDate(start.getDate() + step); } while (start <= from && guard++ < 4000);

  task.dueDate = getLocalDateString(start);
  task.completed = false;
  task.completedAt = '';
  return true;
}

// Both parsers return their input unchanged when they cannot make sense of it, so a
// successful parse is recognised by shape rather than by a sentinel. Callers reject
// anything that fails these instead of storing it: unparseable text in a date/time
// field would be sent to a DATE/TIME column, PostgREST would reject the row, and the
// dirty entry would never clear — a permanent sync-failure loop.
// (The shape constants themselves are declared at the top, above the load-time code.)
function isValidTimeString(value) {
  return typeof value === 'string' && TIME_SHAPE.test(value);
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value)) return false;
  // Round-tripping rejects impossible dates like 2026-02-31, which JS would
  // otherwise silently normalise to March 3rd.
  return getLocalDateString(new Date(value + 'T00:00:00')) === value;
}

// The card's date field is DD-MM, so the year it is stored under is normally
// invisible. These two are the two halves of making sure it cannot change
// without the user seeing it: display the year whenever it is not the current
// one, and preserve it whenever an edit does not name one itself.
function formatDateEditable(dateStr) {
  if (!dateStr) return '';
  const short = formatDateDDMM(dateStr);
  // formatDateDDMM hands back its argument unchanged when it is not a real
  // date, and there is no year to append to something unparseable.
  if (short === dateStr) return short;
  const year = dateStr.slice(0, 4);
  return year === String(new Date().getFullYear()) ? short : `${short}-${year}`;
}

// Keeps the year a task already had when the new value does not name one.
// Without this, editing "22-9" on a task due in 2027 re-parsed it with the
// *current* year and quietly moved it back a year.
function withExistingYear(parsed, existing) {
  if (!isValidDateString(parsed) || !isValidDateString(existing)) return parsed;
  const candidate = existing.slice(0, 4) + parsed.slice(4);
  // 29 Feb does not survive a move to a non-leap year; keep the parsed value.
  return isValidDateString(candidate) ? candidate : parsed;
}

function showPickerElement(el) {
  if (!el) return;
  if (typeof el.showPicker === 'function') {
    el.showPicker();
  } else {
    el.click();
  }
}

// Used by the bottom add-task form, whose pickers have unique ids.
window.openHiddenPicker = function(pickerId) {
  showPickerElement(document.getElementById(pickerId));
};

// Used by task cards. Resolving the picker from the button's own `.datetime-pill`
// avoids depending on ids, which are duplicated whenever a task is rendered in
// both the main list and Day View.
window.openPickerRelativeTo = function(btn) {
  const pill = btn && btn.closest ? btn.closest('.datetime-pill') : null;
  showPickerElement(pill ? pill.querySelector('.hidden-picker') : null);
};

// Analytics Modal Handlers
// Focus moves into the dialog on open and returns to whatever opened it on
// close, so a keyboard user is not dumped back at the top of the document.
// Escape closes it, matching the backdrop click.
let analyticsOpener = null;

function openAnalytics() {
  analyticsOpener = document.activeElement || null;
  renderAnalyticsModal();
  analyticsModal.classList.remove('hidden');
  if (closeAnalyticsBtn) closeAnalyticsBtn.focus();
}

function closeAnalytics() {
  analyticsModal.classList.add('hidden');
  if (analyticsOpener && typeof analyticsOpener.focus === 'function') analyticsOpener.focus();
  analyticsOpener = null;
}

if (openAnalyticsBtn) {
  openAnalyticsBtn.addEventListener('click', openAnalytics);
}

if (closeAnalyticsBtn) {
  closeAnalyticsBtn.addEventListener('click', closeAnalytics);
}

if (analyticsBackdrop) {
  analyticsBackdrop.addEventListener('click', closeAnalytics);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && analyticsModal && !analyticsModal.classList.contains('hidden')) {
    closeAnalytics();
  }
});

// Event Handlers for Bottom Form
if (openDatePickerBtn && taskDatePickerHidden) {
  openDatePickerBtn.addEventListener('click', () => {
    openHiddenPicker('task-date-picker-hidden');
  });
  taskDatePickerHidden.addEventListener('change', (e) => {
    if (e.target.value) {
      taskDateInput.value = formatDateDDMM(e.target.value);
    }
  });
}

if (openTimePickerBtn && taskTimePickerHidden) {
  openTimePickerBtn.addEventListener('click', () => {
    openHiddenPicker('task-time-picker-hidden');
  });
  taskTimePickerHidden.addEventListener('change', (e) => {
    if (e.target.value) {
      taskTimeInput.value = formatTime12Hour(e.target.value);
    }
  });
}

addTaskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  let rawTitle = taskTitleInput.value.trim();
  const group = taskGroupSelect.value;
  let rawDate = taskDateInput.value.trim();
  let rawTime = taskTimeInput.value.trim();
  const recur = taskRecurSelect.value || 'none';

  if (!rawTitle) return;

  const extracted = extractDateTimeFromTitle(rawTitle);
  const title = extracted.cleanTitle;

  // A field the user filled in but that failed to parse falls through to the value
  // extracted from the title, then to the default — never stored as raw text.
  const parsedTime = rawTime ? parseTimeString(rawTime) : '';
  const time = isValidTimeString(parsedTime) ? parsedTime : (extracted.extractedTime || '');

  const parsedDate = rawDate ? parseDateString(rawDate) : '';
  const dueDate = isValidDateString(parsedDate) ? parsedDate : (extracted.extractedDate || today());

  const newTask = normalizeTask({
    id: newId(),
    title,
    group,
    dueDate,
    time,
    recur,
    completed: false,
    observing: false,
    queued: false
  });

  tasks.push(newTask);
  taskTitleInput.value = '';
  taskTimeInput.value = '';
  taskDateInput.value = formatDateDDMM(today());
  saveToStorage();
  renderAll();
});

addGroupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newGroupName = newGroupInput.value.trim();
  if (!newGroupName) return;

  if (!groups.includes(newGroupName)) {
    groups.push(newGroupName);
    selectedGroup = newGroupName;
    saveToStorage();
    renderAll();
  }
  newGroupInput.value = '';
});

// Click handlers for sidebar items
if (viewList) {
  viewList.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    selectedGroup = item.dataset.group;
    renderAll();
  });
}

groupList.addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  selectedGroup = item.dataset.group;
  renderAll();
});

// Day View Navigation
dayViewPicker.addEventListener('change', (e) => {
  if (e.target.value) {
    currentViewDate = e.target.value;
    renderDayView();
  }
});

prevDayBtn.addEventListener('click', () => {
  const d = new Date(currentViewDate + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  currentViewDate = getLocalDateString(d);
  renderDayView();
});

nextDayBtn.addEventListener('click', () => {
  const d = new Date(currentViewDate + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  currentViewDate = getLocalDateString(d);
  renderDayView();
});

todayBtn.addEventListener('click', () => {
  currentViewDate = today();
  renderDayView();
});

// CARD INLINE PARSING HANDLERS.
// An unparseable value re-renders from stored state, which snaps the field back to
// what is actually saved rather than leaving junk on screen.
window.handleCardTimeInput = function(taskId, rawValue) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const raw = (rawValue || '').trim();
  if (raw === '') {
    task.time = '';
  } else {
    const parsed = parseTimeString(raw);
    if (!isValidTimeString(parsed)) {
      renderAll();
      return;
    }
    task.time = parsed;
  }
  saveToStorage();
  renderAll();
};

window.handleCardDateInput = function(taskId, rawValue) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const raw = (rawValue || '').trim();
  if (raw === '') {
    task.dueDate = '';
  } else {
    const parsed = parseDateString(raw);
    // Does the raw text name a year itself? Only then is the parsed year what
    // the user meant; otherwise it is parseDateString's default of the current
    // year, and the task's own year has to be kept instead.
    const namedYear = DATE_SHAPE.test(raw) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(raw);
    const resolved = namedYear ? parsed : withExistingYear(parsed, task.dueDate);
    if (!isValidDateString(resolved)) {
      renderAll();
      return;
    }
    task.dueDate = resolved;
  }
  saveToStorage();
  renderAll();
};

// TIMER TOGGLE HANDLER (Single button toggle)
window.toggleTaskTimer = function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  if (task.isTiming) {
    // Folds the derived elapsed time back into elapsedSeconds before clearing the anchor.
    settleTaskTimer(task);
  } else {
    task.isTiming = true;
    task.timerStartedAt = Date.now();
    // Auto-queue so a started timer is pinned in the bar — but never past the
    // cap. The bar renders four, so queueing a fifth would start a timer it
    // never shows. The timer itself still runs either way: a running task
    // reaches the bar through isTiming, not through the queue flag.
    if (!task.queued && focusBarLoad() < FOCUS_QUEUE_MAX) {
      task.queued = true;
      task.queuedAt = Date.now();
    }
  }
  saveToStorage();
  renderAll();
};

// QUEUE TOGGLE HANDLER (Adds to top vertical queue, max 4)
window.toggleTaskQueue = function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  if (task.queued) {
    task.queued = false;
    task.queuedAt = null;
  } else {
    // Counts running timers as well as queued tasks: both occupy a slot, so
    // capping on `queued` alone would let a running timer push the total over.
    if (focusBarLoad() >= FOCUS_QUEUE_MAX) {
      alert(`Focus queue is full (max ${FOCUS_QUEUE_MAX} tasks). Please un-queue or complete a task first.`);
      return;
    }
    task.queued = true;
    // Queue rank is by stamp, not array order, so it survives a round-trip through
    // the database and stays stable across devices.
    task.queuedAt = Date.now();
  }
  saveToStorage();
  renderAll();
};

// OBSERVATION HANDLERS
window.toggleTaskObserve = function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  task.observing = !task.observing;
  if (task.observing) {
    // Settle before clearing the timer so the running interval isn't discarded.
    settleTaskTimer(task);
    task.queued = false;
    task.queuedAt = null;
  }
  if (!Array.isArray(task.observeNotes)) task.observeNotes = [];
  saveToStorage();
  renderAll();
};

window.handleAddObserveNote = function(e, taskId) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  const text = input.value.trim();
  if (!text) return;

  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  if (!Array.isArray(task.observeNotes)) task.observeNotes = [];
  task.observeNotes.push({ id: newId(), text, createdAt: Date.now() });
  input.value = '';
  saveToStorage();
  renderAll();
};

// Deletes by note id, not by index: an insert on another device would shift every
// index, so index-based deletion cannot survive sync.
window.deleteObserveNote = function(taskId, noteId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !Array.isArray(task.observeNotes)) return;

  task.observeNotes = task.observeNotes.filter(n => n.id !== noteId);
  saveToStorage();
  renderAll();
};

// Global task operations
window.toggleTask = function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  task.completed = !task.completed;
  if (task.completed) {
    settleTaskTimer(task);
    task.queued = false;
    task.queuedAt = null;
    // Stamped so tonight's rollover can tell this apart from work finished on an
    // earlier day and move it to the Completed view.
    task.completedAt = today();
    // A recurring task rolls on to its next occurrence instead of collecting in
    // the Completed view forever. Clearing `completed` here is the whole fix —
    // it is what was missing.
    advanceRecurrence(task);
  } else {
    task.completedAt = '';
  }
  saveToStorage();
  renderAll();
};

// DELETING
// The delete itself stays immediate, so the sync layer sees exactly what it saw
// before any of this existed — a task that lingers in the array until a toast
// expires would be uploaded and then un-uploaded. What is held back is only the
// removed object, which is enough to put it back.
//
// Undo survives a sync that already pushed the tombstone: restoring re-adds a
// task the server has no record of at a newer timestamp, so observe() queues an
// upsert that overwrites the tombstone in the ordinary way.
const UNDO_WINDOW_MS = 8000;
let undoEntry = null;
let undoTimer = null;

function clearUndo() {
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  undoEntry = null;
  if (undoBar) undoBar.classList.add('hidden');
}

function offerUndo(task, index) {
  // Markup missing: the delete still happened, it is simply not undoable.
  if (!undoBar || !undoBarBtn) return;
  if (undoTimer !== null) clearTimeout(undoTimer);
  undoEntry = { task, index };
  if (undoBarText) undoBarText.textContent = `Deleted "${task.title || 'task'}".`;
  undoBar.classList.remove('hidden');
  undoTimer = setTimeout(clearUndo, UNDO_WINDOW_MS);
}

function restoreUndo() {
  if (!undoEntry) return;
  const { task, index } = undoEntry;
  clearUndo();
  // Already back — a pull can legitimately have re-added it in the meantime.
  if (tasks.some(t => t.id === task.id)) return;
  // Back at its old position, so the list does not reshuffle around it.
  tasks.splice(Math.min(Math.max(index, 0), tasks.length), 0, task);
  saveToStorage();
  renderAll();
}

if (undoBarBtn) undoBarBtn.addEventListener('click', restoreUndo);

window.deleteTask = function(taskId) {
  const index = tasks.findIndex(t => t.id === taskId);
  if (index === -1) return;
  const [removed] = tasks.splice(index, 1);
  saveToStorage();
  renderAll();
  offerUndo(removed, index);
};

window.handleAddSubtask = function(e, taskId) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  const title = input.value.trim();
  if (!title) return;

  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  if (!Array.isArray(task.subtasks)) task.subtasks = [];
  task.subtasks.push({
    id: newId(),
    title,
    completed: false
  });
  input.value = '';
  saveToStorage();
  renderAll();
};

window.toggleSubtask = function(taskId, subtaskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;

  const subtask = task.subtasks.find(s => s.id === subtaskId);
  if (subtask) {
    subtask.completed = !subtask.completed;
    saveToStorage();
    renderAll();
  }
};

window.deleteSubtask = function(taskId, subtaskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;

  task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
  saveToStorage();
  renderAll();
};

// Storage keys the reminders own. Declared up here, above the bridge, rather
// than beside the code that uses them: `const` is not hoisted, and the window.TM
// object literal below is evaluated as the file loads, so reading one of these
// from inside it before its own declaration is a TDZ crash at boot.
const REMINDERS_ON_KEY = 'tm_reminders_on';
const FIRED_KEY = 'tm_fired_reminders';

// --- Bridge for later phases ---
// This file is a classic script: `function` declarations become window properties,
// but `let tasks` / `let groups` / `let selectedGroup` live in script lexical scope
// and are invisible to an ES module. Auth and sync code go through this seam rather
// than forcing a rewrite of the app's all-globals + inline-onclick architecture.
window.TM = {
  get tasks() { return tasks; },
  // Every write through this seam is normalized and re-keyed, because it is the
  // one entrance the boot migration does not cover. Task, subtask and note ids
  // are interpolated into inline onclick attributes unescaped across the card
  // renderer, which is only safe while every id matches UUID_SHAPE — an
  // invariant migrateLegacyIds establishes for storage and that nothing
  // established here. Without this, a sync layer writing a server row with an id
  // like `x');alert(1);//` stores it verbatim and executes it on the next render,
  // and subtask/note ids live in jsonb rather than uuid columns, so the database
  // does not enforce their shape either.
  set tasks(value) {
    tasks = (Array.isArray(value) ? value : []).map(normalizeTask);
    migrateLegacyIds();
  },
  get groups() { return groups; },
  set groups(value) {
    groups = Array.isArray(value)
      ? value.filter(g => typeof g === 'string' && g !== '')
      : [...DEFAULT_GROUPS];
    if (groups.length === 0) groups = [...DEFAULT_GROUPS];
  },
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(value) { selectedGroup = value; },

  today,
  newId,
  normalizeTask,
  loadJson,
  saveToStorage,
  // Lets a later script watch every persist. Generic on purpose; see the
  // declaration of persistObserver.
  setPersistObserver(fn) { persistObserver = typeof fn === 'function' ? fn : null; },
  renderAll,
  renderDayView,
  renderAnalyticsModal,
  sortTasksByDateTime,
  isTaskOnDate,
  isArchived,
  computeElapsedSeconds,
  totalTrackedSeconds,
  isValidTimeString,
  isValidDateString,
  checkpointRunningTimers,
  settleTaskTimer,
  // Recurrence roll-forward, the focus-queue cap, and the date-edit helpers.
  // Exported because each has a rule worth asserting directly rather than
  // through the renderer: the roll-forward must skip past today rather than
  // landing on it, the cap counts what is hidden, and an unnamed year in a date
  // edit must not silently retarget the task to a different year.
  advanceRecurrence,
  focusBarTasks,
  focusBarLoad,
  FOCUS_QUEUE_MAX,
  formatDateEditable,
  withExistingYear,

  // Reminders. checkReminders() is called directly by the tests, because the
  // timer that normally drives it is armed to a minute boundary and a test
  // cannot wait for one.
  checkReminders,
  reminderInstant,
  firedKey,
  remindersOn,
  remindersSupported,
  reminderPermission,
  renderReminderButton,
  toggleReminders,
  armReminderTick,
  REMINDERS_ON_KEY,
  FIRED_KEY,

  // localStorage keys, kept in one place so sync code cannot drift from the app.
  KEYS: { groups: 'tm_groups', tasks: 'tm_tasks', theme: 'tm_theme', uiMode: 'tm_ui_mode', view: 'tm_view' }
};

// View state is read through the bridge too, since `currentView` is a `let`
// and therefore invisible to the ES modules that Phases 2–4 will use.
Object.defineProperty(window.TM, 'currentView', {
  get() { return currentView; },
  set(v) { applyView(v); }
});
window.TM.applyView = applyView;

/* =========================================================
   SERVICE WORKER / UPDATE PROMPT
   ========================================================= */

// Registration is skipped on file:// — index.html opened straight off disk must
// keep working exactly as before, and a worker cannot register from a non-secure
// origin anyway. localStorage still backs everything, so the app is fully
// functional with no worker at all.
function canRegisterServiceWorker() {
  return 'serviceWorker' in navigator &&
    (location.protocol === 'https:' ||
     location.hostname === 'localhost' ||
     location.hostname === '127.0.0.1');
}

// The worker is written not to activate itself, so a deploy cannot swap the app
// out mid-timer. When the user accepts, we tell it to take over and reload on
// the resulting controllerchange. `reloading` guards that reload so the very
// first install — which also fires controllerchange — does not bounce the page.
function wireServiceWorker() {
  if (!canRegisterServiceWorker()) return;

  const bar = document.getElementById('update-bar');
  const barBtn = document.getElementById('update-bar-btn');
  let waitingWorker = null;
  let reloading = false;

  const offerUpdate = (worker) => {
    if (!bar || worker === waitingWorker) return;
    waitingWorker = worker;
    bar.classList.remove('hidden');
    if (barBtn) barBtn.focus();
  };

  if (barBtn) {
    barBtn.addEventListener('click', () => {
      if (!waitingWorker) return;
      reloading = true;
      bar.classList.add('hidden');
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });

  // An update can already be waiting from a previous visit, before this page
  // ever registered. `ready` resolves to that waiting worker.
  navigator.serviceWorker.ready.then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
  }).catch(() => {});

  navigator.serviceWorker.register('sw.js').then(reg => {
    // Already waiting when the page loaded.
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // `controller` is null on a first-ever visit, where there is nothing to
        // update away from — that install should just take effect quietly.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          offerUpdate(installing);
        }
      });
    });
  }).catch(() => {
    // A worker that will not register (unsupported browser, blocked storage)
    // must not take the app down with it.
  });
}

window.addEventListener('load', wireServiceWorker);

/* =========================================================
   REMINDERS
   ========================================================= */

// Reminders fire only while the app is open — a tab, or an installed window.
// There is no server, no push subscription and no background sync, so closing
// the app means no reminder. That is the trade this is built on, and it is why
// the feature needs no Edge Function, no VAPID keys and no subscriptions table.
// Everything below is exactly the part a later server-side push would replace.
//
// Three things it has to get right, each of which is a way this is normally
// broken:
//
//   * Recurrence, not date equality. `dueDate === today` reminds you once and
//     never again for a recurring task. isTaskOnDate already handles daily and
//     weekly, so it is reused rather than reimplemented.
//   * Fire once. Without a record of what has already fired, every check within
//     the scheduled minute notifies again.
//   * registration.showNotification(), not `new Notification()`. The
//     constructor throws `Illegal constructor` on Android Chrome and does not
//     exist at all in an installed iOS PWA — the two devices this is for.

// How far back a check reaches for reminders that came due while the page was
// suspended. Long enough to cover a closed laptop lid, short enough that opening
// the app after lunch is not a wall of stale notices.
const MISSED_WINDOW_MS = 5 * 60 * 1000;

let reminderTimer = null;
let lastReminderCheck = Date.now();

const minuteFloor = (ms) => Math.floor(ms / 60000) * 60000;

// Notifications need a secure origin, a worker to display them, and permission.
// Any one missing means the control is not offered at all.
function remindersSupported() {
  return typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    canRegisterServiceWorker();
}

function reminderPermission() {
  return remindersSupported() ? Notification.permission : 'unsupported';
}

function remindersOn() {
  return reminderPermission() === 'granted' && readStored(REMINDERS_ON_KEY) === '1';
}

function loadFired() {
  const raw = loadJson(FIRED_KEY, {});
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

// Bounded to a week. The key would otherwise gain one entry per task per day
// forever on a device that has been reminding for a year.
function saveFired(map) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const trimmed = {};
  Object.keys(map).forEach(k => { if (map[k] >= cutoff) trimmed[k] = map[k]; });
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(trimmed)); }
  catch (err) { /* storage blocked; the next check retries */ }
}

// The instant this task's reminder falls due on the given day, or NaN. A task
// with no usable time is not a reminder.
function reminderInstant(task, dateStr) {
  if (!isValidTimeString(task.time)) return NaN;
  const at = new Date(`${dateStr}T${task.time}:00`).getTime();
  return Number.isNaN(at) ? NaN : at;
}

function reminderBody(task) {
  const when = task.time ? formatTime12Hour(task.time) : '';
  return [task.group, when].filter(Boolean).join(' · ') || 'Scheduled now';
}

async function notifyTask(task) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(task.title || 'Task', {
      body: reminderBody(task),
      // Per task, so a repeat collapses onto the existing notice rather than
      // stacking a second one beside it.
      tag: `task-${task.id}`,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { taskId: task.id }
    });
  } catch (err) {
    // A notification that will not show must not take the app down with it.
    console.warn('Could not show a reminder', err);
  }
}

// A function declaration rather than an arrow bound to a `const`, so it is
// hoisted and the bridge above can reference it.
function firedKey(task, dateStr) {
  return `${task.id}|${dateStr}|${task.time}`;
}

// Fires everything that has come due since the last check, at most once each.
// Called on the minute boundary, and again whenever the page becomes visible so
// a reminder that came due while the tab was suspended is caught up rather than
// silently skipped.
function checkReminders() {
  const now = Date.now();
  const from = Math.max(lastReminderCheck, now - MISSED_WINDOW_MS);
  lastReminderCheck = now;

  if (!remindersOn()) return;

  const dateStr = today();
  const fired = loadFired();
  const due = [];

  tasks.forEach(task => {
    // An observed task is waiting on somebody else; a completed one is done.
    if (task.completed || task.observing) return;
    if (!isTaskOnDate(task, dateStr)) return;

    const at = reminderInstant(task, dateStr);
    if (Number.isNaN(at)) return;
    // Floored to the minute on both sides. The tick is armed to land just after
    // the boundary, so comparing raw milliseconds would make this depend on
    // sub-second timing.
    if (minuteFloor(at) < minuteFloor(from) || minuteFloor(at) > minuteFloor(now)) return;

    const key = firedKey(task, dateStr);
    if (fired[key]) return;
    fired[key] = now;
    due.push(task);
  });

  if (due.length === 0) return;
  saveFired(fired);
  due.forEach(notifyTask);
}

// Armed to the next minute boundary rather than polled: an interval drifts, and
// a check that lands up to 30s late is a reminder that is up to 30s late. The
// offset puts the tick just past the boundary, so the minute being checked has
// actually started.
function armReminderTick() {
  if (reminderTimer !== null) clearTimeout(reminderTimer);
  const now = Date.now();
  reminderTimer = setTimeout(() => {
    reminderTimer = null;
    checkReminders();
    armReminderTick();
  }, Math.max(250, minuteFloor(now) + 60000 - now + 200));
}

function renderReminderButton() {
  const btn = document.getElementById('reminders-btn');
  if (!btn) return;

  if (!remindersSupported()) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');

  if (reminderPermission() === 'denied') {
    // Permission never re-prompts once denied, so this says what to do rather
    // than offering a button that would silently do nothing.
    btn.disabled = true;
    btn.textContent = '🔕 Reminders blocked';
    btn.title = 'Notifications are blocked for this site. Allow them in your browser settings and reload — a page cannot ask a second time.';
    return;
  }

  btn.disabled = false;
  const on = remindersOn();
  btn.textContent = on ? '🔔 Reminders on' : '🔔 Enable reminders';
  btn.title = on
    ? 'Reminders are on. They fire while the app is open, and not once it is closed.'
    : 'Get a notification at a task\'s scheduled time, while the app is open.';
}

async function toggleReminders() {
  const permission = reminderPermission();
  if (permission === 'denied' || permission === 'unsupported') return;

  if (remindersOn()) {
    try { localStorage.setItem(REMINDERS_ON_KEY, '0'); } catch (err) { /* storage blocked */ }
    renderReminderButton();
    return;
  }

  // Requested from a real click. A request made on load is rejected or silently
  // ignored, and iOS is strictest about it.
  let granted = permission;
  if (granted !== 'granted') granted = await Notification.requestPermission();

  if (granted === 'granted') {
    try { localStorage.setItem(REMINDERS_ON_KEY, '1'); } catch (err) { /* storage blocked */ }
    // Anything already due in this minute is worth saying now, rather than
    // waiting for the next boundary.
    lastReminderCheck = Date.now();
    checkReminders();
    armReminderTick();
  }
  renderReminderButton();
}

function initReminders() {
  const btn = document.getElementById('reminders-btn');
  if (btn) btn.addEventListener('click', toggleReminders);

  // A tapped reminder. The worker focuses this window and posts the task id, and
  // bringing that task into view is the only thing that makes the tap feel
  // answered. Best-effort: the task may be gone, completed, or filtered out of
  // whatever view is on screen, and focusing the window is then the whole of it.
  if (remindersSupported() && typeof navigator.serviceWorker.addEventListener === 'function') {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'REMINDER_CLICKED' || !data.taskId) return;
      const card = document.getElementById(`task-card-list-${data.taskId}`) ||
        document.getElementById(`task-card-day-${data.taskId}`);
      if (!card || typeof card.scrollIntoView !== 'function') return;
      const reduceMotion = typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  renderReminderButton();
  if (!remindersSupported()) return;
  armReminderTick();
}

// A suspended tab has its timers throttled, so the minute tick can be missed
// outright. Returning to view is the moment to catch up.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkReminders();
});

// bfcache restore re-runs no timers, so the span since the freeze is only
// observable here.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) checkReminders();
});

initReminders();

// The initial render runs last, after the update prompt's listener is attached.
// If it throws — a stored value the renderer chokes on, markup that outran it —
// the app is broken either way, but at least the "new version is ready" bar can
// still appear and be accepted. Rendering first would leave the user with a dead
// page and no route back to a working build short of clearing site data.
renderAll();
