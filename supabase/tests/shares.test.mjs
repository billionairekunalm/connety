// Tests supabase/migrations/016_shares.sql on an in-memory Postgres (PGlite) with a minimal copy of the schema it depends on.
// Run:  npm i --no-save @electric-sql/pglite@0.2.17 && node supabase/tests/shares.test.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table profiles (id uuid primary key references auth.users, name text not null, headline text, phone text, email text, city text, hometown text, help_with text, photo_path text, country text);
  create table rooms (id uuid primary key default gen_random_uuid(), name text, starts_at timestamptz, ends_at timestamptz);
  create table room_members (room_id uuid references rooms on delete cascade, user_id uuid, primary key (room_id, user_id));
  create table events (id uuid primary key default gen_random_uuid(), user_id uuid, name text, room_id uuid);
  create table contacts (id uuid primary key default gen_random_uuid(), user_id uuid not null, event_id uuid, profile_id uuid, name text, phone text, email text, company text, help_note text, met_where text, avatar_path text, hometown text, current_city text, lat double precision, lng double precision, last_contacted_at timestamptz default now(), unique (user_id, profile_id));
  create publication supabase_realtime;
`)
await db.exec(readFileSync(new URL('../migrations/016_shares.sql', import.meta.url), 'utf8'))
await db.exec(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant execute on function auth.uid() to authenticated;`)

const uid = async n => (await db.query(`insert into auth.users default values returning id`)).rows[0].id
const [A, B, C] = [await uid(), await uid(), await uid()]
await db.exec(`insert into profiles (id, name, headline, phone, email, city, help_with, country) values
  ('${A}', 'Priya Shah', 'Founder · GreenLoop', '+919812345678', 'priya@x.in', 'Pune', 'fundraising', 'IN'),
  ('${B}', 'Ravi Kumar', 'CEO · SolarCo', '+919876543210', 'ravi@x.in', 'Mumbai', 'solar', 'IN'),
  ('${C}', 'Cara Lee', null, null, null, null, null, null)`)

// run SQL as a signed-in user (RLS applies) -> rows, or the error message
const as = async (user, sql) => {
  await db.exec(`set role authenticated; select set_config('test.uid', '${user ?? ''}', false)`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { err: e.message } } finally { await db.exec(`reset role`) }
}
const fn = async (user, call) => { const r = await as(user, `select ${call} as r`); return r.err ? { err: r.err } : r.rows[0].r }
let n = 0; const ok = name => console.log(`  ✓ ${++n}. ${name}`)

// --- sharing
let r = await fn(B, `share_with('${A}', '  Great meeting you!  ', 12.9, 77.6)`)
assert.equal(r.created, true); assert.equal(r.status, 'pending'); ok('B shares with A: created, pending')
const shareId = r.id
r = await fn(B, `share_with('${A}', 'second try')`)
assert.equal(r.created, false); assert.equal(r.status, 'pending'); ok('sharing again updates the pending one, no duplicate')
assert.equal((await db.query(`select count(*)::int c from shares`)).rows[0].c, 1)
let row = (await db.query(`select * from shares where id = '${shareId}'`)).rows[0]
assert.equal(row.message, 'second try'); assert.equal(row.card.name, 'Ravi Kumar'); assert.equal(row.card.headline, 'CEO · SolarCo'); assert.equal(row.lat, 12.9)
ok('snapshot has the sender card; message and location kept')
r = await fn(B, `share_with('${B}')`); assert.match(r.err, /Cannot share/); ok('cannot share with yourself')
r = await fn(B, `share_with('00000000-0000-0000-0000-000000000000')`); assert.match(r.err, /Card not found/); ok('unknown card rejected')
r = await fn(null, `share_with('${A}')`); assert.match(r.err, /Cannot share/); ok('signed-out caller rejected')
await db.exec(`delete from profiles where id = '${C}'`)
r = await fn(C, `share_with('${A}')`); assert.match(r.err, /own card first/); ok('sender must have their own card')
await db.exec(`insert into profiles (id, name) values ('${C}', 'Cara Lee')`)

// --- privacy: who can read / write
assert.equal((await as(A, `select * from shares`)).rows.length, 1); ok('receiver A can read the share')
assert.equal((await as(B, `select * from shares`)).rows.length, 1); ok('sender B can read it (to show status)')
assert.equal((await as(C, `select * from shares`)).rows.length, 0); ok('a third person sees nothing')
let w = await as(B, `insert into shares (from_user, to_user, card) values ('${B}', '${C}', '{}')`); assert.ok(w.err); ok('direct insert is blocked (functions only)')
w = await as(A, `update shares set status = 'accepted'`); assert.equal((await db.query(`select status from shares`)).rows[0].status, 'pending'); ok('direct update does nothing')
w = await as(A, `delete from shares`); assert.equal((await db.query(`select count(*)::int c from shares`)).rows[0].c, 1); ok('direct delete does nothing')

