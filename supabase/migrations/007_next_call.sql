-- A specific date for the next call, picked after a call. Null = use "call every X days". Safe to run more than once.
alter table contacts add column if not exists next_call_at timestamptz;
