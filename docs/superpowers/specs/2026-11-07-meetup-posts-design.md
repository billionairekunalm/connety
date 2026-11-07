# Meetup posts (replaces the Map tab)

## Problem

The bottom-nav **Map** tab plots every contact and event you've logged on a Leaflet
map — useful for recalling *where you met someone*, but it does nothing to help you
*meet people again*. The actual need: "I'm going to be in Bangalore next week — which
of my connections are around, and can we meet up in person?"

## Goal

Replace the Map tab with a **Posts** feed: you post a short travel/availability
announcement (place + date range + optional note, optionally tied to one of your
existing Events), your real connections see it, and anyone free taps "I'm in" to
signal they want to meet offline. No in-app chat — once someone's in, you already
have their phone number from your contacts list to coordinate directly.

Inline maps on person/event detail pages are untouched; only the bottom-nav Map tab
goes away.

## Who sees a post

"Connections" means the existing two-way relationship the app already creates via QR
exchange (`connect_with`): if you have a contact row with `profile_id` pointing at
someone, you're mutually connected (the QR flow always creates both sides). A post is
visible to its author and to every mutual connection of the author — regardless of
their stored city. People you've only added by scanning a business card (no
`profile_id`) aren't app users and never see or make posts.

## Data model

```sql
posts
  id uuid pk
  user_id uuid            -- the poster, default auth.uid()
  place text not null
  note text
  starts_at date not null
  ends_at date not null    -- check (ends_at >= starts_at)
  event_id uuid            -- optional, references events on delete set null
  created_at timestamptz

post_responses             -- "I'm in" taps
  post_id uuid              -- references posts on delete cascade
  user_id uuid              -- default auth.uid()
  created_at timestamptz
  primary key (post_id, user_id)
```

### RLS

- `posts`: a "manage own posts" policy (`user_id = auth.uid()`) covers full CRUD on
  your own rows. A second, select-only policy adds visibility for rows where the
  caller has a `contacts` row with `profile_id = posts.user_id` (i.e. the poster is a
  mutual connection).
- `post_responses`: a "manage own responses" policy covers insert/delete of your own
  taps. A select-only policy allows reading all responses on any post you can see
  (same mutual-connection check, applied to the parent post).

Both tables are added to the `supabase_realtime` publication, consistent with
`contacts`/`events`/`interactions`/`rooms`.

### RPCs (security definer, mirroring `my_rooms()` / `room_people()`)

- **`feed_posts()`** — all visible, not-yet-ended posts (mine + connections'), each
  row carrying the poster's name/photo, linked event name (if any), a response count,
  and whether the caller has already joined. Ordered by `starts_at`.
- **`post_people(pid)`** — responders' name/photo for one post. Returns nothing if the
  caller can't see that post.

Both are granted to `authenticated` only (revoked from `anon`/`public`), matching the
existing room functions.

### Writes

Plain table calls, since RLS already scopes them correctly:

- Create a post: `posts.insert({ place, note, starts_at, ends_at, event_id })`
- Join: `post_responses.insert({ post_id })`
- Leave: `post_responses.delete().eq('post_id', id)` (RLS scopes this to your own row)
- Cancel your own post: `posts.delete().eq('id', id)`

### Live updates

`posts` joins the app's existing `live:${uid}` channel (the generic
`postgres_changes` → debounced `feed_posts()` refetch, same as contacts/events/rooms
today) — so a connection's new or cancelled post appears without a manual refresh.

For "someone just joined this post," reuse the existing lightweight broadcast-ping
channel the rooms feature already uses (`pingRoom` → add an equivalent `pingPost`):
joining a post pings a `post:${postId}` broadcast channel, and anyone currently
viewing that post's detail refetches `post_people()`. This avoids adding RLS-gated
realtime on `post_responses`, which the existing codebase avoids for the same reason
(`room_members` isn't in the main realtime table list either).

## Frontend

- **Tab:** the `map` entry in the `Tab` union and bottom nav becomes `posts`, reusing
  the existing `pin` icon (no new SVG). Header reads "WHO'S AROUND".
- **Feed:** cards sorted by `starts_at`. Each card shows place, date range, note, the
  poster's name/photo (omitted on your own posts), the responders' faces (reusing the
  existing `Faces` component — same visual language as event-card attendee faces), and
  a response count. Tapping a card opens full detail with the full responder name
  list.
- **Actions:** "I'm in" on others' posts, which toggles to "You're in ✓ · tap to
  leave." Your own posts get "Cancel" instead of a join button.
- **New post:** a hero button (parallel to the Events tab's "Create a room" hero)
  opens a form: place (text), start/end date, note (textarea), and an optional
  dropdown of your existing events to attach.
- **Removed:** the `tab === 'map'` render block and the `map` nav entry. The
  `PeopleMap` component, Leaflet imports, and its two other call sites (person detail,
  event detail) are untouched.

## Offline test mode (`src/local.ts`)

Mirror the new tables/RPCs in the existing in-browser mock:

- Add `posts: []` and `post_responses: []` to the default store shape.
- `mine()` needs access to the loaded store to evaluate the connection check, so it
  moves inside `run()` (where `d` is already in scope) instead of staying a closure
  defined before `load()`. Add cases: a `posts` row is "mine" to read if
  `user_id === uid()` or some contact of mine has `profile_id === row.user_id`; a
  `post_responses` row is readable if its parent post is.
- `rpc()` gets `feed_posts` and `post_people` branches that replicate the SQL
  functions' logic directly against the in-memory store.
- No changes needed to the realtime channel mock (`BroadcastChannel` + `storage`
  event) — it already triggers a full reload, which is all `feed_posts()` needs.

## Migration

New file `supabase/migrations/014_posts.sql` (idempotent, following the existing
`create table if not exists` / `create or replace function` style), and the same SQL
appended to `supabase/schema.sql` so a fresh project setup includes it.

## Out of scope

- No in-app chat/messaging between responders — contact info already saved locally
  covers coordination.
- No geo-filtering by destination city; every mutual connection sees every post,
  regardless of their stored city.
- No push notification specifically for new posts (the existing "time to call"
  reminder push stays as-is); the realtime feed refresh is enough for now.
- No editing a post after creation — only cancel (delete) and re-post.
