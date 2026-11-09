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
-- Hometown + where someone lives now. profiles.city already means "lives in". Safe to run more than once.
alter table profiles add column if not exists hometown text;
alter table contacts add column if not exists hometown text;
alter table contacts add column if not exists current_city text;

-- QR exchange now also copies email, hometown and current city into each other's lists.
create or replace function connect_with(pid uuid, lat double precision default null, lng double precision default null) returns uuid
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

  insert into contacts (user_id, profile_id, name, phone, email, help_note, met_where, avatar_path, hometown, current_city, lat, lng)
  values (me.id, them.id, them.name, them.phone, them.email, them.help_with, 'QR exchange', them.photo_path, them.hometown, them.city, lat, lng)
  on conflict (user_id, profile_id) do update set last_contacted_at = now()
  returning id into cid;

  insert into contacts (user_id, profile_id, name, phone, email, help_note, met_where, avatar_path, hometown, current_city, lat, lng)
  values (them.id, me.id, me.name, me.phone, me.email, me.help_with, 'QR exchange', me.photo_path, me.hometown, me.city, lat, lng)
  on conflict (user_id, profile_id) do nothing;

  return cid;
end $$;
-- A specific date for the next call, picked after a call. Null = use "call every X days". Safe to run more than once.
alter table contacts add column if not exists next_call_at timestamptz;
-- Event rooms: an organiser creates a room with a join QR and a time window.
-- Members see each other (photo, name, headline, city only) while the room is live.
-- Full details still need the personal QR exchange; people met in a room are filed under that event.
-- Safe to run more than once.

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  place text,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists room_members (
  room_id uuid not null references rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table events add column if not exists room_id uuid references rooms on delete set null;

alter table rooms enable row level security;
alter table room_members enable row level security;
drop policy if exists "organizer manages room" on rooms;
create policy "organizer manages room" on rooms for all using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());
drop policy if exists "see own memberships" on room_members;
create policy "see own memberships" on room_members for select using (user_id = auth.uid());
-- Joining only happens through join_room() below.

