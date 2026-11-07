-- Your country, used for the phone code on your card and as the default for people you add. Safe to run more than once.
alter table profiles add column if not exists country text;
