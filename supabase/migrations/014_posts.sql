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
