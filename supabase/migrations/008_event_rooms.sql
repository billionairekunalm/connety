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
