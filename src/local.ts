// Offline stand-in for the Supabase client, used only when no VITE_SUPABASE_* keys are set.
// Implements just the calls App.tsx makes. Data lives in this browser's localStorage.
// Each email you sign in with is its own user, so the QR exchange can be tested by switching accounts.
// ponytail: localStorage caps at ~5 MB (~20 compressed photos); fine for testing, real data goes to Supabase.
type Row = Record<string, any>
const KEY = 'connections-local'
const load = (): Record<string, Row[]> => ({ events: [], contacts: [], profiles: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') })
const store = (d: Record<string, Row[]>) => localStorage.setItem(KEY, JSON.stringify(d))
const uid = () => { const e = localStorage.getItem(KEY + '-user'); return e ? 'local-' + e : null }
const defaults: Record<string, () => Row> = {
  contacts: () => ({
    last_contacted_at: new Date().toISOString(), event_id: null, profile_id: null, selfie_path: null, card_path: null,
    avatar_path: null, lat: null, lng: null, importance: 2, contact_every_days: 30, phone: null, met_where: null, help_note: null,
  }),
  events: () => ({}),
  profiles: () => ({ links: [] }),
}
const newRow = (table: string, r: Row) => ({ id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(), ...defaults[table](), user_id: uid(), ...r })

function from(table: string) {
  let op = 'select', payload: Row = {}, filter: [string, unknown] | undefined, order: [string, boolean] | undefined, single = false
  // Mirrors row level security. Rows saved before accounts existed (no user_id) stay visible to everyone.
  const mine = (r: Row) => table === 'profiles' ? r.id === uid() : (r.user_id ?? uid()) === uid()
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
        user_id: owner.id, profile_id: p.id, name: p.name, phone: p.phone, help_note: p.help_with,
        met_where: 'QR exchange', avatar_path: p.photo_path, lat: a.lat, lng: a.lng,
      })
      d.contacts.push(n)
      return n
    }
    const cid = add(me, them).id
    add(them, me)
    store(d)
    return { data: cid, error: null }
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
