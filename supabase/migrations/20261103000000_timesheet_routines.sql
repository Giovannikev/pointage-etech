-- Timesheet routines: a line logged in Odoo every working day at a set
-- time (a break, organizing the day's work). The auto-attendance Edge
-- Function, run every minute by pg_cron, logs those due and skips days off.
-- Nothing here is secret, so the user reads and writes their own rows
-- directly (RLS); the function reads every row through the service role.
create table public.timesheet_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  -- The Odoo instance (1 or 2 in the settings) and the task to log on.
  instance_index smallint not null check (instance_index in (1, 2)),
  project_id integer not null check (project_id > 0),
  task_id integer not null check (task_id > 0),
  -- Names as they were when the routine was made, for the app to show.
  task_name text not null check (char_length(task_name) <= 500),
  project_name text check (char_length(project_name) <= 500),
  description text not null
    check (char_length(description) between 1 and 1000),
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  -- Local time of the day the line is logged, in timezone.
  log_at time not null default '17:00',
  timezone text not null default 'Indian/Antananarivo'
    check (char_length(timezone) between 1 and 64),
  -- The last local day handled (logged, found, or skipped as a day off).
  last_logged_on date,
  created_at timestamptz not null default now()
);

create index timesheet_routines_user_id_idx
  on public.timesheet_routines (user_id);

alter table public.timesheet_routines enable row level security;

create policy "Users read their timesheet routines"
  on public.timesheet_routines for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their timesheet routines"
  on public.timesheet_routines for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their timesheet routines"
  on public.timesheet_routines for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their timesheet routines"
  on public.timesheet_routines for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.timesheet_routines from anon;
grant select, insert, update, delete on table public.timesheet_routines
  to authenticated;
