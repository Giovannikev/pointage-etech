-- Automatic attendance: another check-out time on remote work afternoons.
-- When a request of a "worked time" type (remote work) covers the end of the
-- afternoon, the check-out is at remote_afternoon_end instead of
-- afternoon_end: 18:00 at home, 17:30 at the office. Null keeps afternoon_end.
alter table public.auto_attendance_preferences
  add column remote_afternoon_end time,
  add check (
    remote_afternoon_end is null or afternoon_start < remote_afternoon_end
  );
