-- The daily reminder email is gone (its Edge Function and cron job too):
-- drop its preferences.
drop table if exists public.reminder_preferences;
