# Agent Handover Specification & Project Blueprint (`agent.md`)

> **Project Name**: Simple Task Management & Focus Timer (PWA + Supabase + Vercel)  
> **Repository Location**: `f:\TaskManagement`  
> **Target Audience**: Personal Productivity with Focus Queue, Observation Tracking, Natural Language Parser, Analytics, and On-Time Scheduled Reminders.  
> **Tech Stack**: HTML5, Vanilla JavaScript, Modular CSS, Progressive Web App (PWA), Supabase (Auth + PostgreSQL + Realtime + Edge Functions), Vercel (Hosting + CI/CD).

---

## 1. Executive Summary & Vision

This application is a fast, keyboard-friendly, dual-mode productivity tool designed for daily execution. It eliminates bloated project management tools in favor of:
1. **Zero-Friction Quick-Text Input**: Typing `9am`, `10:20am`, `22-9`, `today` instantly parses date and time without forced scroll wheels.
2. **Strict Chronological Ordering**: Tasks are always sorted from earliest (lowest time) to latest (highest time).
3. **Top Focus Queue (Max 4 Tasks)**: A vertical priority stack where tasks can be tracked with live Start/Stop timers.
4. **"Observing" Mode (Waiting-On / Follow-up)**: A separate dedicated section for tasks awaiting external responses (e.g. applied for debit card, submitted papers) with progress update logs.
5. **Day View**: Day-by-day vertical group schedule.
6. **Dual UI Modes**: Modern GUI and Retro Terminal TUI, both supporting Dark and Light themes.
7. **Next Step**: Cloud synchronization with Supabase, Vercel deployment, PWA mobile installation, and push/on-time notification reminders.

---

## 2. Current File Structure & State

```
f:\TaskManagement\
├── index.html        # Main SPA markup (Header, Focus Queue, Sidebar, Content, Day View, Analytics Modal)
├── style.css         # Complete design system (GUI & TUI variables, Dark/Light modes, Focus Queue, Analytics)
├── app.js            # Core application logic, natural text parser, timer engine, local storage persistence
└── agent.md          # Handover blueprint, architecture, schema, and next steps (This File)
```

---

## 3. Implemented Features & Technical Details

### 3.1. Dual UI & Theme Architecture
- **UI Modes**:
  - `mode-gui`: Modern typography (`Inter`), rounded cards, smooth shadows, and clean buttons.
  - `mode-terminal`: Monospace typography (`Fira Code`), traffic-light window dots (`🔴 🟡 🟢`), command prompts (`$ all-tasks`, `task>`, `❯`), ASCII box borders (`┌─ ... ─┐`), and CLI pill tags.
- **Theme Modes**: `theme-dark` & `theme-light` configured via CSS custom properties on `document.body`. Persisted in `localStorage.getItem('tm_theme')` and `localStorage.getItem('tm_ui_mode')`.

### 3.2. Natural Text & Date/Time Parser (`app.js`)
- **Time Parser (`parseTimeString`)**:
  - `9am` &rarr; `09:00` (`9:00 AM`)
  - `10:20am` &rarr; `10:20` (`10:20 AM`)
  - `10pm` / `22:00` &rarr; `22:00` (`10:00 PM`)
  - `14:30`, `9.30am`, single digits `9` &rarr; `09:00`
- **Date Parser (`parseDateString`)**:
  - `22-9` / `22/9` &rarr; `YYYY-09-22` (Day-Month without requiring year entry)
  - `today` &rarr; Current local date
  - `tomorrow` / `tmrw` &rarr; Next day's date
  - `2026-09-22` &rarr; Full ISO format
- **Natural Title Extraction (`extractDateTimeFromTitle`)**:
  - If a user types `"Team standup 10:20am 22-9"`, it automatically extracts time `10:20` and date `2026-09-22`, leaving the title as `"Team standup"`.

### 3.3. Chronological Sorting Engine (`sortTasksByDateTime`)
- Sorts tasks by Due Date ascending, and within the same date, sorts strictly by Time ascending (`09:00` &rarr; `10:30` &rarr; `17:00`). Untimed tasks follow at the end.
- Inline time and date edits on cards trigger real-time re-sorting.

### 3.4. Top Focus Queue (Vertical Stack, Max 4 Tasks)
- Each task card features a `[ + Que ]` / `[ ⚡ Queued ]` toggle button beside the timer button.
- Up to 4 tasks can be queued into `#top-focus-bar`, displayed vertically in priority order (`#1`, `#2`, `#3`, `#4`).
- Shows live elapsed timers, live pulsing indicator, inline Start/Stop toggle, and an un-queue button.

### 3.5. Focus Timers Engine
- Single toggle button `[ ▶ START ]` &harr; `[ ⏸ STOP ]` on every task card.
- Tracks `elapsedSeconds` with a global 1-second interval loop that updates UI labels dynamically without full DOM re-renders.

### 3.6. "Observing" Section & Follow-up Logs
- Clicking `[ 👁 OBSERVE ]` removes the task from "All Tasks", regular group views, and Day View.
- Moves the task into the dedicated **`👀 Observing`** sidebar view.
- Supports appending follow-up notes (e.g., *"22-9: Submitted application"*, *"24-9: Received tracking SMS"*).
- Toggling off moves the task back into active lists.

