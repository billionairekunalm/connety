-- Run AFTER deploying the send-reminders function and storing the cron secret in Vault:
--   select vault.create_secret('<CRON_SECRET from your .env>', 'cron_secret');
-- Sends reminders every day at 9:00 AM India time (03:30 UTC).
-- ponytail: one fixed time for everyone; add a per-user reminder hour if people ask for it.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('call-reminders') where exists (select 1 from cron.job where jobname = 'call-reminders');
select cron.schedule('call-reminders', '30 3 * * *', $$
  select net.http_post(
    url := 'https://tsdkajtobvdtosxrnhth.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
$$);
