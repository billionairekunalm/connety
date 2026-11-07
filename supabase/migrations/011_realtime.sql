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
