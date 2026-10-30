-- Schedules the auto-attendance Edge Function every 15 minutes.
-- Not a migration: run it once in the SQL Editor after replacing
--   <PROJECT_REF>   your project reference (Settings > General)
--   <CRON_SECRET>   the same value as the CRON_SECRET Edge Function secret
--   <EMAIL>         the email you sign in to Pointage with
--
-- Prerequisites: the 20261030000000_auto_attendance migration, and the
-- pg_cron and pg_net extensions (Database > Extensions).

-- 1. Keep the secret in Vault rather than in the job's text.
select vault.create_secret('<CRON_SECRET>', 'auto_attendance_cron_secret');

-- 2. Turn it on for your account: 09:00-12:30 and 13:30-18:00, Madagascar
--    time. Change the times here; set enabled to false to stop punching.
insert into public.auto_attendance_preferences (user_id, enabled)
select id, true from auth.users where email = '<EMAIL>'
on conflict (user_id) do update set enabled = true, updated_at = now();

-- 3. Call the function every 15 minutes: the planned times (and the edges of
--    hours off) fall on quarter hours. It does nothing outside them, nor
--    on weekends in your time zone.
select cron.schedule(
  'pointage-auto-attendance',
  '*/15 * * * *',
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
