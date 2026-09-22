-- Task Manager — database schema.
--
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- It is safe to run again: everything is `if not exists` / `create or replace`.
--
-- The app is offline-first. localStorage stays the source of truth for what you
-- see; this database is a replica that catches up in the background. Three
-- consequences shape everything below:
--
--   * Last-write-wins needs `updated_at` on every row, or two devices cannot be
--     reconciled and the last write wins regardless of when it happened. It is
--     the *client* that writes that column, not the database — see the section
--     before Row Level Security for why the trigger has to be absent.
--
--   * Deletes need to be tombstones (`deleted_at`), not real deletes. A row that
--     is simply gone cannot be propagated — the other device still has it, sees
--     nothing missing, and uploads it again. Every read filters them out.
--
--   * Subtasks and notes are `jsonb` columns on `tasks`, not their own tables.
--     A task is then one row, so saving it is one atomic write. As separate
--     tables every save becomes a multi-table transaction with half-finished
--     states to reconcile, for no benefit: the app already holds both as plain
--     arrays on the task object.


-- =========================================================
-- profiles — one row per account, created automatically
-- =========================================================

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  ui_mode    text not null default 'mode-terminal',
  theme      text not null default 'theme-dark',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The account row is created by a trigger rather than by the app. Without this
-- the table stays permanently empty — signing up does not insert anything by
-- itself — and the ui_mode / theme columns would be dead weight.
--
-- `security definer` lets the insert past RLS, which matters because the new
-- user has no session yet at the moment the row is written. `set search_path`
-- is required on any definer function: without it a caller can shadow the
-- names this body resolves and run their own code as the definer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =========================================================
-- task_groups
-- =========================================================

create table if not exists public.task_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Not a partial index, deliberately. PostgREST expresses an upsert as
-- `on conflict (user_id, name)`, and Postgres can only infer a *partial* index
-- when the statement repeats its WHERE clause — which PostgREST cannot emit. A
-- partial index here fails at runtime with "no unique or exclusion constraint
-- matching the ON CONFLICT specification", and the group sync silently never
-- works. The cost of the full index is that a soft-deleted group name cannot be
-- reused while its tombstone exists; the client pushes deleted_at = null on
-- conflict, which un-deletes rather than colliding.
create unique index if not exists task_groups_user_name_key
  on public.task_groups (user_id, name);

create index if not exists task_groups_user_idx
  on public.task_groups (user_id);


-- =========================================================
-- tasks
-- =========================================================

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  title             text not null default '',
  -- Named group_name, not group: `group` is a reserved word in SQL and would
  -- need quoting at every use site.
  group_name        text not null default 'Personal',
  due_date          date,
  scheduled_time    time,
  recur             text not null default 'none'
                      check (recur in ('none', 'daily', 'weekly')),

  completed         boolean not null default false,
  -- The day the box was ticked. The Completed view uses it to tell yesterday's
  -- work from today's, so it is a date, not a timestamp.
  completed_at      date,
  observing         boolean not null default false,

  queued            boolean not null default false,
  queued_at         bigint,
  elapsed_seconds   integer not null default 0,
  -- Wall-clock start of the running timer. Elapsed is derived from this rather
  -- than counted by a tick, so a throttled background tab and a reload both
  -- report the right number.
  timer_started_at  timestamptz,

  subtasks          jsonb not null default '[]'::jsonb,
  observe_notes     jsonb not null default '[]'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists tasks_user_idx
  on public.tasks (user_id);
-- The pull is "everything for this user changed since X", which is exactly this
-- index. Without it every sync is a full scan of every task you have ever made.
create index if not exists tasks_user_updated_idx
  on public.tasks (user_id, updated_at);


-- =========================================================
-- updated_at — supplied by the client on the two synced tables
-- =========================================================
--
-- Deliberately NO trigger on tasks or task_groups. A `before update` trigger
-- writing `now()` records when the row *arrived*, not when the edit was made,
-- and last-write-wins compares exactly those two things. With the trigger in
-- place, a phone that was offline all week pushes on Friday and takes its
-- seven-day-old edit over a newer one made on the desktop on Thursday — the
-- conflict resolves backwards, which is worse than not resolving it at all.
--
-- So the client stamps updated_at from its own clock. The cost is that a device
-- with a badly wrong clock can win a conflict it should lose; for a single-user
-- app that is the better trade.
--
-- profiles has no such conflict — nothing is edited on two devices offline — so
-- the database maintains its timestamp, which is one less thing to trust a
-- client for.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- =========================================================
-- Row Level Security
-- =========================================================
--
-- This is the whole security model, and it is why the anon key is safe to
-- publish. That key only identifies the *app*; it carries no permission of its
-- own. Every row here is reachable only by a signed-in user whose id matches
-- `auth.uid()`, which is set from their session token.
--
-- The caveat worth knowing: if RLS is ever switched off on a table, the anon
-- key silently becomes a master key over every row in it — anyone could read
-- and delete every user's tasks straight from the REST API. So: RLS on every
-- table, and a policy on every table. The check below is
-- `select * from tasks` with only the anon key — it must return zero rows.

alter table public.profiles    enable row level security;
alter table public.task_groups enable row level security;
alter table public.tasks       enable row level security;

-- `for all` covers select, insert, update and delete in one policy. For an
-- omitted `with check`, Postgres falls back to the `using` expression, so this
-- constrains writes too — an insert cannot claim someone else's user_id.
-- Deliberately no policy grants `service_role`: nothing in this app needs it.

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists task_groups_own on public.task_groups;
create policy task_groups_own on public.task_groups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists tasks_own on public.tasks;
create policy tasks_own on public.tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
