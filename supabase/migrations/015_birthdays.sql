-- Birthday reminders: an optional date per contact, checked by the same daily cron that already
-- sends "time to call" push notifications (see supabase/functions/send-reminders). Safe to run more than once.
alter table contacts add column if not exists birthday date;
