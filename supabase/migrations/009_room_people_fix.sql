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
