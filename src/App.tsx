import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import QRCode from 'qrcode'
import { LOCAL, supabase } from './supabase'
import { nameFrom } from './voice'
import { canPrompt, isIOS, isStandalone, onInstallChange, promptInstall } from './pwa'

type Contact = {
  id: string; event_id: string | null; profile_id: string | null; name: string; phone: string | null
  met_where: string | null; help_note: string | null; importance: number
  contact_every_days: number; last_contacted_at: string
  selfie_path: string | null; card_path: string | null; avatar_path: string | null
  lat: number | null; lng: number | null
}
type Link = { label: string; url: string }
type Profile = {
  id: string; name: string; headline: string | null; phone: string | null; email: string | null
  city: string | null; help_with: string | null; photo_path: string | null; links: Link[]
}
type Ev = { id: string; name: string; date: string | null; place: string | null; lat: number | null; lng: number | null }
type Tab = 'home' | 'people' | 'events' | 'map'
type Modal =
  | { kind: 'person'; id: string }
  | { kind: 'edit'; c?: Contact; eventId?: string }
  | { kind: 'event'; id: string }
  | { kind: 'newEvent' }
  | { kind: 'me' }
  | { kind: 'editMe' }
  | null

const LEVELS = ['', 'VIMP', 'IMP', 'Normal', 'Low']
const COLORS = ['', '#ff7a6b', '#ffc145', '#a99bff', '#a9c8ff']
const TINTS = ['#a99bff', '#ffc145', '#a9c8ff', '#f7b3e4', '#c9e27f']
const FREQS = [7, 14, 30, 60, 90]
const LINK_PRESETS = ['LinkedIn', 'Instagram', 'Website', 'X', 'YouTube', 'Portfolio']
const PENDING = 'connections-pending-connect' // card id waiting to be connected after login
const pub = (path: string | null | undefined) => (path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : undefined)
// Links come from other users: force http(s) so a "javascript:" link can never run.
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^[a-z][\w+.-]*:\/*/i, ''))
declare const __LAN_IP__: string
// A phone can't open "localhost", so QR links use the public URL, or this computer's Wi-Fi address in dev.
const publicOrigin = import.meta.env.VITE_PUBLIC_URL?.replace(/\/$/, '') ||
  (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && __LAN_IP__
    ? `${location.protocol}//${__LAN_IP__}:${location.port}`
    : location.origin)
// QR + share links use publicOrigin; links tapped on this device stay on this address so its login is kept.
const cardPath = (id: string) => `/?u=${encodeURIComponent(id)}`
const cardUrl = (id: string) => publicOrigin + cardPath(id)
// crypto.randomUUID only exists on https/localhost; phones on the Wi-Fi address use plain http.
const uuid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const nn = (s: string) => s.trim() || null
const DAY = 864e5
const dueIn = (c: Contact) =>
  Math.ceil((new Date(c.last_contacted_at).getTime() + c.contact_every_days * DAY - Date.now()) / DAY)
const bucket = (c: Contact) => Math.max(0, dueIn(c)) // overdue counts as today
const dueText = (c: Contact) => {
  const d = dueIn(c)
  return d < 0 ? `${-d}d overdue` : d === 0 ? 'due today' : `call in ${d}d`
}
const ago = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', o)

const here = () =>
  new Promise<{ lat: number; lng: number } | null>(res =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => res(null),
          { timeout: 10000 },
        )
      : res(null),
  )

// Phone photos are 3-8 MB; shrink to ~1280px JPEG before upload.
async function upload(uid: string, file: File, bucket = 'photos') {
  const img = await createImageBitmap(file)
  const s = Math.min(1, 1280 / Math.max(img.width, img.height))
  const cv = document.createElement('canvas')
  cv.width = img.width * s
  cv.height = img.height * s
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
  const blob = await new Promise<Blob>(r => cv.toBlob(b => r(b!), 'image/jpeg', 0.8))
  const path = `${uid}/${uuid()}.jpg`
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  people: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  map: <path d="M9 4l6 2 6-2v16l-6 2-6-2-6 2V6zM9 4v16M15 6v16" />,
  arrow: <path d="M7 17L17 7M8 7h9v9" />,
  back: <path d="M15 5l-7 7 7 7" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  check: <path d="M5 12l5 5L20 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  pin: <><path d="M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  chat: <path d="M4 20l1.5-4A8 8 0 1 1 8 18.5z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10h6M7 14h4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" /></>,
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
}
const Ic = ({ n, s = 22 }: { n: string; s?: number }) => (
  <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>{PATHS[n]}</svg>
)

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>() // undefined = loading, null = not created yet
  const uid = session?.user.id
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    setProfile(undefined)
    if (uid) supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => setProfile(data))
  }, [uid])

  const pid = new URLSearchParams(location.search).get('u')
  if (!ready) return null
  if (pid) return <PublicCard pid={pid} mine={pid === uid} loggedIn={!!uid} />
  if (!session || !uid) return <Login />
  if (profile === undefined) return null
  if (!profile) return (
    <div className="app">
      <ProfileForm uid={uid} email={session.user.email ?? ''} onboarding done={setProfile} />
    </div>
  )
  return <Home uid={uid} profile={profile} setProfile={setProfile} />
}

// What someone sees after scanning a QR. Anyone can view the card; saving needs an account.
function PublicCard({ pid, mine, loggedIn }: { pid: string; mine: boolean; loggedIn: boolean }) {
  const [p, setP] = useState<Profile | null>()
  const [ask, setAsk] = useState(false)
  const [, rerender] = useState(0)
  useEffect(() => {
    supabase.rpc('get_profile', { pid }).then(({ data }) => setP((data as Profile[] | null)?.[0] ?? null))
  }, [pid])
  useEffect(() => onInstallChange(() => rerender(n => n + 1)), [])
  const installable = !isStandalone() && (canPrompt() || isIOS)
  // Ask after a few seconds, once they've had a look. Signed-in viewers only see it if there's an app to install.
  useEffect(() => {
    if (!p || mine || (loggedIn && !installable)) return
    const t = setTimeout(() => setAsk(true), 3500)
    return () => clearTimeout(t)
  }, [p])

  const connect = () => { localStorage.setItem(PENDING, pid); location.href = '/' }
  const install = async () => {
    if (!loggedIn) localStorage.setItem(PENDING, pid) // the installed app picks this up after sign-in
    if (await promptInstall()) { setAsk(false); if (!loggedIn) location.href = '/' }
  }

  if (p === undefined) return null
  if (!p) return <div className="app"><div className="empty-card">This card doesn't exist anymore.</div></div>
  const first = p.name.split(' ')[0]
  return (
    <div className="sheet" style={{ '--c': '#a99bff' } as CSSProperties}>
      <div className="detail public">
        <CardView p={p} />
        <div className="cta">
          {mine
            ? <a className="btn-black press" href="/">This is your card · open app</a>
            : loggedIn
              ? <>
                  <button className="btn-black press" onClick={connect}><Ic n="plus" s={18} /> Connect with {first}</button>
                  <button className="btn-ghost press" onClick={() => saveVcard(p)}><Ic n="download" s={18} /> Save to phone contacts</button>
                </>
              : <button className="btn-black press" onClick={() => setAsk(true)}><Ic n="lock" s={18} /> Sign in to save {first}</button>}
        </div>
        <p className="muted small center made">Made with Connections · only for people you actually met</p>
      </div>

      {ask && (
        <div className="backdrop" onClick={() => setAsk(false)}>
          <div className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="ask-title" onClick={e => e.stopPropagation()}>
            <div className="grabber" />
            <div className="ask-head">
              <img src="/icon-192.png" alt="" className="app-icon" />
              {p.photo_path ? <img src={pub(p.photo_path)} alt="" className="app-icon round" /> : <div className="app-icon round">{first[0]}</div>}
            </div>
            <h3 id="ask-title">{loggedIn ? 'Get the Connections app' : `Save ${first} & stay in touch`}</h3>
            <p className="muted">
              {loggedIn
                ? 'Open your people, reminders and QR card in one tap from your home screen.'
                : `Install the app and sign in to save ${first}. You'll be added to each other's lists, and the app reminds you to keep in touch.`}
            </p>
            {canPrompt() && !isStandalone() && (
              <button className="btn-black press" onClick={install}><Ic n="download" s={18} /> Install app</button>
            )}
            {isIOS && !isStandalone() && (
              <div className="ios-hint">Tap <Ic n="share" s={16} /> <b>Share</b> below, then <b>Add to Home Screen</b></div>
            )}
            {!loggedIn && (
              <button className={canPrompt() ? 'btn-ghost press' : 'btn-black press'} onClick={connect}>Sign in or create account</button>
            )}
            <button className="not-now" onClick={() => setAsk(false)}>Not now, just looking</button>
          </div>
        </div>
      )}
    </div>
  )
}

function saveVcard(p: Profile) {
  const esc = (s: string) => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n')
  const lines = [
    'BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(p.name)}`,
    p.phone && `TEL:${esc(p.phone)}`, p.email && `EMAIL:${esc(p.email)}`, p.headline && `TITLE:${esc(p.headline)}`,
    p.help_with && `NOTE:${esc(p.help_with)}`, ...p.links.map(l => `URL:${esc(safeUrl(l.url))}`), 'END:VCARD',
  ].filter(Boolean)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/vcard' }))
  a.download = `${p.name}.vcf`
  a.click()
}

// The Linktree-style card: what people see when they scan your QR.
function CardView({ p }: { p: Profile }) {
  const wa = p.phone?.replace(/\D/g, '')
  return <>
    <div className="big-avatar">{p.photo_path ? <img src={pub(p.photo_path)} alt="" /> : p.name[0]?.toUpperCase()}</div>
    <h1 className="center">{p.name}</h1>
    {p.headline && <p className="center headline">{p.headline}</p>}
    {p.city && <div className="pills center-row"><span className="pill"><Ic n="pin" s={14} /> {p.city}</span></div>}
    <div className="quick">
      {p.phone && <a className="press" href={`tel:${p.phone}`}><span className="circle"><Ic n="phone" /></span>Call</a>}
      {wa && <a className="press" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"><span className="circle"><Ic n="chat" /></span>WhatsApp</a>}
      {p.email && <a className="press" href={`mailto:${p.email}`}><span className="circle"><Ic n="mail" /></span>Email</a>}
    </div>
    {p.help_with && <div className="panel"><h4>I can help with</h4><p className="pre">{p.help_with}</p></div>}
    {p.links.length > 0 && (
      <div className="links">
        {p.links.map((l, i) => (
          <a key={i} className="link press" style={{ background: TINTS[i % TINTS.length], animationDelay: `${i * 50}ms` }}
            href={safeUrl(l.url)} target="_blank" rel="noopener noreferrer">
            <b>{l.label || l.url}</b><span className="circle white"><Ic n="arrow" s={18} /></span>
          </a>
        ))}
      </div>
    )}
  </>
}

function QR({ text }: { text: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: 560, errorCorrectionLevel: 'M' }).then(setSrc) }, [text])
  return src ? <img className="qr" src={src} alt="QR code for your card" /> : <div className="qr" />
}

function ProfileForm({ uid, email, p, onboarding, done }: {
  uid: string; email: string; p?: Profile; onboarding?: boolean; done: (p: Profile) => void
}) {
  const [f, setF] = useState({
    name: p?.name ?? '', headline: p?.headline ?? '', phone: p?.phone ?? '', email: p?.email ?? email,
    city: p?.city ?? '', help_with: p?.help_with ?? '',
  })
  const [links, setLinks] = useState<Link[]>(p?.links ?? [{ label: 'LinkedIn', url: '' }])
  const [photo, setPhoto] = useState<File>()
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setLink = (i: number, k: keyof Link) => (e: { target: { value: string } }) =>
    setLinks(links.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)))

  const save = async () => {
    setBusy(true)
    try {
      const row = {
        id: uid, name: f.name.trim(), headline: nn(f.headline), phone: nn(f.phone), email: nn(f.email),
        city: nn(f.city), help_with: nn(f.help_with),
        links: links.filter(l => l.url.trim()).map(l => ({ label: l.label.trim(), url: safeUrl(l.url.trim()) })),
        photo_path: photo ? await upload(uid, photo, 'avatars') : p?.photo_path ?? null,
      }
      const { data, error } = await supabase.from('profiles').upsert(row).select().single()
      if (error) throw error
      done(data)
    } catch (e) {
      alert((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="detail" onSubmit={e => { e.preventDefault(); save() }}>
      <h1 className="big">{onboarding ? <>MAKE YOUR<br />CARD</> : <>EDIT YOUR<br />CARD</>}</h1>
      {onboarding && <p className="muted intro">This is what people get when they scan your QR, like a Linktree for the people you meet. Share only what you're happy to give.</p>}

      <div className="avatar-pick">
        <PhotoTile label="Your photo" icon="camera" capture="user" file={photo} url={pub(p?.photo_path)} onFile={setPhoto} />
      </div>
      <label>Full name *<input required value={f.name} onChange={set('name')} placeholder="Ravi Kumar" autoComplete="name" /></label>
      <label>Headline<input value={f.headline} onChange={set('headline')} placeholder="Founder @ SolarCo · Angel investor" /></label>
      <div className="two">
        <label>Mobile<input type="tel" value={f.phone} onChange={set('phone')} placeholder="+91…" autoComplete="tel" /></label>
        <label>City<input value={f.city} onChange={set('city')} placeholder="Mumbai" /></label>
      </div>
      <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <label>I can help with<textarea rows={3} value={f.help_with} onChange={set('help_with')} placeholder="Solar projects, startup fundraising, Pune real estate…" /></label>

      <div className="field">
        <span>Links</span>
        {links.map((l, i) => (
          <div className="link-row" key={i}>
            <input className="link-label" value={l.label} onChange={setLink(i, 'label')} placeholder="Label" aria-label="Link label" />
            <input value={l.url} onChange={setLink(i, 'url')} placeholder="linkedin.com/in/you" inputMode="url" aria-label={`${l.label || 'Link'} URL`} />
            <button type="button" className="circle white press" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove link">
              <Ic n="trash" s={16} />
            </button>
          </div>
        ))}
        <div className="chips">
          {LINK_PRESETS.map(x => (
            <button type="button" key={x} className="chip press" onClick={() => setLinks([...links, { label: x, url: '' }])}>+ {x}</button>
          ))}
        </div>
      </div>

      <div className="cta">
        <button className="btn-black press" disabled={busy}>{busy ? 'Saving…' : onboarding ? 'Create my card' : 'Save card'}</button>
      </div>
      {onboarding && <button type="button" className="btn-ghost press signout" onClick={() => supabase.auth.signOut()}>Sign out</button>}
    </form>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const go = async (signup: boolean) => {
    setMsg('')
    const { data, error } = signup
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
      : await supabase.auth.signInWithPassword({ email, password })
    if (error) setMsg(error.message)
    else if (signup && !data.session) setMsg('Check your email to confirm, then sign in.')
  }
  return (
    <form className="login" onSubmit={e => { e.preventDefault(); go(false) }}>
      <section className="hero">
        <h2>Never lose<br />a person<br />you met.</h2>
        <p>Selfie, card, notes & reminders.</p>
        <i className="shape s1" /><i className="shape s2" /><i className="shape s3" />
      </section>
      <h1 className="big">STAY IN<br />TOUCH.</h1>
      <input type="email" placeholder="Email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" placeholder="Password (min 6)" required minLength={6} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="btn-black press">Sign in</button>
      <button type="button" className="btn-ghost press" onClick={() => go(true)}>Create account</button>
      {msg && <p className="msg">{msg}</p>}
      {LOCAL && <p className="muted small center">Local test mode: any email/password works, data stays in this browser.</p>}
    </form>
  )
}

function Home({ uid, profile, setProfile }: { uid: string; profile: Profile; setProfile: (p: Profile) => void }) {
  const [tab, setTab] = useState<Tab>('home')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [modal, setModal] = useState<Modal>(null)
  const [q, setQ] = useState('')
  const [level, setLevel] = useState(0)
  const [day, setDay] = useState(0)
  const [toast, setToast] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [, rerender] = useState(0)
  useEffect(() => onInstallChange(() => rerender(n => n + 1)), [])
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2200) }

  const load = async () => {
    const [c, e] = await Promise.all([
      supabase.from('contacts').select('*').order('name'),
      supabase.from('events').select('*').order('date', { ascending: false }),
    ])
    if (c.error || e.error) return alert((c.error ?? e.error)!.message)
    setContacts(c.data)
    setEvents(e.data)
    const paths = c.data.flatMap(x => [x.selfie_path, x.card_path]).filter(Boolean) as string[]
    if (paths.length) {
      const { data } = await supabase.storage.from('photos').createSignedUrls(paths, DAY / 1000)
      setUrls(Object.fromEntries((data ?? []).map(d => [d.path, d.signedUrl])))
    }
  }
  useEffect(() => { load() }, [])

  // Came here from someone's QR card: connect both ways, tagged with where we are.
  useEffect(() => {
    const pid = localStorage.getItem(PENDING)
    if (!pid) return
    localStorage.removeItem(PENDING)
    if (pid === uid) return
    flash('Connecting…')
    here().then(async loc => {
      const { data, error } = await supabase.rpc('connect_with', { pid, lat: loc?.lat ?? null, lng: loc?.lng ?? null })
      if (error) return alert(error.message)
      await load()
      flash("Connected ✓ You're in each other's lists")
      setModal({ kind: 'person', id: data as string })
    })
  }, [])

  const share = async () => {
    const url = cardUrl(uid)
    try {
      if (navigator.share) await navigator.share({ title: `${profile.name} · Connections`, url })
      else { await navigator.clipboard.writeText(url); flash('Link copied ✓') }
    } catch { /* share sheet closed */ }
  }

  const contacted = async (c: Contact) => {
    const { error } = await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', c.id)
    if (error) return alert(error.message)
    flash(`✓ ${c.name} done · next call in ${c.contact_every_days}d`)
    load()
  }

  const open = (id: string) => setModal({ kind: 'person', id })
  const selfie = (c: Contact) => (c.selfie_path ? urls[c.selfie_path] : pub(c.avatar_path))
  const evName = (id: string | null) => events.find(e => e.id === id)?.name
  const week = [...Array(7)].map((_, i) => new Date(Date.now() + i * DAY))
  const today = contacts.filter(c => bucket(c) === 0)
  const dayPeople = contacts.filter(c => bucket(c) === day).sort((a, b) => a.importance - b.importance || dueIn(a) - dueIn(b))
  const ql = q.toLowerCase()
  const people = contacts.filter(c =>
    (!level || c.importance === level) &&
    [c.name, c.phone, c.met_where, c.help_note, evName(c.event_id)].some(v => v?.toLowerCase().includes(ql)))

  const card = (c: Contact, i: number, swipe = false) => {
    const body = (
      <div className="pcard press" style={{ background: COLORS[c.importance], animationDelay: `${i * 45}ms` }} onClick={() => open(c.id)}>
        <Avatar c={c} url={selfie(c)} />
        <div className="grow">
          <b>{c.name}</b>
          <span className="small">{LEVELS[c.importance]} · {swipe ? dueText(c) : c.met_where || evName(c.event_id) || dueText(c)}</span>
        </div>
        {c.phone && <a className="circle" href={`tel:${c.phone}`} onClick={e => e.stopPropagation()} aria-label={`Call ${c.name}`}><Ic n="phone" s={18} /></a>}
        <span className="circle white"><Ic n="arrow" s={18} /></span>
      </div>
    )
    return swipe ? <Swipe key={c.id} onDone={() => contacted(c)}>{body}</Swipe> : <div key={c.id}>{body}</div>
  }

  const m = modal
  const person = m?.kind === 'person' ? contacts.find(c => c.id === m.id) : undefined
  const event = m?.kind === 'event' ? events.find(e => e.id === m.id) : undefined
  const eventPeople = event ? contacts.filter(c => c.event_id === event.id) : []
  const name = profile.name.split(' ')[0]

  return (
    <div className="app">
      <main key={tab} className="fade">
        {tab === 'home' && <>
          <header className="top">
            <button className="me press" onClick={() => setModal({ kind: 'me' })} aria-label="My card">
              {profile.photo_path ? <img src={pub(profile.photo_path)} alt="" /> : name[0]?.toUpperCase()}
            </button>
            <div className="center grow">
              <b>Hello, {name}</b>
              <div className="muted small">Today {fmt(new Date(), { day: 'numeric', month: 'short' })}</div>
            </div>
            <button className="circle white press" onClick={() => setModal({ kind: 'me' })} aria-label="Show my QR"><Ic n="qr" s={20} /></button>
            <button className="circle white press" onClick={() => { setTab('people'); setTimeout(() => searchRef.current?.focus(), 50) }} aria-label="Search">
              <Ic n="search" s={20} />
            </button>
          </header>

          <section className="hero press" onClick={() => setDay(0)}>
            <h2>Today's<br />calls</h2>
            <p>{today.length ? `${today.length} ${today.length === 1 ? 'person is' : 'people are'} waiting to hear from you` : 'All caught up. Nice work!'}</p>
            <Faces people={today} urls={urls} />
            <i className="shape s1" /><i className="shape s2" /><i className="shape s3" />
          </section>

          <div className="week">
            {week.map((d, i) => {
              const n = contacts.filter(c => bucket(c) === i).length
              return (
                <button key={i} className={`day press ${day === i ? 'on' : ''}`} onClick={() => setDay(i)}>
                  <i className={n ? 'dot' : 'dot off'} />
                  <span>{fmt(d, { weekday: 'short' })}</span>
                  <b>{d.getDate()}</b>
                </button>
              )
            })}
          </div>

          <div className="section-title">
            <h3>{day === 0 ? 'Call today' : `Call on ${fmt(week[day], { weekday: 'long' })}`}</h3>
            {dayPeople.length > 0 && <span className="muted small">swipe → when done</span>}
          </div>
          {dayPeople.length
            ? <div className="stack">{dayPeople.map((c, i) => card(c, i, true))}</div>
            : <div className="empty-card">{contacts.length ? 'Nobody due this day 🎉' : 'Tap + to add the first person you met.'}</div>}
        </>}

        {tab === 'people' && <>
          <h1 className="big">YOUR<br />PEOPLE</h1>
          <div className="search">
            <Ic n="search" s={18} />
            <input ref={searchRef} type="search" placeholder="Search name, note, event…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="chips">
            {[0, 1, 2, 3, 4].map(l => (
              <button key={l} className={`chip press ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
                {l ? LEVELS[l] : 'All'} <small>{l ? contacts.filter(c => c.importance === l).length : contacts.length}</small>
              </button>
            ))}
          </div>
          {people.length
            ? <div className="stack">{people.map((c, i) => card(c, i))}</div>
            : <div className="empty-card">{contacts.length ? 'No match.' : 'No people yet. Tap + to add someone.'}</div>}
        </>}

        {tab === 'events' && <>
          <h1 className="big">EVENTS</h1>
          <div className="bento">
            {events.map((e, i) => {
              const ppl = contacts.filter(c => c.event_id === e.id)
              return (
                <div key={e.id} className="ecard press" style={{ background: TINTS[i % TINTS.length], animationDelay: `${i * 45}ms` }}
                  onClick={() => setModal({ kind: 'event', id: e.id })}>
                  <span className="tag">{ppl.length} {ppl.length === 1 ? 'person' : 'people'}</span>
                  <h3>{e.name}</h3>
                  <p>{e.date && fmt(new Date(e.date), { day: 'numeric', month: 'short', year: 'numeric' })}<br />{e.place}</p>
                  <Faces people={ppl} urls={urls} />
                </div>
              )
            })}
            <button className="ecard new press" onClick={() => setModal({ kind: 'newEvent' })}>
              <Ic n="plus" s={30} /><b>New event</b>
            </button>
          </div>
        </>}

        {tab === 'map' && <>
          <h1 className="big">WHO I MET<br />WHERE</h1>
          <PeopleMap contacts={contacts} events={events} onOpen={open} tall />
        </>}
      </main>

      <nav className="dock">
        {(['home', 'people', 'add', 'events', 'map'] as const).map(t =>
          t === 'add'
            ? <button key={t} className="add press" onClick={() => setModal({ kind: 'edit' })} aria-label="Add person"><Ic n="plus" s={26} /></button>
            : <button key={t} className={`press ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)} aria-label={t}>
                <Ic n={{ home: 'home', people: 'people', events: 'calendar', map: 'map' }[t]} />
                {t === 'home' && today.length > 0 && <i className="badge">{today.length}</i>}
              </button>,
        )}
      </nav>

      {toast && <div className="toast">{toast}</div>}

      {m && (
        <div className="sheet" style={{ '--c': person ? COLORS[person.importance] : event || m.kind === 'me' ? '#a99bff' : 'var(--bg)' } as CSSProperties}>
          <div className="sheet-top">
            <button className="circle white press" onClick={() => setModal(null)} aria-label="Back"><Ic n="back" /></button>
            {person && <button className="circle white press" onClick={() => setModal({ kind: 'edit', c: person })} aria-label="Edit"><Ic n="edit" s={20} /></button>}
            {m.kind === 'me' && <button className="circle white press" onClick={() => setModal({ kind: 'editMe' })} aria-label="Edit my card"><Ic n="edit" s={20} /></button>}
          </div>

          {m.kind === 'me' && (
            <div className="detail">
              <div className="qr-box">
                <QR text={cardUrl(uid)} />
                <b>Scan to connect with me</b>
                <span className="muted small">They open it with their phone camera. You're both added to each other's lists.</span>
              </div>
              <div className="quick">
                <button className="press" onClick={share}><span className="circle"><Ic n="share" /></span>Share link</button>
                <a className="press" href={cardPath(uid)}><span className="circle"><Ic n="arrow" /></span>Preview</a>
                <button className="press" onClick={() => setModal({ kind: 'editMe' })}><span className="circle"><Ic n="edit" /></span>Edit</button>
                {canPrompt() && !isStandalone() && (
                  <button className="press" onClick={promptInstall}><span className="circle"><Ic n="download" /></span>Install</button>
                )}
                <button className="press" onClick={() => confirm('Sign out?') && supabase.auth.signOut()}><span className="circle"><Ic n="logout" /></span>Sign out</button>
              </div>
              <h3 className="section-label">Your card</h3>
              <div className="card-preview"><CardView p={profile} /></div>
            </div>
          )}

          {m.kind === 'editMe' && (
            <ProfileForm uid={uid} email={profile.email ?? ''} p={profile}
              done={p => { setProfile(p); flash('Card saved ✓'); setModal({ kind: 'me' }) }} />
          )}

          {person && (
            <div className="detail">
              <div className="big-avatar">{selfie(person) ? <img src={selfie(person)} alt="" /> : person.name[0].toUpperCase()}</div>
              <h1 className="center">{person.name}</h1>
              <div className="pills center-row">
                <span className="pill dark">{LEVELS[person.importance]}</span>
                {(person.met_where || evName(person.event_id)) &&
                  <span className="pill"><Ic n="pin" s={14} /> {[person.met_where, evName(person.event_id)].filter(Boolean).join(' · ')}</span>}
              </div>
              <div className="pills center-row">
                <span className="pill">Every {person.contact_every_days}d</span>
                <span className="pill">Last {ago(person.last_contacted_at)}d ago</span>
                <span className={`pill ${dueIn(person) <= 0 ? 'red' : ''}`}>{dueText(person)}</span>
              </div>
              {person.profile_id && (
                <div className="pills center-row">
                  <a className="pill dark press" href={cardPath(person.profile_id)}><Ic n="card" s={14} /> View their card</a>
                </div>
              )}

              <div className="panel">
                <h4>Can help with</h4>
                <p className="pre">{person.help_note || 'Nothing noted yet. Tap edit to add.'}</p>
              </div>
              {person.card_path && urls[person.card_path] && (
                <a className="panel photo-panel" href={urls[person.card_path]} target="_blank" rel="noreferrer">
                  <h4>Visiting card</h4><img src={urls[person.card_path]} alt="Visiting card" />
                </a>
              )}
              {person.lat != null && <PeopleMap contacts={[person]} events={[]} />}

              <div className="quick">
                <button className="press" onClick={() => contacted(person)}><span className="circle"><Ic n="check" /></span>Contacted</button>
                {person.phone && <a className="press" href={`https://wa.me/${person.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><span className="circle"><Ic n="chat" /></span>WhatsApp</a>}
                <button className="press" onClick={async () => {
                  if (!confirm(`Delete ${person.name}?`)) return
                  await supabase.from('contacts').delete().eq('id', person.id)
                  setModal(null); load()
                }}><span className="circle"><Ic n="trash" /></span>Delete</button>
              </div>

              <div className="cta">
                {person.phone
                  ? <a className="btn-black press" href={`tel:${person.phone}`}><Ic n="phone" s={18} /> Call {person.phone}</a>
                  : <button className="btn-black press" onClick={() => setModal({ kind: 'edit', c: person })}>Add a phone number</button>}
              </div>
            </div>
          )}

          {event && (
            <div className="detail">
              <h1 className="big">{event.name}</h1>
              <div className="pills">
                {event.date && <span className="pill dark">{fmt(new Date(event.date), { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                {event.place && <span className="pill"><Ic n="pin" s={14} /> {event.place}</span>}
                <span className="pill">{eventPeople.length} people</span>
              </div>
              <PeopleMap contacts={eventPeople} events={[event]} onOpen={open} />
              {eventPeople.length
                ? <div className="stack">{eventPeople.map((c, i) => card(c, i))}</div>
                : <div className="empty-card">Nobody added yet.</div>}
              <button className="btn-ghost press danger" onClick={async () => {
                if (!confirm(`Delete event ${event.name}? People stay.`)) return
                await supabase.from('events').delete().eq('id', event.id)
                setModal(null); load()
              }}>Delete event</button>
              <div className="cta">
                <button className="btn-black press" onClick={() => setModal({ kind: 'edit', eventId: event.id })}><Ic n="plus" s={18} /> Add person met here</button>
              </div>
            </div>
          )}

          {m.kind === 'edit' && (
            <PersonForm uid={uid} c={m.c} eventId={m.eventId} events={events} urls={urls}
              done={id => { load(); flash(m.c ? 'Saved ✓' : 'Person added ✓'); setModal(id ? { kind: 'person', id } : null) }} />
          )}

          {m.kind === 'newEvent' && <EventForm done={() => { load(); flash('Event created ✓'); setModal(null); setTab('events') }} />}
        </div>
      )}
    </div>
  )
}

// Swipe right to mark done. Pointer capture starts only after a real drag so taps on inner links still work.
function Swipe({ onDone, children }: { onDone: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0)
  const start = useRef<number | null>(null)
  const moved = useRef(false)
  const end = () => {
    if (dx > 110) onDone()
    start.current = null
    setDx(0)
  }
  return (
    <div className="swipe" style={{ background: dx > 0 ? '#22c55e' : 'transparent' }}>
      <span className="swipe-label" style={{ opacity: Math.min(1, dx / 110) }}><Ic n="check" /> Done</span>
      <div
        onPointerDown={e => { start.current = e.clientX; moved.current = false }}
        onPointerMove={e => {
          if (start.current == null) return
          const d = Math.max(0, e.clientX - start.current)
          if (d > 8 && !moved.current) { moved.current = true; e.currentTarget.setPointerCapture(e.pointerId) }
          if (moved.current) setDx(d)
        }}
        onPointerUp={end}
        onPointerCancel={() => { start.current = null; setDx(0) }}
        onClickCapture={e => { if (moved.current) { e.stopPropagation(); e.preventDefault() } }}
        style={{ transform: `translateX(${dx}px)`, transition: start.current == null ? 'transform .25s' : 'none', touchAction: 'pan-y' }}
      >{children}</div>
    </div>
  )
}

function Avatar({ c, url }: { c: Contact; url?: string }) {
  return url
    ? <img className="avatar" src={url} alt="" />
    : <div className="avatar">{c.name.slice(0, 1).toUpperCase()}</div>
}

function Faces({ people, urls }: { people: Contact[]; urls: Record<string, string> }) {
  if (!people.length) return null
  return (
    <div className="faces">
      {people.slice(0, 3).map(c => <Avatar key={c.id} c={c} url={c.selfie_path ? urls[c.selfie_path] : undefined} />)}
      {people.length > 3 && <div className="avatar more">+{people.length - 3}</div>}
    </div>
  )
}

function PeopleMap({ contacts, events, onOpen, tall }: { contacts: Contact[]; events: Ev[]; onOpen?: (id: string) => void; tall?: boolean }) {
  const pts = [...contacts, ...events].filter(p => p.lat != null) as { lat: number; lng: number }[]
  if (!pts.length) return tall ? <div className="empty-card">No locations yet. Allow location access when adding people.</div> : null
  return (
    <MapContainer className={tall ? 'map tall' : 'map'} bounds={pts.map(p => [p.lat, p.lng])} boundsOptions={{ padding: [40, 40], maxZoom: 15 }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      {events.filter(e => e.lat != null).map(e => (
        <CircleMarker key={e.id} center={[e.lat!, e.lng!]} radius={16} pathOptions={{ color: '#111', weight: 2, fillColor: '#a99bff', fillOpacity: 0.25 }}>
          <Popup>📅 {e.name}</Popup>
        </CircleMarker>
      ))}
      {contacts.filter(c => c.lat != null).map(c => (
        <CircleMarker key={c.id} center={[c.lat!, c.lng!]} radius={9} pathOptions={{ color: '#111', weight: 2, fillColor: COLORS[c.importance], fillOpacity: 1 }}>
          <Popup><a href="#" onClick={e => { e.preventDefault(); onOpen?.(c.id) }}>{c.name}</a><br />{c.met_where}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

function PersonForm({ uid, c, eventId, events, urls, done }: {
  uid: string; c?: Contact; eventId?: string; events: Ev[]; urls: Record<string, string>; done: (id?: string) => void
}) {
  const [f, setF] = useState({
    name: c?.name ?? '', phone: c?.phone ?? '', met_where: c?.met_where ?? '', help_note: c?.help_note ?? '',
    importance: c?.importance ?? 2, contact_every_days: c?.contact_every_days ?? 30, event_id: c?.event_id ?? eventId ?? '',
  })
  const [selfie, setSelfie] = useState<File>()
  const [card, setCard] = useState<File>()
  const [loc, setLoc] = useState(c?.lat != null ? { lat: c.lat, lng: c.lng! } : null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!c) here().then(setLoc) }, [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    setBusy(true)
    try {
      const ev = events.find(e => e.id === f.event_id)
      const row = {
        ...f, event_id: f.event_id || null, phone: f.phone || null,
        contact_every_days: Math.max(1, +f.contact_every_days || 30),
        lat: loc?.lat ?? ev?.lat ?? null, lng: loc?.lng ?? ev?.lng ?? null,
        ...(selfie && { selfie_path: await upload(uid, selfie) }),
        ...(card && { card_path: await upload(uid, card) }),
      }
      const { data, error } = c
        ? await supabase.from('contacts').update(row).eq('id', c.id).select().single()
        : await supabase.from('contacts').insert(row).select().single()
      if (error) throw error
      done(data.id)
    } catch (e) {
      alert((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="detail" onSubmit={e => { e.preventDefault(); save() }}>
      <h1 className="big">{c ? 'EDIT' : 'NEW'}<br />PERSON</h1>

      <MicButton onText={t => setF(p => ({
        ...p,
        name: p.name || nameFrom(t) || '',
        help_note: p.help_note ? `${p.help_note} ${t}` : t,
      }))} />

      <div className="two">
        <PhotoTile label="Selfie with them" icon="camera" capture="user" file={selfie} url={c?.selfie_path ? urls[c.selfie_path] : undefined} onFile={setSelfie} />
        <PhotoTile label="Visiting card" icon="card" capture="environment" file={card} url={c?.card_path ? urls[c.card_path] : undefined} onFile={setCard} />
      </div>

      <label>Name *<input required value={f.name} onChange={set('name')} placeholder="Ravi Kumar" /></label>
      <label>Mobile<input type="tel" value={f.phone} onChange={set('phone')} placeholder="+91…" /></label>
      <label>Event
        <select value={f.event_id} onChange={set('event_id')}>
          <option value="">None</option>
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <label>Where / how you met<input value={f.met_where} onChange={set('met_where')} placeholder="Goa trip, referred by Ravi…" /></label>
      <label>How they can help (now / future)<textarea rows={3} value={f.help_note} onChange={set('help_note')} placeholder="Solar panels, looking for investors…" /></label>

      <div className="field">
        <span>How important?</span>
        <div className="chips">
          {[1, 2, 3, 4].map(l => (
            <button type="button" key={l} className={`chip press ${f.importance === l ? 'on' : ''}`}
              style={f.importance === l ? { background: COLORS[l], color: '#111', borderColor: '#111' } : undefined}
              onClick={() => setF({ ...f, importance: l })}>{LEVELS[l]}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Call every</span>
        <div className="chips">
          {FREQS.map(d => (
            <button type="button" key={d} className={`chip press ${+f.contact_every_days === d ? 'on' : ''}`}
              onClick={() => setF({ ...f, contact_every_days: d })}>{d}d</button>
          ))}
          <input className="chip-input" type="number" min={1} value={f.contact_every_days} aria-label="Custom days"
            onChange={e => setF({ ...f, contact_every_days: +e.target.value })} />
        </div>
      </div>

      <div className="loc">
        <Ic n="pin" s={18} />
        <span className="grow small">{loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'No location yet'}</span>
        <button type="button" className="chip press" onClick={() => here().then(setLoc)}>Use my location</button>
      </div>

      <div className="cta">
        <button className="btn-black press" disabled={busy}>{busy ? 'Saving…' : c ? 'Save changes' : 'Save person'}</button>
      </div>
    </form>
  )
}

function PhotoTile({ label, icon, capture, file, url, onFile }: {
  label: string; icon: string; capture: 'user' | 'environment'; file?: File; url?: string; onFile: (f?: File) => void
}) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : url), [file, url])
  // `capture` forces the camera on phones, so the gallery gets its own input without it.
  const pick = (e: { target: HTMLInputElement }) => { onFile(e.target.files?.[0]); e.target.value = '' }
  return (
    <div className="tile">
      {preview ? <img src={preview} alt="" /> : <><Ic n={icon} s={28} /><span>{label}</span></>}
      <div className="tile-actions">
        <label className="tile-btn press" aria-label={`${label}: take photo`}>
          <Ic n="camera" s={16} /> Camera
          <input type="file" accept="image/*" capture={capture} hidden onChange={pick} />
        </label>
        <label className="tile-btn press" aria-label={`${label}: choose from gallery`}>
          <Ic n="gallery" s={16} /> Gallery
          <input type="file" accept="image/*" hidden onChange={pick} />
        </label>
      </div>
    </div>
  )
}

// Browser speech-to-text (Chrome, Edge, Safari). Hidden where unsupported, e.g. Firefox.
const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

function MicButton({ onText }: { onText: (t: string) => void }) {
  const rec = useRef<any>(null)
  const [on, setOn] = useState(false)
  if (!SR) return null
  const start = () => {
    if (rec.current) return
    const r = new SR()
    r.lang = navigator.language
    r.continuous = true
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim())
    }
    r.onerror = (e: any) => { if (e.error === 'not-allowed') alert('Allow microphone access to use voice notes.') }
    r.onend = () => { rec.current = null; setOn(false) }
    r.start()
    rec.current = r
    setOn(true)
  }
  const stop = () => rec.current?.stop()
  return (
    <button type="button" className={on ? 'mic on' : 'mic'} onPointerDown={start} onPointerUp={stop}
      onPointerCancel={stop} onContextMenu={e => e.preventDefault()}>
      <span className="mic-dot"><Ic n="mic" /></span>
      <span>
        <b>{on ? 'Listening… release to stop' : 'Hold to talk'}</b>
        <small>{on ? 'Say who they are and how they can help' : '"Met Ravi, does solar panels, wants investors"'}</small>
      </span>
    </button>
  )
}

function EventForm({ done }: { done: () => void }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [place, setPlace] = useState('')
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => { here().then(setLoc) }, [])
  return (
    <form className="detail" onSubmit={async e => {
      e.preventDefault()
      const { error } = await supabase.from('events').insert({ name, date, place: place || null, lat: loc?.lat ?? null, lng: loc?.lng ?? null })
      if (error) return alert(error.message)
      done()
    }}>
      <h1 className="big">NEW<br />EVENT</h1>
      <label>Name *<input required value={name} onChange={e => setName(e.target.value)} placeholder="Startup Summit 2026" /></label>
      <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Place<input value={place} onChange={e => setPlace(e.target.value)} placeholder="Bengaluru Palace" /></label>
      <div className="loc">
        <Ic n="pin" s={18} />
        <span className="grow small">{loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (you are here)` : 'Getting your location…'}</span>
      </div>
      <div className="cta"><button className="btn-black press">Create event</button></div>
    </form>
  )
}
