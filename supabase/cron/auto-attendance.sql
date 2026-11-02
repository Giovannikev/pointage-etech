-- Schedules the auto-attendance Edge Function every minute.
-- Not a migration: run it once in the SQL Editor after replacing
--   <PROJECT_REF>   your project reference (Settings > General)
--   <CRON_SECRET>   the same value as the CRON_SECRET Edge Function secret
--   <EMAIL>         the email you sign in to Pointage with
--
-- Prerequisites: the 20261030000000_auto_attendance migration, and the
-- pg_cron and pg_net extensions (Database > Extensions).
--
-- Already set up with the 15-minute job? Run the
-- 20261102000000_auto_attendance_random_window and
-- 20261102000001_auto_attendance_remote_end migrations, then steps 2 and 3
-- only: scheduling the same name again replaces the job.

-- 1. Keep the secret in Vault rather than in the job's text.
select vault.create_secret('<CRON_SECRET>', 'auto_attendance_cron_secret');

-- 2. Turn it on for your account: 09:00-12:30 and 13:30-17:30, Madagascar
--    time, or 13:30-18:00 on a remote work afternoon; each punch at a random
--    minute within 10 minutes of its time (09:00-09:10, 12:30-12:40...).
--    Change the times and the window here (0 for the exact times, null
--    remote_afternoon_end for the same check-out every day); set enabled to
--    false to stop punching.
insert into public.auto_attendance_preferences
  (user_id, enabled, afternoon_end, remote_afternoon_end, random_window_minutes)
select id, true, '17:30', '18:00', 10 from auth.users where email = '<EMAIL>'
on conflict (user_id) do update
  set enabled = true,
      afternoon_end = excluded.afternoon_end,
      remote_afternoon_end = excluded.remote_afternoon_end,
      random_window_minutes = excluded.random_window_minutes,
      updated_at = now();

-- 3. Call the function every minute, for the random minutes. It reads Odoo
--    only at quarter hours (where hours off start and end) and at the next
--    punch, and does nothing outside working hours nor on weekends in your
--    time zone.
select cron.schedule(
  'pointage-auto-attendance',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/auto-attendance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'auto_attendance_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- To pause it:  update public.auto_attendance_preferences set enabled = false;
-- To stop it:   select cron.unschedule('pointage-auto-attendance');
-- To check it:  select * from cron.job_run_details order by start_time desc limit 10;
