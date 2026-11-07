// Offline stand-in for the Supabase client, used only when no VITE_SUPABASE_* keys are set.
// Implements just the calls App.tsx makes. Data lives in this browser's localStorage.
// Each email you sign in with is its own user, so the QR exchange can be tested by switching accounts.
// ponytail: localStorage caps at ~5 MB (~20 compressed photos); fine for testing, real data goes to Supabase.
type Row = Record<string, any>
const KEY = 'connections-local'
const load = (): Record<string, Row[]> => ({ events: [], contacts: [], profiles: [], interactions: [], rooms: [], room_members: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') })
const store = (d: Record<string, Row[]>) => localStorage.setItem(KEY, JSON.stringify(d))
const uid = () => { const e = localStorage.getItem(KEY + '-user'); return e ? 'local-' + e : null }
const defaults: Record<string, () => Row> = {
  contacts: () => ({
    last_contacted_at: new Date().toISOString(), event_id: null, profile_id: null, email: null, company: null, hometown: null, current_city: null, next_call_at: null, selfie_path: null, card_path: null,
    avatar_path: null, lat: null, lng: null, importance: 2, contact_every_days: 30, phone: null, met_where: null, help_note: null,
  }),
  events: () => ({}),
  interactions: () => ({ kind: 'call', format: 'note' }),
  profiles: () => ({ links: [] }),
  rooms: () => ({ organizer_id: uid(), place: null, description: null, lat: null, lng: null }),
}
const newRow = (table: string, r: Row) => ({ id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(), ...defaults[table](), user_id: uid(), ...r })

function from(table: string) {
  let op = 'select', payload: Row = {}, filter: [string, unknown] | undefined, order: [string, boolean] | undefined, single = false
  // Mirrors row level security. Rows saved before accounts existed (no user_id) stay visible to everyone.
  const mine = (r: Row) => table === 'profiles' ? r.id === uid() : table === 'rooms' ? r.organizer_id === uid() : (r.user_id ?? uid()) === uid()
  const run = () => {
    const d = load()
    const match = (r: Row) => mine(r) && (!filter || r[filter[0]] === filter[1])
    let out: Row[] = []
    if (op === 'insert') {
      out = [newRow(table, payload)]
      d[table].push(out[0])
    } else if (op === 'upsert') {
      const r = d[table].find(x => x.id === payload.id && mine(x))
      out = [r ? Object.assign(r, payload) : newRow(table, payload)]
      if (!r) d[table].push(out[0])
    } else if (op === 'update') {
      out = d[table].filter(match)
      out.forEach(r => Object.assign(r, payload))
    } else if (op === 'delete') {
      const gone = new Set(d[table].filter(match).map(r => r.id))
      d[table] = d[table].filter(r => !gone.has(r.id))
      if (table === 'events') d.contacts.forEach(c => { if (gone.has(c.event_id)) c.event_id = null }) // on delete set null
      if (table === 'contacts') d.interactions = d.interactions.filter(n => !gone.has(n.contact_id)) // on delete cascade
    } else {
      out = d[table].filter(match)
      if (order) {
        const [k, asc] = order
        out.sort((a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? '')) * (asc ? 1 : -1))
      }
    }
    if (op !== 'select') store(d)
    return { data: single ? out[0] ?? null : out, error: null }
  }
  const q: any = {
    select: () => q,
    insert: (r: Row) => { op = 'insert'; payload = r; return q },
    upsert: (r: Row) => { op = 'upsert'; payload = r; return q },
    update: (r: Row) => { op = 'update'; payload = r; return q },
    delete: () => { op = 'delete'; return q },
    eq: (k: string, v: unknown) => { filter = [k, v]; return q },
    order: (k: string, o?: { ascending?: boolean }) => { order = [k, o?.ascending !== false]; return q },
    single: () => { single = true; return q },
    maybeSingle: () => { single = true; return q },
    then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
  }
  return q
}

const isMember = (d: Record<string, Row[]>, roomId: string, user: string | null) =>
  d.room_members.some(m => m.room_id === roomId && m.user_id === user)

// Same behaviour as the SQL functions in supabase/schema.sql.
async function rpc(fn: string, a: Row) {
  const d = load()
  if (fn === 'get_profile') return { data: d.profiles.filter(p => p.id === a.pid), error: null }
  if (fn === 'connect_with') {
    const me = d.profiles.find(p => p.id === uid())
    const them = d.profiles.find(p => p.id === a.pid)
    const fail = (m: string) => ({ data: null, error: new Error(m) })
    if (!uid() || a.pid === uid()) return fail('Cannot connect with this card')
    if (!me) return fail('Create your own card first')
    if (!them) return fail('Card not found')
    const add = (owner: Row, p: Row) => {
      const c = d.contacts.find(x => x.user_id === owner.id && x.profile_id === p.id)
      if (c) return c
      const n = newRow('contacts', {
        user_id: owner.id, profile_id: p.id, name: p.name, phone: p.phone, email: p.email, help_note: p.help_with,
        hometown: p.hometown, current_city: p.city,
        met_where: 'QR exchange', avatar_path: p.photo_path, lat: a.lat, lng: a.lng,
      })
      d.contacts.push(n)
      return n
    }
    const mineC = add(me, them), theirsC = add(them, me)
    // Shared room that's live (or ended within a day): file both under it.
    const now = Date.now()
    const shared = d.rooms
      .filter(r => isMember(d, r.id, me.id) && isMember(d, r.id, them.id))
      .filter(r => now >= +new Date(r.starts_at) - 36e5 && now <= +new Date(r.ends_at) + 864e5)
      .sort((x, y) => +new Date(y.starts_at) - +new Date(x.starts_at))[0]
    if (shared) {
      Object.assign(mineC, { met_where: shared.name, event_id: d.events.find(e => e.user_id === me.id && e.room_id === shared.id)?.id ?? null })
      Object.assign(theirsC, { met_where: shared.name, event_id: d.events.find(e => e.user_id === them.id && e.room_id === shared.id)?.id ?? null })
    }
    store(d)
    return { data: mineC.id, error: null }
  }
  const roomView = (r: Row) => ({
    ...r, organizer_name: d.profiles.find(p => p.id === r.organizer_id)?.name ?? null,
    member_count: d.room_members.filter(m => m.room_id === r.id).length,
  })
  if (fn === 'get_room') return { data: d.rooms.filter(r => r.id === a.rid).map(roomView), error: null }
  if (fn === 'my_rooms') return {
    data: d.rooms.filter(r => r.organizer_id === uid() || isMember(d, r.id, uid()))
      .sort((x, y) => +new Date(y.starts_at) - +new Date(x.starts_at)).map(roomView),
    error: null,
  }
  if (fn === 'join_room') {
    const r = d.rooms.find(x => x.id === a.rid)
    const fail = (m: string) => ({ data: null, error: new Error(m) })
    if (!uid()) return fail('Sign in first')
    if (!d.profiles.some(p => p.id === uid())) return fail('Create your own card first')
    if (!r) return fail('Room not found')
    if (Date.now() > +new Date(r.ends_at)) return fail('This room has ended')
    if (!isMember(d, r.id, uid())) d.room_members.push({ room_id: r.id, user_id: uid(), joined_at: new Date().toISOString() })
    let ev = d.events.find(e => e.user_id === uid() && e.room_id === r.id)
    if (!ev) {
      ev = newRow('events', { name: r.name, date: r.starts_at.slice(0, 10), place: r.place, lat: r.lat, lng: r.lng, room_id: r.id })
      d.events.push(ev)
    }
    store(d)
    return { data: ev.id, error: null }
  }
  if (fn === 'room_people') {
    const r = d.rooms.find(x => x.id === a.rid)
    if (!r) return { data: [], error: null }
    const live = Date.now() >= +new Date(r.starts_at) && Date.now() <= +new Date(r.ends_at)
    if (r.organizer_id !== uid() && (!isMember(d, r.id, uid()) || !live)) return { data: [], error: null }
    const people = d.room_members.filter(m => m.room_id === r.id && m.user_id !== uid())
      .map(m => d.profiles.find(p => p.id === m.user_id)).filter(Boolean)
      .map(p => ({ user_id: p!.id, name: p!.name, headline: p!.headline ?? null, city: p!.city ?? null, photo_path: p!.photo_path ?? null, is_organizer: p!.id === r.organizer_id }))
    return { data: people, error: null }
  }
  return { data: null, error: new Error(`Unknown function ${fn}`) }
}

let listeners: ((e: string, s: unknown) => void)[] = []
const session = () => {
  const email = localStorage.getItem(KEY + '-user')
  return email ? { user: { id: uid(), email } } : null
}
const signIn = async ({ email }: { email: string }) => {
  localStorage.setItem(KEY + '-user', email.trim().toLowerCase())
  listeners.forEach(l => l('SIGNED_IN', session()))
  return { data: { session: session() }, error: null }
}

export const localClient = {
  from,
  rpc,
  // Live updates in test mode: other tabs' changes arrive via the storage event, room pings via BroadcastChannel.
  channel: (topic: string) => {
    const handlers: (() => void)[] = []
    const bc = new BroadcastChannel('cx-' + topic)
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) handlers.forEach(h => h()) }
    const c: any = {
      on: (type: string, _f: unknown, cb: (p: unknown) => void) => {
        if (type === 'postgres_changes') handlers.push(() => cb({}))
        else bc.addEventListener('message', () => cb({}))
        return c
      },
      subscribe: (cb?: (s: string) => void) => { addEventListener('storage', onStorage); cb?.('SUBSCRIBED'); return c },
      send: async () => { bc.postMessage(1); return 'ok' },
      close: () => { removeEventListener('storage', onStorage); bc.close() },
    }
    return c
  },
  removeChannel: async (c: { close?: () => void }) => c.close?.(),
  functions: { invoke: async () => ({ data: null, error: new Error("Reminders need Supabase; they don't run in test mode.") }) },
  auth: {
    getSession: async () => ({ data: { session: session() } }),
    onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
      listeners.push(cb)
      return { data: { subscription: { unsubscribe: () => { listeners = listeners.filter(l => l !== cb) } } } }
    },
    signInWithPassword: signIn,
    signUp: signIn,
    signOut: async () => {
      localStorage.removeItem(KEY + '-user')
      listeners.forEach(l => l('SIGNED_OUT', null))
    },
  },
  storage: {
    from: () => ({
      upload: async (path: string, blob: Blob) => {
        const url = await new Promise<string>(r => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(blob) })
        try { localStorage.setItem(KEY + ':' + path, url); return { error: null } }
        catch { return { error: new Error('Browser storage full — connect Supabase for more photos.') } }
      },
      createSignedUrls: async (paths: string[]) =>
        ({ data: paths.map(p => ({ path: p, signedUrl: localStorage.getItem(KEY + ':' + p) ?? '' })) }),
      getPublicUrl: (p: string) => ({ data: { publicUrl: localStorage.getItem(KEY + ':' + p) ?? '' } }),
    }),
  },
}
