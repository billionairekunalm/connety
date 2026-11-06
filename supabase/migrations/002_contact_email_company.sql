-- Visiting-card scan fills these. Safe to run more than once.
alter table contacts add column if not exists email text;
alter table contacts add column if not exists company text;
