-- Only people who host events see "Create a room". Set during card setup or in Edit card. Safe to run more than once.
alter table profiles add column if not exists hosts_events boolean not null default false;
