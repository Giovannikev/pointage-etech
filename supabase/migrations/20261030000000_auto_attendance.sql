-- Automatic attendance: when to check a user in and out of Odoo on working
-- days. Nothing here is secret, so the user reads and writes their own row
-- directly (RLS); the auto-attendance Edge Function reads every row through
-- the service role.
create table public.auto_attendance_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  -- IANA time zone of the schedule, e.g. 'Indian/Antananarivo'.
  timezone text not null default 'Indian/Antananarivo'
    check (char_length(timezone) between 1 and 64),
  -- Local times: in at morning_start, out at morning_end, and so on.
  morning_start time not null default '09:00',
  morning_end time not null default '12:30',
  afternoon_start time not null default '13:30',
  afternoon_end time not null default '18:00',
  -- The last planned punch handled, so a punch isn't made twice.
  last_punch_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    morning_start < morning_end
    and morning_end <= afternoon_start
    and afternoon_start < afternoon_end
  )
);

alter table public.auto_attendance_preferences enable row level security;

create policy "Users read their auto attendance preferences"
  on public.auto_attendance_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their auto attendance preferences"
  on public.auto_attendance_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their auto attendance preferences"
  on public.auto_attendance_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.auto_attendance_preferences from anon;
grant select, insert, update on table public.auto_attendance_preferences
  to authenticated;
