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