// --- accepting
r = await fn(B, `resolve_share('${shareId}', 'accepted')`); assert.ok(r.err); ok('sender cannot resolve the receiver\'s share')
await db.exec(`insert into contacts (id, user_id, name) values ('11111111-1111-1111-1111-111111111111', '${A}', 'Ravi Kumar')`)
await db.exec(`insert into contacts (id, user_id, name) values ('22222222-2222-2222-2222-222222222222', '${C}', 'Someone')`)
r = await fn(A, `resolve_share('${shareId}', 'accepted', '22222222-2222-2222-2222-222222222222')`); assert.match(r.err, /Not your contact/); ok('cannot attach someone else\'s contact')
r = await fn(A, `resolve_share('${shareId}', 'weird')`); assert.match(r.err, /Bad status/); ok('bad status rejected')
r = await fn(A, `resolve_share('${shareId}', 'accepted', '11111111-1111-1111-1111-111111111111')`); assert.equal(r.err, undefined)
row = (await db.query(`select * from shares where id = '${shareId}'`)).rows[0]
assert.equal(row.status, 'accepted'); assert.equal(row.contact_id, '11111111-1111-1111-1111-111111111111'); ok('A accepts: status + contact recorded')
r = await fn(A, `resolve_share('${shareId}', 'dismissed')`); assert.match(r.err, /already handled/); ok('cannot resolve twice')
r = await fn(B, `share_with('${A}', 'again')`); assert.equal(r.status, 'accepted'); assert.equal(r.created, false); ok('re-sharing after accept changes nothing')

// --- dismissing blocks pestering
r = await fn(C, `share_with('${A}')`); const sid2 = r.id
await fn(A, `resolve_share('${sid2}', 'dismissed')`)
r = await fn(C, `share_with('${A}', 'please add me')`); assert.equal(r.status, 'dismissed'); assert.equal(r.created, false); ok('after dismiss, re-share is ignored (still dismissed)')

// --- save_card (one-way)
r = await fn(B, `save_card('${A}', 1, 2)`); const cid = r
let c = (await db.query(`select * from contacts where id = '${cid}'`)).rows[0]
assert.equal(c.user_id, B); assert.equal(c.name, 'Priya Shah'); assert.equal(c.company, 'Founder · GreenLoop'); assert.equal(c.current_city, 'Pune'); assert.equal(c.met_where, 'QR exchange')
ok('save_card saves A to B\'s list with headline as company')
assert.equal((await db.query(`select count(*)::int c from contacts where user_id = '${A}' and profile_id = '${B}'`)).rows[0].c, 0); ok('one-way: A\'s list is untouched')
r = await fn(B, `save_card('${A}')`); assert.equal(r, cid); ok('saving twice keeps one contact')
r = await fn(B, `save_card('${B}')`); assert.match(r.err, /Cannot save/); ok('cannot save yourself')

// --- room context
const room = (await db.query(`insert into rooms (name, starts_at, ends_at) values ('Founders Night', now() - interval '1 hour', now() + interval '2 hours') returning id`)).rows[0].id
await db.exec(`insert into room_members values ('${room}', '${B}'), ('${room}', '${C}')`)
await db.exec(`insert into events (user_id, name, room_id) values ('${B}', 'Founders Night', '${room}'), ('${C}', 'Founders Night', '${room}')`)
r = await fn(C, `save_card('${B}')`); c = (await db.query(`select * from contacts where id = '${r}'`)).rows[0]
assert.equal(c.met_where, 'Founders Night'); assert.ok(c.event_id); ok('save_card inside a shared room files it under that event')
await db.exec(`delete from shares where from_user = '${B}'`)
r = await fn(B, `share_with('${C}')`); row = (await db.query(`select room_id from shares where id = '${r.id}'`)).rows[0]
assert.equal(row.room_id, room); ok('share_with inside a shared room records the room')

// --- daily limit
const many = []; for (let i = 0; i < 31; i++) many.push((await db.query(`insert into auth.users default values returning id`)).rows[0].id)
await db.exec(`insert into profiles (id, name) values ${many.map((id, i) => `('${id}', 'P${i}')`).join(',')}`)
await db.exec(`delete from shares where from_user = '${A}'`)
let limitHit = null
for (let i = 0; i < 31; i++) { const x = await fn(A, `share_with('${many[i]}')`); if (x.err) { limitHit = i; assert.match(x.err, /Too many shares/); break } }
assert.equal(limitHit, 30); ok('31st share in a day is refused (limit 30)')

console.log(`\nall ${n} checks passed`)
