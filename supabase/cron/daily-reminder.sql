-- Schedules the daily-reminder Edge Function every 15 minutes.
-- Not a migration: run it once in the SQL Editor after replacing
--   <PROJECT_REF>   your project reference (Settings > General)
--   <CRON_SECRET>   the same value as the CRON_SECRET Edge Function secret
--
-- Prerequisites: enable the pg_cron and pg_net extensions
-- (Database > Extensions).

-- 1. Keep the secret in Vault rather than in the job's text.
select vault.create_secret('<CRON_SECRET>', 'daily_reminder_cron_secret');

-- 2. Call the function every 15 minutes. It only emails users whose local
--    reminder hour has passed, once per working day.
select cron.schedule(
  'pointage-daily-reminder',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'daily_reminder_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- To stop it:   select cron.unschedule('pointage-daily-reminder');
-- To check it:  select * from cron.job_run_details order by start_time desc limit 10;