-- Public preview for the join page: no attendee names, just the count.
create or replace function get_room(rid uuid)
returns table (id uuid, name text, place text, description text, starts_at timestamptz, ends_at timestamptz,
               organizer_id uuid, organizer_name text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.place, r.description, r.starts_at, r.ends_at, r.organizer_id, p.name,
         (select count(*) from room_members m where m.room_id = r.id)
  from rooms r left join profiles p on p.id = r.organizer_id
  where r.id = rid
$$;
grant execute on function get_room(uuid) to anon, authenticated;

-- Rooms I host or joined.
create or replace function my_rooms()
returns table (id uuid, name text, place text, description text, starts_at timestamptz, ends_at timestamptz,
               organizer_id uuid, organizer_name text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.place, r.description, r.starts_at, r.ends_at, r.organizer_id, p.name,
         (select count(*) from room_members m where m.room_id = r.id)
  from rooms r left join profiles p on p.id = r.organizer_id
  where r.organizer_id = auth.uid() or exists (select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid())
  order by r.starts_at desc
$$;
grant execute on function my_rooms() to authenticated;

-- Join a room (needs your own card) and get the room as an event in your Events tab. Returns that event id.
create or replace function join_room(rid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
  eid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'Create your own card first'; end if;
  select * into r from rooms where id = rid;
  if r.id is null then raise exception 'Room not found'; end if;
  if now() > r.ends_at then raise exception 'This room has ended'; end if;

  insert into room_members (room_id, user_id) values (rid, auth.uid()) on conflict do nothing;
  select id into eid from events where user_id = auth.uid() and room_id = rid;
  if eid is null then
    insert into events (user_id, name, date, place, lat, lng, room_id)
    values (auth.uid(), r.name, (r.starts_at at time zone 'Asia/Kolkata')::date, r.place, r.lat, r.lng, rid)
    returning id into eid;
  end if;
  return eid;
end $$;
grant execute on function join_room(uuid) to authenticated;

-- Who's in the room: limited fields only, only for members, only while live (the organiser can always look).
create or replace function room_people(rid uuid)
returns table (user_id uuid, name text, headline text, city text, photo_path text, is_organizer boolean)
language plpgsql stable security definer set search_path = public as $$
declare r rooms;
begin
  select * into r from rooms where id = rid;
  if r.id is null then return; end if;
  if r.organizer_id <> auth.uid() then
    if not exists (select 1 from room_members where room_id = rid and room_members.user_id = auth.uid()) then return; end if;
    if now() < r.starts_at or now() > r.ends_at then return; end if;
  end if;
  return query
    select p.id, p.name, p.headline, p.city, p.photo_path, p.id = r.organizer_id
    from room_members m join profiles p on p.id = m.user_id
    where m.room_id = rid and m.user_id <> auth.uid()
    order by m.joined_at;
end $$;
grant execute on function room_people(uuid) to authenticated;

-- QR exchange, now also filing both people under a room they share (if it's live or ended within a day).
create or replace function connect_with(pid uuid, lat double precision default null, lng double precision default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  them profiles;
  cid uuid;
  tid uuid;
  shared rooms;
begin
  if auth.uid() is null or pid = auth.uid() then raise exception 'Cannot connect with this card'; end if;
  select * into me from profiles where id = auth.uid();
  select * into them from profiles where id = pid;
  if me.id is null then raise exception 'Create your own card first'; end if;
  if them.id is null then raise exception 'Card not found'; end if;

  insert into contacts (user_id, profile_id, name, phone, email, help_note, met_where, avatar_path, hometown, current_city, lat, lng)
  values (me.id, them.id, them.name, them.phone, them.email, them.help_with, 'QR exchange', them.photo_path, them.hometown, them.city, lat, lng)
  on conflict (user_id, profile_id) do update set last_contacted_at = now()
  returning id into cid;

  insert into contacts (user_id, profile_id, name, phone, email, help_note, met_where, avatar_path, hometown, current_city, lat, lng)
  values (them.id, me.id, me.name, me.phone, me.email, me.help_with, 'QR exchange', me.photo_path, me.hometown, me.city, lat, lng)
  on conflict (user_id, profile_id) do nothing;

  select r.* into shared from rooms r
    join room_members a on a.room_id = r.id and a.user_id = me.id
    join room_members b on b.room_id = r.id and b.user_id = them.id
    where now() between r.starts_at - interval '1 hour' and r.ends_at + interval '1 day'
    order by r.starts_at desc limit 1;
  if shared.id is not null then
    update contacts set met_where = shared.name,
      event_id = (select id from events where user_id = me.id and room_id = shared.id)
      where id = cid;
    update contacts set met_where = shared.name,
      event_id = (select id from events where user_id = them.id and room_id = shared.id)
      where user_id = them.id and profile_id = me.id;
  end if;

  return cid;
end $$;
-- Fix: signed-out callers must never see room guests (a NULL comparison skipped the checks).
-- Also stop anon from calling member-only functions at all.
create or replace function room_people(rid uuid)
returns table (user_id uuid, name text, headline text, city text, photo_path text, is_organizer boolean)
language plpgsql stable security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then return; end if;
  select * into r from rooms where id = rid;
  if r.id is null then return; end if;
  if r.organizer_id is distinct from auth.uid() then
    if not exists (select 1 from room_members where room_id = rid and room_members.user_id = auth.uid()) then return; end if;
    if now() < r.starts_at or now() > r.ends_at then return; end if;
  end if;
  return query
    select p.id, p.name, p.headline, p.city, p.photo_path, p.id = r.organizer_id
    from room_members m join profiles p on p.id = m.user_id
    where m.room_id = rid and m.user_id <> auth.uid()
    order by m.joined_at;
end $$;
revoke execute on function room_people(uuid) from public, anon;
revoke execute on function my_rooms() from public, anon;
revoke execute on function join_room(uuid) from public, anon;
grant execute on function room_people(uuid) to authenticated;
grant execute on function my_rooms() to authenticated;
grant execute on function join_room(uuid) to authenticated;
-- Only people who host events see "Create a room". Set during card setup or in Edit card. Safe to run more than once.
alter table profiles add column if not exists hosts_events boolean not null default false;
-- Live updates: the app listens for changes to your own rows (row level security still applies,
-- so you only ever receive changes you're allowed to see). Safe to run more than once.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'events', 'interactions', 'rooms', 'profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- Private per-user settings (never part of the public card). categories: [{name, color}],
-- first = most important; contacts.importance is the 1-based position (up to 8). Safe to run more than once.
create table if not exists user_settings (
  id uuid primary key default auth.uid() references auth.users on delete cascade,
  categories jsonb,
  updated_at timestamptz not null default now()
);
alter table user_settings enable row level security;
drop policy if exists "own settings" on user_settings;
create policy "own settings" on user_settings for all using (id = auth.uid()) with check (id = auth.uid());

alter table contacts drop constraint if exists contacts_importance_check;
alter table contacts add constraint contacts_importance_check check (importance between 1 and 8);
-- Your country, used for the phone code on your card and as the default for people you add. Safe to run more than once.
alter table profiles add column if not exists country text;
-- Meetup posts: "I'm going to be in X on these dates" for your connections to join offline.
-- A post is visible to the poster and to every mutual connection (QR-exchanged, profile_id set).
-- Safe to run more than once.

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  place text not null,
  note text,
  starts_at date not null,
  ends_at date not null,
  event_id uuid references events on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index if not exists posts_user_idx on posts (user_id);

create table if not exists post_responses (
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table posts enable row level security;
alter table post_responses enable row level security;

drop policy if exists "manage own posts" on posts;
create policy "manage own posts" on posts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- A mutual connection is someone you've QR-exchanged with: you hold a contact row pointing at their profile.
drop policy if exists "see connections posts" on posts;
create policy "see connections posts" on posts for select using (
  exists (select 1 from contacts c where c.user_id = auth.uid() and c.profile_id = posts.user_id)
);

drop policy if exists "manage own responses" on post_responses;
create policy "manage own responses" on post_responses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Anyone who can see a post can see who's responded to it.
drop policy if exists "see responses on visible posts" on post_responses;
create policy "see responses on visible posts" on post_responses for select using (
  exists (
    select 1 from posts p where p.id = post_responses.post_id
    and (p.user_id = auth.uid() or exists (select 1 from contacts c where c.user_id = auth.uid() and c.profile_id = p.user_id))
  )
);

-- Feed: my posts + my connections' posts that haven't ended, with poster name/photo and whether I've joined.
create or replace function feed_posts()
returns table (
  id uuid, user_id uuid, poster_name text, poster_photo_path text,
  place text, note text, starts_at date, ends_at date,
  event_id uuid, event_name text, created_at timestamptz,
  response_count bigint, joined boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.user_id, pr.name, pr.photo_path, p.place, p.note, p.starts_at, p.ends_at,
    p.event_id, e.name, p.created_at,
    (select count(*) from post_responses r where r.post_id = p.id),
    exists (select 1 from post_responses r where r.post_id = p.id and r.user_id = auth.uid())
  from posts p
  join profiles pr on pr.id = p.user_id
  left join events e on e.id = p.event_id
  where p.ends_at >= current_date
    and (p.user_id = auth.uid() or exists (select 1 from contacts c where c.user_id = auth.uid() and c.profile_id = p.user_id))
  order by p.starts_at
$$;
revoke execute on function feed_posts() from public, anon;
grant execute on function feed_posts() to authenticated;

-- Who's responded to a post (only if the caller can see that post).
create or replace function post_people(pid uuid)
returns table (user_id uuid, name text, photo_path text)
language plpgsql stable security definer set search_path = public as $$
declare p posts;
begin
  if auth.uid() is null then return; end if;
  select * into p from posts where id = pid;
  if p.id is null then return; end if;
  if p.user_id <> auth.uid() and not exists (select 1 from contacts c where c.user_id = auth.uid() and c.profile_id = p.user_id) then
    return;
  end if;
  return query
    select pr.id, pr.name, pr.photo_path from post_responses r join profiles pr on pr.id = r.user_id
    where r.post_id = pid order by r.created_at;
end $$;
revoke execute on function post_people(uuid) from public, anon;
grant execute on function post_people(uuid) to authenticated;

-- Live feed updates when a connection posts or cancels (post_responses uses a broadcast ping instead,
-- same pattern as room_members: see pingRoom in src/App.tsx).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts') then
    alter publication supabase_realtime add table public.posts;
  end if;
end $$;
-- Birthday reminders: checked by the same daily cron that already sends "time to call" pushes.
-- Safe to run more than once.
alter table contacts add column if not exists birthday date;
