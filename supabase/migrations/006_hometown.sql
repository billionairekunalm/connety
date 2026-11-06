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
