-- Automatic attendance at a random minute: each punch falls up to
-- random_window_minutes after its planned time (09:00-09:10 for 10), drawn
-- anew each day. 0 keeps the exact times.
alter table public.auto_attendance_preferences
  add column random_window_minutes smallint not null default 0
    check (random_window_minutes between 0 and 60),
  -- The next punch, as of the last Odoo read: the function, now run every
  -- minute, reads Odoo only then and at quarter hours.
  add column next_punch_at timestamptz;
