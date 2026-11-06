-- Run once in Supabase Dashboard -> SQL Editor.

-- Your own shareable card (the "Linktree" people see when they scan your QR).
create table profiles (
  id uuid primary key default auth.uid() references auth.users on delete cascade,
  name text not null,
  headline text,                  -- "Founder @ SolarCo"
  phone text,
  email text,
  city text,
  help_with text,                 -- what I can help others with
  photo_path text,                -- in public "avatars" bucket
  links jsonb not null default '[]', -- [{label, url}]
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  date date,
  place text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  event_id uuid references events on delete set null,
  profile_id uuid references profiles on delete set null, -- set when added by QR exchange
  name text not null,
  phone text,
  email text,
  company text,
  met_where text,                 -- free text: "Goa trip", "referred by Ravi", ...
  help_note text,                 -- how they can help now / in future
  importance smallint not null default 2 check (importance between 1 and 4), -- 1 VIMP, 2 IMP, 3 normal, 4 low
  contact_every_days int not null default 30 check (contact_every_days > 0),
  last_contacted_at timestamptz not null default now(),
  selfie_path text,
  card_path text,
  avatar_path text,               -- their profile photo, from QR exchange
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  unique (user_id, profile_id)
);

create index on contacts (user_id);
create index on contacts (event_id);

-- Every user sees only their own rows.
alter table profiles enable row level security;
alter table events enable row level security;
alter table contacts enable row level security;
create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own events" on events for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own contacts" on contacts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Read ONE card by id (from a QR link). No policy lets anyone list all profiles.
create function get_profile(pid uuid) returns setof profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where id = pid
$$;
grant execute on function get_profile(uuid) to anon, authenticated;

-- QR exchange: add them to my list and me to theirs. Returns my new contact id.
create function connect_with(pid uuid, lat double precision default null, lng double precision default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  them profiles;
  cid uuid;
begin
  if auth.uid() is null or pid = auth.uid() then raise exception 'Cannot connect with this card'; end if;
  select * into me from profiles where id = auth.uid();
  select * into them from profiles where id = pid;
  if me.id is null then raise exception 'Create your own card first'; end if;
  if them.id is null then raise exception 'Card not found'; end if;

  insert into contacts (user_id, profile_id, name, phone, help_note, met_where, avatar_path, lat, lng)
  values (me.id, them.id, them.name, them.phone, them.help_with, 'QR exchange', them.photo_path, lat, lng)
  on conflict (user_id, profile_id) do update set last_contacted_at = now()
  returning id into cid;

  insert into contacts (user_id, profile_id, name, phone, help_note, met_where, avatar_path, lat, lng)
  values (them.id, me.id, me.name, me.phone, me.help_with, 'QR exchange', me.photo_path, lat, lng)
  on conflict (user_id, profile_id) do nothing;

  return cid;
end $$;
grant execute on function connect_with(uuid, double precision, double precision) to authenticated;

-- Private photo bucket (selfies, visiting cards); files live under "<user_id>/..."
insert into storage.buckets (id, name, public) values ('photos', 'photos', false);
create policy "own photos" on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Public bucket for profile photos shown on your card; only you can write your folder.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
create policy "own avatars" on storage.objects for all
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- Phone/browser push subscriptions for "time to call" reminders. Safe to run more than once.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on push_subscriptions;
create policy "own push subscriptions" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
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
-- What you talked about on each call, as a history per person. Safe to run more than once.
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  contact_id uuid not null references contacts on delete cascade,
  kind text not null default 'call' check (kind in ('call', 'note')),
  format text not null default 'note' check (format in ('note', 'points')), -- points: one per line
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists interactions_contact_idx on interactions (contact_id, created_at desc);
alter table interactions enable row level security;
drop policy if exists "own interactions" on interactions;
create policy "own interactions" on interactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
