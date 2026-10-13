-- Daily reminder preferences: when to remind a user who hasn't logged a
-- full day in Odoo. Nothing here is secret, so the user reads and writes
-- their own row directly (RLS); the daily-reminder Edge Function reads every
-- row through the service role.
create table public.reminder_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  -- Local hour (0-23) from which the day is checked, on working days.
  remind_hour smallint not null default 17
    check (remind_hour between 0 and 23),
  -- IANA time zone of the user, e.g. 'Indian/Antananarivo'.
  timezone text not null default 'Indian/Antananarivo'
    check (char_length(timezone) between 1 and 64),
  language text not null default 'fr' check (language in ('fr', 'en')),
  -- Local day last checked, so a day triggers one email at most.
  last_checked_on date,
  updated_at timestamptz not null default now()
);

alter table public.reminder_preferences enable row level security;

create policy "Users read their reminder preferences"
  on public.reminder_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their reminder preferences"
  on public.reminder_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their reminder preferences"
  on public.reminder_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.reminder_preferences from anon;
grant select, insert, update on table public.reminder_preferences
  to authenticated;
