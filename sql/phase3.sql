-- Task Manager — Phase 3 migration for an existing project.
--
-- Run this once in the Supabase SQL Editor, AFTER sql/schema.sql. It only
-- changes things schema.sql got wrong for sync; nothing here touches your rows.
--
-- schema.sql has already been corrected, so a project created from scratch
-- needs none of this. This file exists because yours was created before that
-- fix, and re-running schema.sql alone would not undo what is already there —
-- there is no `drop trigger` for a trigger schema.sql no longer declares.


-- ---------------------------------------------------------------------------
-- 1. Let the client own updated_at on the two synced tables.
--
-- Both triggers write now() on every update, which records when a row arrived
-- rather than when the edit was made. Last-write-wins compares exactly those,
-- so with the triggers in place a device that was offline all week resolves
-- its conflicts backwards and its stale edits win.
--
-- profiles keeps its trigger: nothing there is ever edited offline on two
-- devices, so the database's own clock is the more trustworthy one.
-- ---------------------------------------------------------------------------

drop trigger if exists tasks_set_updated_at on public.tasks;
drop trigger if exists task_groups_set_updated_at on public.task_groups;


-- ---------------------------------------------------------------------------
-- 2. Make (user_id, name) usable as an upsert target for groups.
--
-- The original index was partial — `where deleted_at is null` — and Postgres
-- can only infer a partial index as a conflict target when the statement
-- repeats that WHERE clause. PostgREST cannot emit one, so every group sync
-- would fail with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" and no group would ever reach the server.
--
-- If this errors with "could not create unique index", you have two rows with
-- the same name for one user — one of them already soft-deleted. Delete the
-- older tombstone and run it again:
--
--   delete from public.task_groups
--    where deleted_at is not null
--      and id not in (select id from public.task_groups where deleted_at is null);
--
-- On a project that has not synced yet the tables are empty and it will simply
-- succeed.
-- ---------------------------------------------------------------------------

drop index if exists public.task_groups_user_name_key;

create unique index if not exists task_groups_user_name_key
  on public.task_groups (user_id, name);


-- ---------------------------------------------------------------------------
-- Check: this must return zero rows.
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and rowsecurity = false;
--
-- A `false` here means the anon key has become a master key over that table —
-- anyone could read and delete every user's tasks straight from the REST API,
-- with no sign-in at all.
-- ---------------------------------------------------------------------------
