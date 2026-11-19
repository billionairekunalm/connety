-- "Share my info": after scanning someone's QR, a signed-in scanner can send their own card back.
-- The receiver gets a notification and the details in an editable form, and chooses whether to add them.
-- Nothing lands in the receiver's list until they accept. Safe to run more than once.

create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users on delete cascade,
  to_user uuid not null references auth.users on delete cascade,
  message text,
  card jsonb not null,                 -- snapshot of the sender's card at the moment they shared
  lat double precision,
  lng double precision,
  room_id uuid references rooms on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  contact_id uuid references contacts on delete set null, -- the receiver's contact once accepted
  notified_at timestamptz,             -- push is sent once per share
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists shares_to_idx on shares (to_user, status);

alter table shares enable row level security;
drop policy if exists "sender or receiver reads" on shares;
create policy "sender or receiver reads" on shares for select using (from_user = auth.uid() or to_user = auth.uid());
-- No insert/update/delete policies on purpose: writes only happen through the functions below.

-- Send my card to someone whose QR I scanned. One share per pair: sharing again updates a pending one,
-- and does nothing once they've added or dismissed it (so nobody can be pestered).
create or replace function share_with(pid uuid, msg text default null, lat double precision default null, lng double precision default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  s shares;
  created boolean := false;
  room uuid;
  snap jsonb;
  note text := nullif(left(trim(coalesce(msg, '')), 500), '');
begin
  if auth.uid() is null or pid = auth.uid() then raise exception 'Cannot share with this card'; end if;
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Create your own card first'; end if;
  if not exists (select 1 from profiles where id = pid) then raise exception 'Card not found'; end if;
  if (select count(*) from shares where from_user = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many shares today. Try again tomorrow.';
  end if;

  snap := jsonb_build_object('name', me.name, 'headline', me.headline, 'phone', me.phone, 'email', me.email,
    'city', me.city, 'hometown', me.hometown, 'help_with', me.help_with, 'photo_path', me.photo_path, 'country', me.country);

  -- a live (or just ended) room we're both in, so the receiver's form is pre-filled with that event
  select r.id into room from rooms r
    join room_members a on a.room_id = r.id and a.user_id = auth.uid()
    join room_members b on b.room_id = r.id and b.user_id = pid
    where now() between r.starts_at - interval '1 hour' and r.ends_at + interval '1 day'
    order by r.starts_at desc limit 1;

  select * into s from shares where from_user = auth.uid() and to_user = pid;
  if s.id is null then
    insert into shares (from_user, to_user, message, card, lat, lng, room_id)
    values (auth.uid(), pid, note, snap, lat, lng, room) returning * into s;
    created := true;
  elsif s.status = 'pending' then
    update shares set card = snap, message = coalesce(note, s.message), lat = coalesce(share_with.lat, s.lat),
      lng = coalesce(share_with.lng, s.lng), room_id = coalesce(room, s.room_id), updated_at = now()
    where id = s.id returning * into s;
  end if;
  return json_build_object('id', s.id, 'status', s.status, 'created', created);
end $$;

-- The receiver accepts (after saving the contact) or dismisses.
create or replace function resolve_share(sid uuid, new_status text, cid uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_status not in ('accepted', 'dismissed') then raise exception 'Bad status'; end if;
  if cid is not null and not exists (select 1 from contacts where id = cid and user_id = auth.uid()) then
    raise exception 'Not your contact';
  end if;
  update shares set status = new_status, contact_id = case when new_status = 'accepted' then cid else null end, updated_at = now()
  where id = sid and to_user = auth.uid() and status = 'pending';
  if not found then raise exception 'Share not found or already handled'; end if;
end $$;

-- Scanner saves the card owner to their own list only (one-way; the owner decides about adding back).
create or replace function save_card(pid uuid, lat double precision default null, lng double precision default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  them profiles;
  cid uuid;
  shared rooms;
begin
  if auth.uid() is null or pid = auth.uid() then raise exception 'Cannot save this card'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'Create your own card first'; end if;
  select * into them from profiles where id = pid;
  if them.id is null then raise exception 'Card not found'; end if;

  insert into contacts (user_id, profile_id, name, phone, email, company, help_note, met_where, avatar_path, hometown, current_city, lat, lng)
  values (auth.uid(), them.id, them.name, them.phone, them.email, them.headline, them.help_with, 'QR exchange', them.photo_path, them.hometown, them.city, lat, lng)
  on conflict (user_id, profile_id) do update set last_contacted_at = now()
  returning id into cid;

  select r.* into shared from rooms r
    join room_members a on a.room_id = r.id and a.user_id = auth.uid()
    join room_members b on b.room_id = r.id and b.user_id = pid
    where now() between r.starts_at - interval '1 hour' and r.ends_at + interval '1 day'
    order by r.starts_at desc limit 1;
  if shared.id is not null then
    update contacts set met_where = shared.name,
      event_id = (select id from events where user_id = auth.uid() and room_id = shared.id)
    where id = cid;
  end if;
  return cid;
end $$;

revoke execute on function share_with(uuid, text, double precision, double precision) from public, anon;
revoke execute on function resolve_share(uuid, text, uuid) from public, anon;
revoke execute on function save_card(uuid, double precision, double precision) from public, anon;
grant execute on function share_with(uuid, text, double precision, double precision) to authenticated;
grant execute on function resolve_share(uuid, text, uuid) to authenticated;
grant execute on function save_card(uuid, double precision, double precision) to authenticated;

-- live updates (rooms/contacts already publish)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shares') then
    alter publication supabase_realtime add table public.shares;
  end if;
end $$;