### 3.7. Analytics Modal Window
- Triggered via **`📊 View Analytics`** in the sidebar.
- Computes:
  - Total Work Time (e.g. `2h 45m`).
  - Tasks Completed vs Active vs Observing.
  - Time Spent Breakdown per Group (`Work`, `Personal`, `Home`) with progress bars.
  - Top focused tasks ranked by time spent.

---

## 4. Next Implementation Phase: Supabase & Vercel Integration

### 4.1. Supabase Database Schema (PostgreSQL)

Run the following SQL in your Supabase SQL Editor:

```sql
-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. User Profiles / Settings Table
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  ui_mode TEXT DEFAULT 'mode-terminal',
  theme TEXT DEFAULT 'theme-dark',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Task Groups Table
CREATE TABLE task_groups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tasks Table
CREATE TABLE tasks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  group_name TEXT DEFAULT 'Personal' NOT NULL,
  due_date DATE DEFAULT CURRENT_DATE,
  scheduled_time TIME WITHOUT TIME ZONE,
  recur TEXT DEFAULT 'none',
  completed BOOLEAN DEFAULT false,
  observing BOOLEAN DEFAULT false,
  queued BOOLEAN DEFAULT false,
  elapsed_seconds INTEGER DEFAULT 0,
  is_timing BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Subtasks Table
CREATE TABLE subtasks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Observation Notes Table
CREATE TABLE observation_notes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_notes ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies
CREATE POLICY "Users can manage own profile" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users can manage own groups" ON task_groups FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage subtasks of own tasks" ON subtasks FOR ALL USING (
  EXISTS (SELECT 1 FROM tasks WHERE tasks.id = subtasks.task_id AND tasks.user_id = auth.uid())
);
CREATE POLICY "Users can manage notes of own tasks" ON observation_notes FOR ALL USING (
  EXISTS (SELECT 1 FROM tasks WHERE tasks.id = observation_notes.task_id AND tasks.user_id = auth.uid())
);
```

---

## 5. Scheduled On-Time Notifications Implementation

To send reminders to the user's phone at the exact scheduled time (e.g. `9:00 AM` on `22-9`):

### 5.1. Client-Side (Web Push & Notification API)
1. **Request Notification Permission**:
   ```javascript
   async function requestNotificationPermission() {
     if ('Notification' in window && Notification.permission !== 'granted') {
       await Notification.requestPermission();
     }
   }
   ```
2. **Local Timer Trigger (In-App)**:
   - `setInterval` checks every 30 seconds if any task's `due_date` and `scheduled_time` matches current local time.
   - Triggers:
     ```javascript
     new Notification(`⏰ Task Reminder: ${task.title}`, {
       body: `Group: ${task.group} | Time: ${formatTime12Hour(task.time)}`,
       icon: '/icon-192.png'
     });
     ```

### 5.2. Background Server-Side Push (Supabase Edge Function + pg_cron)
1. Store Web Push Subscriptions in a Supabase table (`push_subscriptions`).
2. Schedule a Supabase pg_cron job to run every minute:
   ```sql
   SELECT cron.schedule(
     'check-due-tasks',
     '* * * * *',
     $$ SELECT net.http_post(
          url:='https://<project-ref>.supabase.co/functions/v1/send-task-reminder',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
        ); $$
   );
   ```
3. The Edge Function checks tasks where `due_date = CURRENT_DATE` and `scheduled_time = CURRENT_TIME` and sends a Web Push notification to the user's phone.

---

## 6. PWA Files & Vercel Deployment

### 6.1. `manifest.json`
```json
{
  "name": "Task Manager",
  "short_name": "TaskMan",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#161b22",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 6.2. `sw.js` (Service Worker)
```javascript
const CACHE_NAME = 'taskman-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
```

### 6.3. Vercel Configuration (`vercel.json`)
```json
{
  "version": 2,
  "routes": [
    { "src": "/sw.js", "headers": { "cache-control": "no-cache" } },
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

---

## 7. Step-by-Step Instructions for Claude Code / Handover Agent

1. **Keep the Core Intact**: Preserve the existing natural text parser (`parseTimeString`, `parseDateString`, `extractDateTimeFromTitle`), sorting logic, and dual UI/theme CSS.
2. **Supabase Client SDK**:
   - Add `@supabase/supabase-js` via CDN `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` or npm module.
   - Initialize with `supabaseUrl` and `supabaseAnonKey`.
3. **Authentication**:
   - Add simple email/magic link or Google OAuth login modal.
4. **Cloud Sync**:
   - Replace `localStorage` reads/writes with Supabase queries with fallback to `localStorage` when offline.
5. **Install on Phone**:
   - Connect GitHub repo to Vercel.
   - Open Vercel URL on mobile Safari/Chrome & tap **Add to Home Screen / Install**.
6. **On-Time Reminders**:
   - Enable Notification permissions on the mobile PWA and connect Web Push API via Supabase Edge Function.
