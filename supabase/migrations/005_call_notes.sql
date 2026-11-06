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
