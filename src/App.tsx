import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@supabase/supabase-js'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import QRCode from 'qrcode'
import { LOCAL, supabase } from './supabase'
import { nameFrom } from './voice'
import { parseCard } from './cardscan'
import { Av } from './faces'
const Intro = lazy(() => import('./Intro')) // only first-time visitors download this
import { COUNTRIES, byCode, flag, fullNumber, guessCountry, splitNumber, waDigits } from './countries'
import { canPrompt, isIOS, isStandalone, onInstallChange, promptInstall, pushNeedsInstall, pushSupported, subscribePush } from './pwa'

type Contact = {
  id: string; event_id: string | null; profile_id: string | null; name: string; phone: string | null
  email: string | null; company: string | null; hometown: string | null; current_city: string | null
  next_call_at: string | null // a date picked after a call; overrides "call every X days"
  met_where: string | null; help_note: string | null; importance: number
  contact_every_days: number; last_contacted_at: string
  selfie_path: string | null; card_path: string | null; avatar_path: string | null
  lat: number | null; lng: number | null
}
type Link = { label: string; url: string }
type Note = { id: string; contact_id: string; kind: 'call' | 'note'; format: 'note' | 'points'; body: string; created_at: string }
type Profile = {
  id: string; name: string; headline: string | null; phone: string | null; email: string | null
  city: string | null; hometown: string | null; help_with: string | null; photo_path: string | null; links: Link[]
  hosts_events?: boolean // private: shows "Create a room" in Events
  country?: string | null // ISO code, e.g. IN; sets the phone code
}
type Ev = { id: string; name: string; date: string | null; place: string | null; lat: number | null; lng: number | null; room_id?: string | null }
type Room = {
  id: string; name: string; place: string | null; description: string | null; starts_at: string; ends_at: string
  organizer_id: string; organizer_name: string | null; member_count: number
}
type RoomPerson = { user_id: string; name: string; headline: string | null; city: string | null; photo_path: string | null; is_organizer: boolean }
type Tab = 'home' | 'people' | 'events' | 'map'
type Modal =
  | { kind: 'person'; id: string }
  | { kind: 'edit'; c?: Contact; eventId?: string }
  | { kind: 'event'; id: string }
  | { kind: 'newEvent' }
  | { kind: 'me' }
  | { kind: 'editMe' }
  | { kind: 'room'; id: string }
  | { kind: 'newRoom' }
  | { kind: 'settings' }
  | null

// Your categories (Settings): first = most important. contacts.importance is the 1-based position.
type Cat = { name: string; color: string }
const CAT_COLORS = ['#ff7a6b', '#ffc145', '#a99bff', '#a9c8ff', '#c9e27f', '#f7b3e4', '#7dd3c0', '#d4b483']
const MAX_CATS = 8
const DEFAULT_CATS: Cat[] = [
  { name: 'VIMP', color: '#ff7a6b' }, { name: 'IMP', color: '#ffc145' },
  { name: 'Normal', color: '#a99bff' }, { name: 'Low', color: '#a9c8ff' },
]
// ponytail: module-level, set by App before every render so all screens read the same list;
// pass it down as a prop if components ever start memoizing.
let CATS: Cat[] = DEFAULT_CATS
let MY_COUNTRY = guessCountry() // replaced by your card's country once loaded
const catIds = () => CATS.map((_, k) => k + 1)
const catName = (i: number) => CATS[i - 1]?.name ?? CATS[CATS.length - 1].name
const catColor = (i: number) => CATS[i - 1]?.color ?? '#d4d4d4'
const TINTS = ['#a99bff', '#ffc145', '#a9c8ff', '#f7b3e4', '#c9e27f']
const FREQS = [7, 14, 30, 60, 90]
const LINK_PRESETS = ['LinkedIn', 'Instagram', 'Website', 'X', 'YouTube', 'Portfolio']
// Which icon a link gets: matched on its label or its address, globe for anything else.
const LINK_KINDS = [
  { icon: 'linkedin', hint: 'linkedin.com/in/you', color: '#0a66c2', label: /linked\s*in/i, url: /linkedin\.com/i },
  { icon: 'instagram', hint: 'instagram.com/you', color: '#e1306c', label: /insta/i, url: /instagram\.com|instagr\.am/i },
  { icon: 'x', hint: 'x.com/you', color: '#000000', label: /^x$|twitter/i, url: /\b(x|twitter)\.com/i },
  { icon: 'youtube', hint: 'youtube.com/@you', color: '#ff0000', label: /you\s*tube/i, url: /youtube\.com|youtu\.be/i },
  { icon: 'portfolio', hint: 'behance.net/you', color: '#7c3aed', label: /portfolio|behance|dribbble/i, url: /behance\.net|dribbble\.com/i },
]
const linkKind = (l: Link) =>
  LINK_KINDS.find(k => k.url.test(l.url)) ?? LINK_KINDS.find(k => k.label.test(l.label)) ?? { icon: 'globe', hint: 'yourwebsite.com', color: '#111111' }
const LinkIcon = ({ l, s = 20 }: { l: Link; s?: number }) => {
  const k = linkKind(l)
  return <span className="brand" style={{ color: k.color }}><Ic n={k.icon} s={s} /></span>
}
const PENDING = 'connections-pending-connect' // card id waiting to be connected after login
const PENDING_ROOM = 'connections-pending-room' // room waiting to be joined after login
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
const roomUrl = (id: string) => `${publicOrigin}/?room=${encodeURIComponent(id)}`
const roomStatus = (r: { starts_at: string; ends_at: string }) =>
  Date.now() < +new Date(r.starts_at) ? 'upcoming' : Date.now() > +new Date(r.ends_at) ? 'ended' : 'live'
const until = (iso: string) => { // "2h 15m", "3 days"
  const m = Math.max(0, Math.round((+new Date(iso) - Date.now()) / 6e4))
  return m >= 2880 ? `${Math.round(m / 1440)} days` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// crypto.randomUUID only exists on https/localhost; phones on the Wi-Fi address use plain http.
const uuid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const nn = (s: string) => s.trim() || null
const DAY = 864e5
const dueAt = (c: Contact) =>
  c.next_call_at ? new Date(c.next_call_at).getTime() : new Date(c.last_contacted_at).getTime() + c.contact_every_days * DAY
const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)
// Calendar days until the call: "in 2 weeks" reads 14, whatever the time of day.
const dueIn = (c: Contact) => Math.round((startOfDay(dueAt(c)) - startOfDay(Date.now())) / DAY)
const bucket = (c: Contact) => Math.max(0, dueIn(c)) // overdue counts as today
// Relationship health: 0 = just talked, 1 = cold (twice their call gap with no contact).
// After 6 months with no contact someone goes to the graveyard until you call them again.
const GRAVE_DAYS = 180
const daysSince = (c: Contact) => (Date.now() - new Date(c.last_contacted_at).getTime()) / DAY
const inGrave = (c: Contact) => daysSince(c) > GRAVE_DAYS
const gapDays = (c: Contact) => Math.max(1, (dueAt(c) - new Date(c.last_contacted_at).getTime()) / DAY)
const health = (c: Contact) => Math.min(1, daysSince(c) / (gapDays(c) * 2))
const healthColor = (c: Contact) => (inGrave(c) ? '#8b8b8b' : `hsl(${Math.round(135 * (1 - health(c)))} 72% 42%)`)
const healthLabel = (c: Contact) => (inGrave(c) ? 'In the graveyard' : health(c) < 0.35 ? 'Strong' : health(c) < 0.7 ? 'Fading' : 'Cold')
const monthsSince = (c: Contact) => Math.floor(daysSince(c) / 30)
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
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" /></>,
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 10.5V16M8 7.5v.01M12 16v-5.5M12 13a2.5 2.5 0 0 1 5 0v3" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5.5" /><circle cx="12" cy="12" r="4" /><path d="M17.3 6.7v.01" /></>,
  x: <path d="M4 4h4.5L20 20h-4.5zM20 4l-6.8 7.6M4 20l6.8-7.6" />,
  youtube: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10.2 9.4v5.2l4.4-2.6z" fill="currentColor" /></>,
  portfolio: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9" /></>,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  play: <path d="M8 5v14l11-7z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeoff: <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0" />,
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
  const [cats, setCats] = useState<Cat[]>(DEFAULT_CATS)
  const [recovering, setRecovering] = useState(false)
  // First visit (signed out): 3 story screens before sign-in. Not for scanned card/room links or anyone returning.
  const [intro, setIntro] = useState(() => {
    try { return !localStorage.getItem('intro-seen') && !localStorage.getItem(PENDING) && !localStorage.getItem(PENDING_ROOM) } catch { return false }
  })
  MY_COUNTRY = profile?.country ?? guessCountry()
  CATS = cats
  const uid = session?.user.id
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      if (e === 'PASSWORD_RECOVERY') setRecovering(true) // opened the reset link from the email
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    setProfile(undefined)
    if (uid) supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => setProfile(data))
    if (uid) supabase.from('user_settings').select('*').eq('id', uid).maybeSingle()
      .then(({ data }) => setCats(data?.categories?.length ? data.categories : DEFAULT_CATS))
  }, [uid])

  const pid = new URLSearchParams(location.search).get('u')
  const rid = new URLSearchParams(location.search).get('room')
  if (!ready) return null
  if (pid) return <PublicCard pid={pid} mine={pid === uid} loggedIn={!!uid} />
  if (rid) return <RoomJoin rid={rid} />
  if (recovering && session) return <NewPassword done={() => setRecovering(false)} />
  if (!session || !uid) {
    return intro
      ? <Suspense fallback={null}><Intro onDone={() => { try { localStorage.setItem('intro-seen', '1') } catch { /* private mode */ } setIntro(false) }} /></Suspense>
      : <Login />
  }
  if (profile === undefined) return null
  if (!profile) return (
    <div className="app">
      <ProfileForm uid={uid} email={session.user.email ?? ''} onboarding done={setProfile}
        defaultName={session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? ''} />
    </div>
  )
  return <Home uid={uid} profile={profile} setProfile={setProfile} cats={cats} setCats={setCats} />
}

// What someone sees after scanning a QR. Anyone can view the card; saving needs an account.
function PublicCard({ pid, mine, loggedIn }: { pid: string; mine: boolean; loggedIn: boolean }) {
  const [p, setP] = useState<Profile | null>()
  const [ask, setAsk] = useState(false)
  const [installHelp, setInstallHelp] = useState(false) // show install steps where there's no prompt
  useEffect(() => { if (installHelp && !loggedIn) localStorage.setItem(PENDING, pid) }, [installHelp]) // install, then sign in: still saves them
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
            {/* Always offered (unless already installed): the real prompt where the browser has one, steps otherwise. */}
            {!isStandalone() && (
              <button className="btn-black press" onClick={() => (canPrompt() ? install() : setInstallHelp(true))}>
                <Ic n="download" s={18} /> Install the app
              </button>
            )}
            {installHelp && (
              <div className="ios-hint" role="status">
                {isIOS
                  ? <>Tap <Ic n="share" s={16} /> <b>Share</b> at the bottom of Safari, then <b>Add to Home Screen</b></>
                  : <>Open your browser menu <b>⋮</b>, then tap <b>Install app</b> or <b>Add to Home screen</b></>}
              </div>
            )}
            {!loggedIn && (
              <button className={isStandalone() ? 'btn-black press' : 'btn-ghost press'} onClick={connect}>Sign in or create account</button>
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

// "Lives in Mumbai" and "From Nagpur" pills; shows nothing when both are empty.
function Places({ lives, from }: { lives: string | null; from: string | null }) {
  if (!lives && !from) return null
  return (
    <div className="pills center-row">
      {lives && <span className="pill"><Ic n="pin" s={14} /> Lives in {lives}</span>}
      {from && <span className="pill"><Ic n="home" s={14} /> From {from}</span>}
    </div>
  )
}

// The Linktree-style card: what people see when they scan your QR.
function CardView({ p }: { p: Profile }) {
  const wa = p.phone ? waDigits(p.phone, p.country ?? MY_COUNTRY) : ''
  return <>
    <div className="big-avatar">{p.photo_path ? <img src={pub(p.photo_path)} alt="" /> : p.name[0]?.toUpperCase()}</div>
    <h1 className="center">{p.name}</h1>
    {p.headline && <p className="center headline">{p.headline}</p>}
    <Places lives={p.city} from={p.hometown} />
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
            <LinkIcon l={l} /><b className="grow">{l.label || l.url}</b><span className="circle white"><Ic n="arrow" s={18} /></span>
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

function ProfileForm({ uid, email, p, onboarding, done, defaultName = '' }: {
  uid: string; email: string; p?: Profile; onboarding?: boolean; done: (p: Profile) => void; defaultName?: string
}) {
  const [f, setF] = useState({
    name: p?.name ?? defaultName, headline: p?.headline ?? '', phone: splitNumber(p?.phone, p?.country ?? guessCountry()).national, email: p?.email ?? email,
    city: p?.city ?? '', hometown: p?.hometown ?? '', help_with: p?.help_with ?? '',
  })
  const [links, setLinks] = useState<Link[]>(p?.links ?? [{ label: 'LinkedIn', url: '' }])
  const [hosts, setHosts] = useState(!!p?.hosts_events)
  const [country, setCountry] = useState(p?.country ?? guessCountry())
  const [photo, setPhoto] = useState<File>()
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setLink = (i: number, k: keyof Link) => (e: { target: { value: string } }) =>
    setLinks(links.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)))

  const save = async () => {
    setBusy(true)
    try {
      const row = {
        id: uid, name: f.name.trim(), headline: nn(f.headline), phone: fullNumber(country, f.phone), country, email: nn(f.email),
        city: nn(f.city), hometown: nn(f.hometown), help_with: nn(f.help_with), hosts_events: hosts,
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
        <PhotoTile crop label="Your photo" icon="camera" capture="user" file={photo} url={pub(p?.photo_path)} onFile={setPhoto} />
      </div>
      <label>Full name *<input required value={f.name} onChange={set('name')} placeholder="Ravi Kumar" autoComplete="name" /></label>
      <label>Headline<input value={f.headline} onChange={set('headline')} placeholder="Founder @ SolarCo · Angel investor" /></label>
      <label>Country
        <select value={country} onChange={e => setCountry(e.target.value)} autoComplete="country">
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{flag(c.code)} {c.name} (+{c.dial})</option>)}
        </select>
      </label>
      <label>Mobile
        <span className="phone-field">
          <span className="dial" aria-hidden>{flag(country)} +{byCode(country)?.dial}</span>
          <input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98765 43210" autoComplete="tel-national"
            aria-label={`Mobile number, after +${byCode(country)?.dial}`} />
        </span>
      </label>
      <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <div className="two">
        <label>Currently living in<input value={f.city} onChange={set('city')} placeholder="Mumbai" autoComplete="address-level2" /></label>
        <label>Hometown<input value={f.hometown} onChange={set('hometown')} placeholder="Nagpur" /></label>
      </div>
      <label>I can help with<textarea rows={3} value={f.help_with} onChange={set('help_with')} placeholder="Solar projects, startup fundraising, Pune real estate…" /></label>

      {onboarding && <label className={`host-toggle press ${hosts ? 'on' : ''}`}>
        <input type="checkbox" checked={hosts} onChange={e => setHosts(e.target.checked)} />
        <span className="tick" aria-hidden><Ic n="check" s={16} /></span>
        <span className="grow">
          <b>I host events</b>
          <span className="small">Get a "Create a room" option: one QR for your guests to join and meet each other. You can change this any time in Settings.</span>
        </span>
      </label>}

      <div className="field">
        <span>Links</span>
        {links.map((l, i) => (
          <div className="link-row" key={i}>
            <LinkIcon l={l} s={18} />
            <input className="link-label" value={l.label} onChange={setLink(i, 'label')} placeholder="Label" aria-label="Link label" />
            <input value={l.url} onChange={setLink(i, 'url')} placeholder={linkKind(l).hint} inputMode="url" aria-label={`${l.label || 'Link'} URL`} />
            <button type="button" className="circle white press" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove link">
              <Ic n="trash" s={16} />
            </button>
          </div>
        ))}
        <div className="chips">
          {LINK_PRESETS.map(x => (
            <button type="button" key={x} className="chip press chip-icon" onClick={() => setLinks(ls => [...ls, { label: x, url: '' }])}>
              <LinkIcon l={{ label: x, url: '' }} s={15} /> {x}
            </button>
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

// Supabase's messages are technical; say what happened and what to do next.
function friendlyAuthError(m: string): { text: string; resend?: boolean; switchTo?: 'signin' | 'signup' } {
  const s = m.toLowerCase()
  if (s.includes('invalid login credentials')) return { text: 'Wrong email or password. Try again, or reset your password.' }
  if (s.includes('email not confirmed')) return { text: 'Please confirm your email first. Check your inbox (and spam).', resend: true }
  if (s.includes('already registered') || s.includes('already exists')) return { text: 'An account with this email already exists. Sign in instead.', switchTo: 'signin' }
  if (s.includes('password should be') || s.includes('weak')) return { text: 'Choose a stronger password: at least 8 characters, mixing letters and numbers.' }
  if (s.includes('rate limit') || s.includes('too many') || s.includes('security purposes')) return { text: 'Too many tries. Wait a minute and try again.' }
  if (s.includes('provider is not enabled')) return { text: 'Google sign-in is not available right now. Use email instead.' }
  if (s.includes('network') || s.includes('failed to fetch')) return { text: 'No internet connection. Check it and try again.' }
  if (s.includes('access_denied') || s.includes('cancel')) return { text: 'Google sign-in was cancelled.' }
  return { text: m }
}

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" width={20} height={20} aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
)

function Login() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<'' | 'email' | 'google'>('')
  const [err, setErr] = useState<ReturnType<typeof friendlyAuthError> | null>(null)
  const [info, setInfo] = useState('')

  // Errors Google/Supabase send back in the URL after a failed redirect (e.g. cancelled).
  useEffect(() => {
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1))
    const e = q.get('error_description') || q.get('error')
    if (e) { setErr(friendlyAuthError(e)); history.replaceState(null, '', location.pathname) }
  }, [])

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const pwMin = mode === 'signup' ? 8 : 6
  const errors = {
    name: mode === 'signup' && !name.trim() ? 'Enter your name' : '',
    email: !email.trim() ? 'Enter your email' : !emailOk ? "That doesn't look like an email" : '',
    password: mode === 'forgot' ? '' : password.length < pwMin ? `At least ${pwMin} characters` : '',
  }
  const valid = !errors.name && !errors.email && !errors.password
  const switchMode = (m: typeof mode) => { setMode(m); setErr(null); setInfo(''); setTouched({}) }

  const submit = async () => {
    setTouched({ name: true, email: true, password: true })
    if (!valid) return
    setBusy('email'); setErr(null); setInfo('')
    const redirectTo = location.origin
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        if (error) throw error
        setInfo(`If ${email.trim()} has an account, a reset link is on its way. Open it on this device.`)
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password, options: { emailRedirectTo: redirectTo, data: { full_name: name.trim() } },
        })
        if (error) throw error
        // Supabase hides "already registered" behind a user with no identities.
        if (data.user && data.user.identities?.length === 0) return setErr(friendlyAuthError('already registered'))
        if (!data.session) setInfo(`Almost done! We sent a confirmation link to ${email.trim()}. Open it, then you're in.`)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e) {
      setErr(friendlyAuthError((e as Error).message))
    } finally {
      setBusy('')
    }
  }
  const google = async () => {
    setBusy('google'); setErr(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })
    if (error) { setErr(friendlyAuthError(error.message)); setBusy('') } // on success the page leaves for Google
  }
  const resend = async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: location.origin } })
    if (error) setErr(friendlyAuthError(error.message))
    else { setErr(null); setInfo(`Sent again to ${email.trim()}.`) }
  }
  const fieldErr = (k: keyof typeof errors) => touched[k] && errors[k] ? <span className="field-err">{errors[k]}</span> : null

  const heading = mode === 'signin'
    ? { h: <>Welcome <mark>back.</mark></>, p: 'Your people are waiting. Pick up right where you left off.' }
    : mode === 'signup'
      ? { h: <>Start remembering<br /><mark>everyone.</mark></>, p: 'Free to start. Takes 30 seconds.' }
      : { h: <>Forgot your<br /><mark>password?</mark></>, p: "Enter your email and we'll send you a link to reset it." }

  return (
    <div className="lg">
      <div className="lg-bg" aria-hidden><i /><i /></div>
      <form className="lg-form" noValidate onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="lg-hero" aria-hidden>
          <span className="lg-bub b1" style={{ '--d': '.5s' } as CSSProperties}>📞</span>
          <span className="lg-bub b2" style={{ '--d': '.7s' } as CSSProperties}>🔔</span>
          {[1, 3, 0, 5, 2].map((p, k) => <span key={k} className={`lg-face f${k}`} style={{ '--d': `${[0.15, 0.05, 0, 0.1, 0.2][k]}s` } as CSSProperties}><Av i={p} /></span>)}
        </div>
        <h1 className="lg-title" key={mode}>{heading.h}</h1>
        <p className="lg-sub" key={mode + 'p'}>{heading.p}</p>

        <div className="lg-card">
          {mode === 'forgot'
            ? <button type="button" className="lg-back" onClick={() => switchMode('signin')}><Ic n="back" s={16} /> Back to sign in</button>
            : <div className="seg auth-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchMode('signin')}>Sign in</button>
                <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>Create account</button>
              </div>}

          {mode !== 'forgot' && (
            <>
              <button type="button" className="btn-google press" onClick={google} disabled={!!busy}>
                {busy === 'google' ? <span className="spin" aria-hidden /> : <GoogleIcon />} Continue with Google
              </button>
              <div className="or"><span>or with email</span></div>
            </>
          )}

          <div className="lg-fields" key={mode}>
            {mode === 'signup' && (
              <label className="auth-field">Full name
                <span className="lg-in"><Ic n="user" s={18} />
                  <input value={name} onChange={e => setName(e.target.value)} onBlur={() => setTouched(t => ({ ...t, name: true }))}
                    autoComplete="name" placeholder="Ravi Kumar" aria-invalid={!!(touched.name && errors.name)} />
                </span>
                {fieldErr('name')}
              </label>
            )}
            <label className="auth-field">Email
              <span className="lg-in"><Ic n="mail" s={18} />
                <input type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => setTouched(t => ({ ...t, email: true }))}
                  autoComplete="email" placeholder="you@example.com" aria-invalid={!!(touched.email && errors.email)} />
              </span>
              {fieldErr('email')}
            </label>
            {mode !== 'forgot' && (
              <label className="auth-field">Password
                <span className="pw lg-in"><Ic n="lock" s={18} />
                  <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, password: true }))} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} aria-invalid={!!(touched.password && errors.password)} />
                  <button type="button" className="pw-eye" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                    <Ic n={show ? 'eyeoff' : 'eye'} s={20} />
                  </button>
                </span>
                {fieldErr('password')}
              </label>
            )}
          </div>
          {mode === 'signin' && <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>Forgot password?</button>}

          <button className="btn-black press lg-cta" disabled={!!busy}>
            {busy === 'email' && <span className="spin light" aria-hidden />}
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            {!busy && <Ic n="arrow" s={18} />}
          </button>

          {err && (
            <p className="msg" role="alert">
              {err.text}{' '}
              {err.resend && <button type="button" className="link-btn inline" onClick={resend}>Resend email</button>}
              {err.switchTo && <button type="button" className="link-btn inline" onClick={() => switchMode(err.switchTo!)}>Sign in</button>}
            </p>
          )}
          {info && <p className="auth-info" role="status">{info}</p>}
        </div>

        <p className="lg-foot">🔒 Private by design. Only you can see the people you save.</p>
        {LOCAL && <p className="muted small center">Local test mode: any email/password works, data stays in this browser.</p>}
      </form>
    </div>
  )
}

// Opened from the reset email: choose a new password.
function NewPassword({ done }: { done: () => void }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (password.length < 8) return setErr('At least 8 characters')
    setBusy(true); setErr('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setErr(friendlyAuthError(error.message).text)
    done()
  }
  return (
    <form className="login" onSubmit={e => { e.preventDefault(); save() }}>
      <h1 className="big">NEW<br />PASSWORD</h1>
      <p className="muted">Choose a new password for your account.</p>
      <label className="auth-field">New password
        <span className="pw">
          <input autoFocus type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
          <button type="button" className="pw-eye" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}><Ic n={show ? 'eyeoff' : 'eye'} s={20} /></button>
        </span>
        {err && <span className="field-err">{err}</span>}
      </label>
      <button className="btn-black press" disabled={busy}>{busy && <span className="spin light" aria-hidden />} Save password</button>
    </form>
  )
}

function Home({ uid, profile, setProfile, cats, setCats }: {
  uid: string; profile: Profile; setProfile: (p: Profile) => void; cats: Cat[]; setCats: (c: Cat[]) => void
}) {
  const [tab, setTab] = useState<Tab>('home')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [modal, setModal] = useState<Modal>(null)
  const [q, setQ] = useState('')
  const [level, setLevel] = useState(0)
  const [showGrave, setShowGrave] = useState(false)
  const [day, setDay] = useState(0)
  const [toast, setToast] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [, rerender] = useState(0)
  useEffect(() => onInstallChange(() => rerender(n => n + 1)), [])
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2200) }

  const [notes, setNotes] = useState<Note[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [noteFor, setNoteFor] = useState<Contact>() // who the "how did the call go?" popup is for

  // ponytail: loads every note up front; fetch per person if someone logs thousands of calls.
  const load = async () => {
    const [c, e, n, r] = await Promise.all([
      supabase.from('contacts').select('*').order('name'),
      supabase.from('events').select('*').order('date', { ascending: false }),
      supabase.from('interactions').select('*').order('created_at', { ascending: false }),
      supabase.rpc('my_rooms'),
    ])
    if (c.error || e.error) return alert((c.error ?? e.error)!.message)
    setContacts(c.data)
    setEvents(e.data)
    setNotes(n.data ?? [])
    setRooms((r.data as Room[] | null) ?? [])
    const paths = c.data.flatMap(x => [x.selfie_path, x.card_path]).filter(Boolean) as string[]
    if (paths.length) {
      const { data } = await supabase.storage.from('photos').createSignedUrls(paths, DAY / 1000)
      setUrls(Object.fromEntries((data ?? []).map(d => [d.path, d.signedUrl])))
    }
  }
  useEffect(() => { load() }, [])

  // Live updates: any change to your people, events, notes, rooms or card (from another device, or
  // someone connecting with you by QR) reloads the data. Also refresh when you come back to the app.
  useEffect(() => {
    let t: number | undefined
    const refresh = () => { clearTimeout(t); t = window.setTimeout(load, 250) } // one reload per burst
    const ch = supabase.channel(`live:${uid}`)
    for (const table of ['contacts', 'events', 'interactions', 'rooms'])
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table }, refresh)
    ch.on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
      (e: { new?: Profile }) => { if (e?.new?.id) setProfile(e.new) })
    ch.subscribe()
    const onBack = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('online', refresh)
    return () => {
      clearTimeout(t)
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('online', refresh)
    }
  }, [uid])

  // Came here from a room QR: join it (needs a card, which onboarding guarantees) and open it.
  useEffect(() => {
    const rid = localStorage.getItem(PENDING_ROOM)
    if (!rid) return
    localStorage.removeItem(PENDING_ROOM)
    supabase.rpc('join_room', { rid }).then(async ({ error }) => {
      if (error) return alert(error.message)
      pingRoom(rid) // others in the room see the new guest right away
      await load()
      setTab('events')
      setModal({ kind: 'room', id: rid })
      flash("🎉 You're in the room")
    })
  }, [])

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

  // "on" = this device gets reminders, "off" = can be turned on, "na" = this browser can't do push
  const [push, setPush] = useState<'on' | 'off' | 'na'>(pushSupported() ? 'off' : 'na')
  useEffect(() => {
    if (!pushSupported() || Notification.permission !== 'granted') return
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => { if (s) setPush('on') })
  }, [])
  const enableReminders = async () => {
    try {
      const s = await subscribePush(import.meta.env.VITE_VAPID_PUBLIC_KEY)
      const { error } = await supabase.from('push_subscriptions')
        .upsert({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }, { onConflict: 'endpoint' })
      if (error) throw error
      setPush('on')
      flash("🔔 Reminders on. We'll tell you when it's time to call")
    } catch (e) { alert((e as Error).message) }
  }

  // Tapping Call opens the phone app; when you come back to this app, ask how the call went.
  const calling = useRef<{ c: Contact; left: boolean } | null>(null)
  const startCall = (c: Contact) => { calling.current = { c, left: false } }
  useEffect(() => {
    const onVis = () => {
      const call = calling.current
      if (!call) return
      if (document.hidden) call.left = true
      else if (call.left) { calling.current = null; setNoteFor(call.c) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const saveNote = async (c: Contact, body: string, format: 'note' | 'points', next: Date) => {
    if (body) {
      const { error } = await supabase.from('interactions').insert({ contact_id: c.id, kind: 'call', format, body })
      if (error) return alert(error.message)
    }
    const { error } = await supabase.from('contacts')
      .update({ last_contacted_at: new Date().toISOString(), next_call_at: next.toISOString() }).eq('id', c.id)
    if (error) return alert(error.message)
    setNoteFor(undefined)
    flash(`✓ Next call with ${c.name.split(' ')[0]}: ${fmt(next, { weekday: 'short', day: 'numeric', month: 'short' })}`)
    load()
  }
  const deleteNote = async (n: Note) => {
    if (!confirm('Delete this note?')) return
    await supabase.from('interactions').delete().eq('id', n.id)
    load()
  }

  const contacted = async (c: Contact) => {
    // A date you set stays until that day comes; after that it's back to "call every X days".
    const keep = c.next_call_at && dueIn(c) > 0
    const { error } = await supabase.from('contacts')
      .update({ last_contacted_at: new Date().toISOString(), next_call_at: keep ? c.next_call_at : null }).eq('id', c.id)
    if (error) return alert(error.message)
    flash(keep
      ? `✓ ${c.name} done · next call ${fmt(new Date(c.next_call_at!), { weekday: 'short', day: 'numeric', month: 'short' })}`
      : `✓ ${c.name} done · next call in ${c.contact_every_days}d`)
    load()
  }

  const open = (id: string) => setModal({ kind: 'person', id })
  const selfie = (c: Contact) => (c.selfie_path ? urls[c.selfie_path] : pub(c.avatar_path))
  const evName = (id: string | null) => events.find(e => e.id === id)?.name
  const week = [...Array(7)].map((_, i) => new Date(Date.now() + i * DAY))
  // The graveyard sits apart: not in Today's calls or the main list until revived with a call.
  const alive = contacts.filter(c => !inGrave(c))
  const grave = contacts.filter(inGrave)
  const today = alive.filter(c => bucket(c) === 0)
  const dayPeople = alive.filter(c => bucket(c) === day).sort((a, b) => a.importance - b.importance || dueIn(a) - dueIn(b))
  const ql = q.toLowerCase()
  const people = (showGrave ? grave : alive).filter(c =>
    (!level || c.importance === level) &&
    [c.name, c.phone, c.email, c.company, c.current_city, c.hometown, c.met_where, c.help_note, evName(c.event_id)].some(v => v?.toLowerCase().includes(ql)))

  const card = (c: Contact, i: number, swipe = false) => {
    const body = (
      <div className={`pcard press ${inGrave(c) ? 'grave' : ''}`} style={{ background: catColor(c.importance), animationDelay: `${i * 45}ms` }} onClick={() => open(c.id)}>
        <Avatar c={c} url={selfie(c)} />
        <div className="grow">
          <b>{inGrave(c) && '🪦 '}{c.name}</b>
          <span className="small">
            {inGrave(c)
              ? `No contact for ${monthsSince(c)} months`
              : <>{catName(c.importance)} · {swipe ? dueText(c) : c.company || c.met_where || evName(c.event_id) || dueText(c)}</>}
          </span>
        </div>
        {c.phone && <a className="circle" href={`tel:${c.phone}`} onClick={e => { e.stopPropagation(); startCall(c) }} aria-label={`Call ${c.name}`}><Ic n="phone" s={18} /></a>}
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
              const n = alive.filter(c => bucket(c) === i).length
              return (
                <button key={i} className={`day press ${day === i ? 'on' : ''}`} onClick={() => setDay(i)}>
                  <i className={n ? 'dot' : 'dot off'} />
                  <span>{fmt(d, { weekday: 'short' })}</span>
                  <b>{d.getDate()}</b>
                </button>
              )
            })}
          </div>

          {push === 'off' && (
            <div className="remind-card">
              <span className="circle"><Ic n="bell" /></span>
              <div className="grow">
                <b>Remind me when it's time to call</b>
                <span className="small">{pushNeedsInstall()
                  ? 'On iPhone: tap Share → Add to Home Screen, open the app from there, then turn this on.'
                  : Notification.permission === 'denied'
                    ? 'Notifications are blocked for this site. Allow them in your phone or browser settings.'
                    : 'A notification every morning with who to call.'}</span>
              </div>
              {!pushNeedsInstall() && Notification.permission !== 'denied' &&
                <button className="chip press on" onClick={enableReminders}>Turn on</button>}
            </div>
          )}

          <div className="section-title">
            <h3>{day === 0 ? 'Call today' : `Call on ${fmt(week[day], { weekday: 'long' })}`}</h3>
            {dayPeople.length > 0 && <span className="muted small">swipe → when done</span>}
          </div>
          {dayPeople.length
            ? <div className="stack">{dayPeople.map((c, i) => card(c, i, true))}</div>
            : <div className="empty-card">{contacts.length ? 'Nobody due this day 🎉' : 'Tap + to add the first person you met.'}</div>}
        </>}

        {tab === 'people' && <>
          <h1 className="big">{showGrave ? <>THE<br />GRAVEYARD</> : <>YOUR<br />PEOPLE</>}</h1>
          <div className="seg people-seg" role="tablist">
            <button role="tab" aria-selected={!showGrave} className={showGrave ? '' : 'on'} onClick={() => setShowGrave(false)}>
              People <small>{alive.length}</small>
            </button>
            <button role="tab" aria-selected={showGrave} className={showGrave ? 'on' : ''} onClick={() => setShowGrave(true)}>
              🪦 Graveyard <small>{grave.length}</small>
            </button>
          </div>
          {showGrave && <p className="muted small grave-intro">No contact for over 6 months. Call them or tap Contacted to bring them back to life.</p>}
          <div className="search">
            <Ic n="search" s={18} />
            <input ref={searchRef} type="search" placeholder="Search name, note, event…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="chips">
            {[0, ...catIds()].map(l => (
              <button key={l} className={`chip press ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
                {l ? catName(l) : 'All'} <small>{(showGrave ? grave : alive).filter(c => !l || c.importance === l).length}</small>
              </button>
            ))}
          </div>
          {people.length
            ? <div className="stack">{people.map((c, i) => card(c, i))}</div>
            : <div className="empty-card">{showGrave
                ? (grave.length ? 'No match.' : 'The graveyard is empty. You keep in touch with everyone 🌱')
                : contacts.length ? 'No match.' : 'No people yet. Tap + to add someone.'}</div>}
        </>}

        {tab === 'events' && <>
          <h1 className="big">EVENTS</h1>

          {/* Only hosts get "Create a room" (set in card setup / Edit card). Everyone can still join rooms. */}
          {profile.hosts_events && (
            <section className="rooms-hero press" onClick={() => setModal({ kind: 'newRoom' })}>
              <span className="tag">✨ Event rooms</span>
              <h2>Hosting an<br />event?</h2>
              <p>Create a room with one QR. Guests scan it to join and see who's here while the event is on.</p>
              <span className="hero-btn"><Ic n="plus" s={18} /> Create a room</span>
              <i className="shape s1" /><i className="shape s2" />
            </section>
          )}

          {rooms.length > 0 && (
            <div className="room-list">
              {rooms.map((r, i) => {
                const st = roomStatus(r)
                return (
                  <button key={r.id} className={`room-card press ${st}`} style={{ animationDelay: `${i * 45}ms` }}
                    onClick={() => setModal({ kind: 'room', id: r.id })}>
                    <span className={`status ${st}`}>
                      {st === 'live' ? `● Live · ends in ${until(r.ends_at)}` : st === 'upcoming' ? `Opens in ${until(r.starts_at)}` : 'Ended'}
                    </span>
                    <b>{r.name}</b>
                    <span className="small">
                      {fmt(new Date(r.starts_at), { day: 'numeric', month: 'short' })} · {timeOf(r.starts_at)}–{timeOf(r.ends_at)}
                      {r.place && ` · ${r.place}`}
                    </span>
                    <span className="room-meta">
                      <span><Ic n="people" s={14} /> {r.member_count}</span>
                      {r.organizer_id === uid && <span className="host-tag">You host</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <h3 className="section-label">Your events</h3>
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
      {noteFor && <CallNote c={noteFor} onSave={(b, f, n) => saveNote(noteFor, b, f, n)} onClose={() => setNoteFor(undefined)} />}

      {m && (
        <div className="sheet" style={{ '--c': person ? catColor(person.importance) : m.kind === 'room' ? '#ffc145' : event || m.kind === 'me' ? '#a99bff' : 'var(--bg)' } as CSSProperties}>
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
                <button className="press" onClick={() => setModal({ kind: 'settings' })}><span className="circle"><Ic n="gear" /></span>Settings</button>
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
              <div className={`big-avatar ${inGrave(person) ? 'grave' : ''}`} style={{ boxShadow: `0 0 0 5px ${healthColor(person)}, 0 10px 30px rgba(0, 0, 0, .15)` }}>
                {selfie(person) ? <img src={selfie(person)} alt="" /> : person.name[0].toUpperCase()}
              </div>
              <h1 className="center">{person.name}</h1>
              {person.company && <p className="center headline">{person.company}</p>}
              <Places lives={person.current_city} from={person.hometown} />
              <div className="pills center-row">
                <span className="pill dark">{catName(person.importance)}</span>
                {(person.met_where || evName(person.event_id)) &&
                  <span className="pill"><Ic n="pin" s={14} /> {[person.met_where, evName(person.event_id)].filter(Boolean).join(' · ')}</span>}
              </div>
              <div className="pills center-row">
                {person.next_call_at
                  ? <span className="pill dark"><Ic n="calendar" s={13} /> Next call {fmt(new Date(person.next_call_at), { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  : <span className="pill">Every {person.contact_every_days}d</span>}
                <span className="pill">Last {ago(person.last_contacted_at)}d ago</span>
                <span className={`pill ${dueIn(person) <= 0 ? 'red' : ''}`}>{dueText(person)}</span>
              </div>
              {inGrave(person)
                ? <div className="grave-banner">
                    <b>🪦 In the graveyard</b>
                    <span>No contact for {monthsSince(person)} months. Call {person.name.split(' ')[0]} or tap Contacted to bring them back.</span>
                  </div>
                : <div className="health" aria-label={`Relationship health: ${healthLabel(person)}`}>
                    <div className="health-top"><span>Relationship health</span><b style={{ color: healthColor(person) }}>{healthLabel(person)}</b></div>
                    <div className="health-bar"><i style={{ left: `${health(person) * 100}%`, background: healthColor(person) }} /></div>
                  </div>}
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
              <div className="panel">
                <div className="hist-head">
                  <h4>What we talked about</h4>
                  <button className="chip press" onClick={() => setNoteFor(person)}><Ic n="plus" s={14} /> Add note</button>
                </div>
                {notes.filter(n => n.contact_id === person.id).map(n => (
                  <div className="hist-item" key={n.id}>
                    <div className="hist-meta">
                      <Ic n={n.kind === 'call' ? 'phone' : 'edit'} s={13} />
                      {fmt(new Date(n.created_at), { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                      {new Date(n.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      <button className="hist-del" onClick={() => deleteNote(n)} aria-label="Delete note"><Ic n="trash" s={13} /></button>
                    </div>
                    {n.format === 'points'
                      ? <ul className="points">{n.body.split('\n').map((l, i) => <li key={i}>{l}</li>)}</ul>
                      : <p className="pre">{n.body}</p>}
                  </div>
                ))}
                {!notes.some(n => n.contact_id === person.id) &&
                  <p className="muted small">No notes yet. After each call you'll be asked what you talked about.</p>}
              </div>
              {person.lat != null && <PeopleMap contacts={[person]} events={[]} />}

              <div className="quick">
                <button className="press" onClick={() => contacted(person)}><span className="circle"><Ic n="check" /></span>Contacted</button>
                {person.email && <a className="press" href={`mailto:${person.email}`}><span className="circle"><Ic n="mail" /></span>Email</a>}
                {person.phone && <a className="press" href={`https://wa.me/${waDigits(person.phone, MY_COUNTRY)}`} target="_blank" rel="noreferrer"><span className="circle"><Ic n="chat" /></span>WhatsApp</a>}
                <button className="press" onClick={async () => {
                  if (!confirm(`Delete ${person.name}?`)) return
                  await supabase.from('contacts').delete().eq('id', person.id)
                  setModal(null); load()
                }}><span className="circle"><Ic n="trash" /></span>Delete</button>
              </div>

              <div className="cta">
                {person.phone
                  ? <a className="btn-black press" href={`tel:${person.phone}`} onClick={() => startCall(person)}><Ic n="phone" s={18} /> Call {person.phone}</a>
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
                {event.room_id && rooms.some(r => r.id === event.room_id) && (
                  <button className="btn-ghost press room-link" onClick={() => setModal({ kind: 'room', id: event.room_id! })}>✨ Open event room</button>
                )}
                <button className="btn-black press" onClick={() => setModal({ kind: 'edit', eventId: event.id })}><Ic n="plus" s={18} /> Add person met here</button>
              </div>
            </div>
          )}

          {m.kind === 'edit' && (
            <PersonForm uid={uid} c={m.c} eventId={m.eventId} events={events} urls={urls}
              done={id => { load(); flash(m.c ? 'Saved ✓' : 'Person added ✓'); setModal(id ? { kind: 'person', id } : null) }} />
          )}

          {m.kind === 'newEvent' && <EventForm done={() => { load(); flash('Event created ✓'); setModal(null); setTab('events') }} />}

          {m.kind === 'settings' && (
            <Settings uid={uid} profile={profile} setProfile={setProfile} cats={cats} setCats={setCats} contacts={contacts}
              push={push} enableReminders={enableReminders} onContactsChanged={load} flash={flash} />
          )}

          {m.kind === 'newRoom' && (
            <RoomForm done={async id => { await load(); flash('🎉 Room created'); setModal({ kind: 'room', id }) }} />
          )}

          {m.kind === 'room' && (() => {
            const room = rooms.find(r => r.id === m.id)
            if (!room) return <div className="detail"><div className="empty-card">Room not found.</div></div>
            const myEvent = events.find(e => e.room_id === room.id)
            return (
              <RoomView room={room} uid={uid} contacts={contacts} metHere={myEvent ? contacts.filter(c => c.event_id === myEvent.id).length : 0}
                onOpen={open} onShowMyQr={() => setModal({ kind: 'me' })} onChanged={load} onDeleted={() => { setModal(null); load() }} flash={flash} />
            )
          })()}
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

// The coloured ring around the photo is relationship health: green → yellow → red, grey in the graveyard.
function Avatar({ c, url }: { c: Contact; url?: string }) {
  const ring = { boxShadow: `0 0 0 3px ${healthColor(c)}` }
  return url
    ? <img className="avatar" src={url} alt="" style={ring} title={healthLabel(c)} />
    : <div className="avatar" style={ring} title={healthLabel(c)}>{c.name.slice(0, 1).toUpperCase()}</div>
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
        <CircleMarker key={c.id} center={[c.lat!, c.lng!]} radius={9} pathOptions={{ color: '#111', weight: 2, fillColor: catColor(c.importance), fillOpacity: 1 }}>
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
    name: c?.name ?? '', phone: splitNumber(c?.phone, MY_COUNTRY).national, email: c?.email ?? '', company: c?.company ?? '', current_city: c?.current_city ?? '', hometown: c?.hometown ?? '', met_where: c?.met_where ?? '', help_note: c?.help_note ?? '',
    importance: c?.importance ?? 2, contact_every_days: c?.contact_every_days ?? 30, event_id: c?.event_id ?? eventId ?? '',
  })
  const [phoneCountry, setPhoneCountry] = useState(splitNumber(c?.phone, MY_COUNTRY).country)
  const [selfie, setSelfie] = useState<File>()
  const [card, setCard] = useState<File>()
  const [scan, setScan] = useState('')
  // Read the visiting card on the phone itself (no upload) and fill only the fields still empty.
  const scanCard = async (file?: File) => {
    setCard(file)
    if (!file) return
    setScan('Reading card…')
    try {
      const T = await import('tesseract.js')
      const { data } = await (T.default ?? T).recognize(file, 'eng', {
        logger: m => { if (m.status === 'recognizing text') setScan(`Reading card… ${Math.round(m.progress * 100)}%`) },
      })
      const info = parseCard(data.text)
      const found = (['name', 'phone', 'email', 'company'] as const).filter(k => info[k])
      // A scanned "+971…" switches the code picker; the box keeps just the local part.
      const scanned = info.phone ? splitNumber(info.phone, phoneCountry) : null
      if (scanned && !f.phone) setPhoneCountry(scanned.country)
      setF(p => ({
        ...p, name: p.name || info.name || '', phone: p.phone || scanned?.national || '',
        email: p.email || info.email || '', company: p.company || info.company || '',
      }))
      setScan(found.length
        ? `✓ Filled ${found.join(', ')} from the card. Please check before saving.`
        : "Couldn't read the card. Try a sharper photo in good light.")
    } catch {
      setScan("Couldn't read the card. Check your internet (first scan downloads the reader) and try again.")
    }
  }
  const [loc, setLoc] = useState(c?.lat != null ? { lat: c.lat, lng: c.lng! } : null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!c) here().then(setLoc) }, [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    setBusy(true)
    try {
      const ev = events.find(e => e.id === f.event_id)
      const row = {
        ...f, event_id: f.event_id || null, phone: fullNumber(phoneCountry, f.phone), email: nn(f.email), company: nn(f.company), current_city: nn(f.current_city), hometown: nn(f.hometown),
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
        <PhotoTile crop label="Selfie with them" icon="camera" capture="user" file={selfie} url={c?.selfie_path ? urls[c.selfie_path] : undefined} onFile={setSelfie} />
        <PhotoTile label="Visiting card" icon="card" capture="environment" file={card} url={c?.card_path ? urls[c.card_path] : undefined} onFile={scanCard} />
      </div>

      <label>Name *<input required value={f.name} onChange={set('name')} placeholder="Ravi Kumar" /></label>
      {scan && <p className={`scan-status ${scan.startsWith('✓') ? 'ok' : ''}`} role="status">{scan}</p>}
      <label>Mobile
        <span className="phone-field">
          <select className="dial" value={phoneCountry} onChange={e => setPhoneCountry(e.target.value)} aria-label="Country code">
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{flag(c.code)} +{c.dial} {c.name}</option>)}
          </select>
          <input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98765 43210" aria-label="Mobile number" />
        </span>
      </label>
      <div className="two">
        <label>Email<input type="email" value={f.email} onChange={set('email')} placeholder="ravi@solarco.in" /></label>
        <label>Company<input value={f.company} onChange={set('company')} placeholder="SolarCo" /></label>
      </div>
      <div className="two">
        <label>Lives in<input value={f.current_city} onChange={set('current_city')} placeholder="Pune" /></label>
        <label>Hometown<input value={f.hometown} onChange={set('hometown')} placeholder="Nagpur" /></label>
      </div>
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
          {catIds().map(l => (
            <button type="button" key={l} className={`chip press ${f.importance === l ? 'on' : ''}`}
              style={f.importance === l ? { background: catColor(l), color: '#111', borderColor: '#111' } : undefined}
              onClick={() => setF({ ...f, importance: l })}>{catName(l)}</button>
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

function PhotoTile({ label, icon, capture, file, url, onFile, crop }: {
  label: string; icon: string; capture: 'user' | 'environment'; file?: File; url?: string; onFile: (f?: File) => void; crop?: boolean
}) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : url), [file, url])
  const [raw, setRaw] = useState<File>() // picked but not cropped yet
  // `capture` forces the camera on phones, so the gallery gets its own input without it.
  const pick = (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) crop ? setRaw(f) : onFile(f)
  }
  return (
    <div className="tile">
      {raw && <Cropper file={raw} onCancel={() => setRaw(undefined)} onDone={f => { setRaw(undefined); onFile(f) }} />}
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

// ---------- Settings ----------

function Settings({ uid, profile, setProfile, cats, setCats, contacts, push, enableReminders, onContactsChanged, flash }: {
  uid: string; profile: Profile; setProfile: (p: Profile) => void; cats: Cat[]; setCats: (c: Cat[]) => void
  contacts: Contact[]; push: 'on' | 'off' | 'na'; enableReminders: () => void; onContactsChanged: () => void; flash: (t: string) => void
}) {
  const [names, setNames] = useState(cats.map(c => c.name)) // edited locally, saved on blur
  useEffect(() => setNames(cats.map(c => c.name)), [cats])
  const [colorFor, setColorFor] = useState<number>() // which row's colour picker is open
  const count = (i: number) => contacts.filter(c => c.importance === i + 1).length

  const saveCats = async (next: Cat[], msg?: string) => {
    const { error } = await supabase.from('user_settings').upsert({ id: uid, categories: next, updated_at: new Date().toISOString() })
    if (error) return alert(error.message)
    setCats(next)
    if (msg) flash(msg)
  }
  const rename = (i: number, typed: string) => { // read from the box itself, not possibly-stale state
    const name = typed.trim()
    if (!name) return setNames(cats.map(c => c.name)) // empty name: put the old one back
    if (name !== cats[i].name) saveCats(cats.map((c, j) => (j === i ? { ...c, name } : c)), 'Saved ✓')
  }
  const add = () => {
    const used = new Set(cats.map(c => c.color))
    saveCats([...cats, { name: `Category ${cats.length + 1}`, color: CAT_COLORS.find(c => !used.has(c)) ?? CAT_COLORS[0] }], 'Category added')
  }
  // Deleting moves its people to the category above (or the new first one), so nobody loses a category.
  const remove = async (i: number) => {
    const k = i + 1, n = count(i)
    const target = k > 1 ? cats[k - 2].name : cats[1].name
    if (!confirm(n ? `Delete "${cats[i].name}"? ${n} ${n === 1 ? 'person moves' : 'people move'} to "${target}".` : `Delete "${cats[i].name}"?`)) return
    if (k > 1) await supabase.from('contacts').update({ importance: k - 1 }).eq('importance', k)
    for (let j = k + 1; j <= cats.length; j++) await supabase.from('contacts').update({ importance: j - 1 }).eq('importance', j)
    await saveCats(cats.filter((_, j) => j !== i), 'Category deleted')
    onContactsChanged()
  }
  const setHosts = async (on: boolean) => {
    const { data, error } = await supabase.from('profiles').update({ hosts_events: on }).eq('id', uid).select().single()
    if (error) return alert(error.message)
    setProfile(data)
    flash(on ? 'Create a room is now in Events' : 'Create a room hidden')
  }

  return (
    <div className="detail settings">
      <h1 className="big">SETTINGS</h1>

      <h3 className="section-label">Events</h3>
      <label className={`host-toggle press ${profile.hosts_events ? 'on' : ''}`}>
        <input type="checkbox" checked={!!profile.hosts_events} onChange={e => setHosts(e.target.checked)} />
        <span className="tick" aria-hidden><Ic n="check" s={16} /></span>
        <span className="grow">
          <b>I host events</b>
          <span className="small">Shows "Create a room" in Events. You can always join other people's rooms either way.</span>
        </span>
      </label>

      <h3 className="section-label">Reminders</h3>
      <div className="setting-row">
        <span className="circle"><Ic n="bell" /></span>
        <span className="grow">
          <b>Daily call reminders</b>
          <span className="small muted">
            {push === 'on' ? 'On. Every morning at 9 AM you get who to call.'
              : push === 'na' ? "This browser can't show notifications."
              : pushNeedsInstall() ? 'On iPhone, add the app to your Home Screen first.'
              : Notification.permission === 'denied' ? 'Blocked. Allow notifications for this site in your settings.'
              : 'Off on this device.'}
          </span>
        </span>
        {push === 'on'
          ? <span className="rp-tag ok">On</span>
          : push === 'off' && !pushNeedsInstall() && Notification.permission !== 'denied' &&
            <button className="chip press on" onClick={enableReminders}>Turn on</button>}
      </div>

      <h3 className="section-label">Your categories</h3>
      <p className="muted small cat-intro">Name them however you like, up to {MAX_CATS}. The first one is the most important and gets called first.</p>
      <div className="cat-list">
        {cats.map((c, i) => (
          <div className="cat-row" key={i}>
            <span className="cat-rank">{i + 1}</span>
            <button className="cat-swatch press" style={{ background: c.color }} aria-label={`Colour for ${c.name}`}
              onClick={() => setColorFor(colorFor === i ? undefined : i)} />
            <input value={names[i] ?? ''} maxLength={20} aria-label={`Category ${i + 1} name`}
              onChange={e => setNames(ns => ns.map((n, j) => (j === i ? e.target.value : n)))}
              onBlur={e => rename(i, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            <span className="cat-count">{count(i)}</span>
            {cats.length > 1 && (
              <button className="circle white press" onClick={() => remove(i)} aria-label={`Delete ${c.name}`}><Ic n="trash" s={15} /></button>
            )}
            {colorFor === i && (
              <div className="cat-colors">
                {CAT_COLORS.map(col => (
                  <button key={col} className={`cat-swatch press ${col === c.color ? 'on' : ''}`} style={{ background: col }} aria-label={`Use colour ${col}`}
                    onClick={() => { setColorFor(undefined); saveCats(cats.map((x, j) => (j === i ? { ...x, color: col } : x)), 'Saved ✓') }} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {cats.length < MAX_CATS && (
        <button className="btn-ghost press add-cat" onClick={add}><Ic n="plus" s={18} /> Add category ({cats.length}/{MAX_CATS})</button>
      )}
      <div style={{ height: 32 }} />
    </div>
  )
}

// ---------- Event rooms ----------

// Guests can't read each other's membership rows, so a room shares changes as a content-free
// "something changed" ping on its own channel; everyone in the room then re-asks the server.
const pingRoom = (id: string) => {
  const ch = supabase.channel(`room:${id}`)
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'ping', payload: {} }).finally(() => supabase.removeChannel(ch))
  })
}

function RoomForm({ done }: { done: (id: string) => void }) {
  const nextHour = new Date(); nextHour.setMinutes(0, 0, 0); nextHour.setHours(nextHour.getHours() + 1)
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const [f, setF] = useState({
    name: '', place: '', description: '', date: isoDay(nextHour),
    start: hhmm(nextHour), end: hhmm(new Date(+nextHour + 3 * 36e5)),
  })
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { here().then(setLoc) }, [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const starts = new Date(`${f.date}T${f.start}`)
  let ends = new Date(`${f.date}T${f.end}`)
  if (ends <= starts) ends = new Date(+ends + DAY) // ends after midnight
  const hours = Math.round((+ends - +starts) / 36e5 * 10) / 10

  const save = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.from('rooms').insert({
        name: f.name.trim(), place: nn(f.place), description: nn(f.description),
        starts_at: starts.toISOString(), ends_at: ends.toISOString(), lat: loc?.lat ?? null, lng: loc?.lng ?? null,
      }).select().single()
      if (error) throw error
      const j = await supabase.rpc('join_room', { rid: data.id }) // the host is a member too
      if (j.error) throw j.error
      done(data.id)
    } catch (e) { alert((e as Error).message); setBusy(false) }
  }

  return (
    <form className="detail" onSubmit={e => { e.preventDefault(); save() }}>
      <h1 className="big">CREATE A<br />ROOM</h1>
      <p className="muted intro">Guests scan one QR to join. While the room is open they see who's here, and connect by scanning each other's cards.</p>
      <label>Event name *<input required value={f.name} onChange={set('name')} placeholder="Startup Summit 2026" /></label>
      <label>Place<input value={f.place} onChange={set('place')} placeholder="Bengaluru Palace, Hall B" /></label>
      <label>Date<input type="date" required value={f.date} onChange={set('date')} /></label>
      <div className="two">
        <label>Room opens<input type="time" required value={f.start} onChange={set('start')} /></label>
        <label>Room closes<input type="time" required value={f.end} onChange={set('end')} /></label>
      </div>
      <p className="muted small window-hint">
        <Ic n="clock" s={14} /> Guests can see each other for {hours} hours, {fmt(starts, { weekday: 'short', day: 'numeric', month: 'short' })} {timeOf(starts.toISOString())} – {timeOf(ends.toISOString())}
      </p>
      <label>About the event<textarea rows={3} value={f.description} onChange={set('description')} placeholder="Founders, investors and builders. Say hi to 3 new people!" /></label>
      <div className="cta"><button className="btn-black press" disabled={busy}>{busy ? 'Creating…' : 'Create room & get QR'}</button></div>
    </form>
  )
}

function RoomView({ room, uid, contacts, metHere, onOpen, onShowMyQr, onChanged, onDeleted, flash }: {
  room: Room; uid: string; contacts: Contact[]; metHere: number
  onOpen: (contactId: string) => void; onShowMyQr: () => void; onChanged: () => void; onDeleted: () => void; flash: (t: string) => void
}) {
  const [people, setPeople] = useState<RoomPerson[]>()
  const [, tick] = useState(0)
  const host = room.organizer_id === uid
  const st = roomStatus(room)
  // Live: re-ask who's here whenever someone in the room pings (join, host opens/extends/ends).
  // The 20s timer keeps countdowns ticking and opens/closes the room on time, ping or not.
  const roomCh = useRef<ReturnType<typeof supabase.channel>>()
  useEffect(() => {
    const get = () => supabase.rpc('room_people', { rid: room.id }).then(({ data }) => setPeople((data as RoomPerson[] | null) ?? []))
    get()
    const ch = supabase.channel(`room:${room.id}`)
    ch.on('broadcast', { event: 'ping' }, () => { get(); onChanged() }).subscribe()
    roomCh.current = ch
    const t = setInterval(() => { tick(n => n + 1); if (roomStatus(room) === 'live' || host) get() }, 20000)
    return () => { clearInterval(t); supabase.removeChannel(ch) }
  }, [room.id, room.starts_at, room.ends_at])

  const setTimes = async (patch: { starts_at?: string; ends_at?: string }, msg: string) => {
    const { error } = await supabase.from('rooms').update(patch).eq('id', room.id)
    if (error) return alert(error.message)
    roomCh.current?.send({ type: 'broadcast', event: 'ping', payload: {} }) // guests see the new times now
    flash(msg); onChanged()
  }
  const share = async () => {
    const url = roomUrl(room.id)
    try {
      if (navigator.share) await navigator.share({ title: room.name, text: `Join ${room.name} on Connections`, url })
      else { await navigator.clipboard.writeText(url); flash('Room link copied ✓') }
    } catch { /* share sheet closed */ }
  }
  const contactFor = (p: RoomPerson) => contacts.find(c => c.profile_id === p.user_id)
  const others = people ?? []

  return (
    <div className="detail room">
      <span className={`status big-status ${st}`}>
        {st === 'live' ? `● Live now · closes in ${until(room.ends_at)}` : st === 'upcoming' ? `Opens in ${until(room.starts_at)}` : 'This room has ended'}
      </span>
      <h1 className="big">{room.name}</h1>
      <div className="pills">
        <span className="pill dark"><Ic n="clock" s={13} /> {fmt(new Date(room.starts_at), { weekday: 'short', day: 'numeric', month: 'short' })} · {timeOf(room.starts_at)}–{timeOf(room.ends_at)}</span>
        {room.place && <span className="pill"><Ic n="pin" s={13} /> {room.place}</span>}
        <span className="pill"><Ic n="people" s={13} /> {room.member_count} joined</span>
        {!host && room.organizer_name && <span className="pill">Host: {room.organizer_name}</span>}
      </div>
      {room.description && <div className="panel"><p className="pre">{room.description}</p></div>}

      {host && st !== 'ended' && (
        <div className="qr-box room-qr">
          <QR text={roomUrl(room.id)} />
          <b>Scan to join {room.name}</b>
          <span className="muted small">Show this on a screen or print it at the entrance.</span>
        </div>
      )}
      <div className="quick">
        {st !== 'ended' && <button className="press" onClick={share}><span className="circle"><Ic n="share" /></span>Invite</button>}
        {st === 'live' && <button className="press" onClick={onShowMyQr}><span className="circle"><Ic n="qr" /></span>My QR</button>}
        {host && st === 'upcoming' && <button className="press" onClick={() => setTimes({ starts_at: new Date().toISOString() }, 'Room is open 🎉')}><span className="circle"><Ic n="play" /></span>Open now</button>}
        {host && st === 'live' && <button className="press" onClick={() => setTimes({ ends_at: new Date(+new Date(room.ends_at) + 36e5).toISOString() }, '+1 hour ✓')}><span className="circle"><Ic n="clock" /></span>+1 hour</button>}
        {host && st !== 'ended' && <button className="press" onClick={() => confirm('Close the room now? Guests will stop seeing each other.') && setTimes(st === 'upcoming' // closing before it opened: the end must still come after the start
            ? { starts_at: new Date(Date.now() - 6e4).toISOString(), ends_at: new Date().toISOString() }
            : { ends_at: new Date().toISOString() }, 'Room closed')}><span className="circle"><Ic n="stop" /></span>End now</button>}
        {host && <button className="press" onClick={async () => {
          if (!confirm(`Delete ${room.name}? Guests keep the people they connected with.`)) return
          await supabase.from('rooms').delete().eq('id', room.id); onDeleted()
        }}><span className="circle"><Ic n="trash" /></span>Delete</button>}
      </div>

      {st === 'upcoming' && !host && (
        <div className="empty-card">
          <b>The room opens in {until(room.starts_at)}</b><br />
          {room.member_count} {room.member_count === 1 ? 'person has' : 'people have'} joined. You'll see everyone here once it opens.
        </div>
      )}

      {st === 'ended' && (
        <div className="empty-card">
          <b>The room has closed</b><br />
          You connected with {metHere} {metHere === 1 ? 'person' : 'people'} here. Find them under this event in your Events tab.
        </div>
      )}

      {(st === 'live' || (host && st === 'upcoming')) && (
        <>
          <div className="section-title">
            <h3>{st === 'live' ? "Who's here" : 'Joined so far'}</h3>
            <span className="muted small">{others.length} {others.length === 1 ? 'person' : 'people'}</span>
          </div>
          {st === 'live' && (
            <p className="muted small room-tip">Only photo, name and headline are shown. Scan each other's QR to swap full details.</p>
          )}
          {people === undefined
            ? <div className="empty-card">Loading…</div>
            : others.length === 0
              ? <div className="empty-card">Nobody else yet. Share the QR to get people in.</div>
              : <div className="room-people">
                  {others.map((p, i) => {
                    const c = contactFor(p)
                    return (
                      <button key={p.user_id} className={`room-person press ${c ? 'connected' : ''}`} style={{ animationDelay: `${i * 40}ms` }}
                        onClick={() => c ? onOpen(c.id) : flash(`Ask ${p.name.split(' ')[0]} to show their QR, then scan it to connect`)}>
                        <span className="rp-photo">{p.photo_path ? <img src={pub(p.photo_path)} alt="" /> : p.name[0]?.toUpperCase()}</span>
                        <b>{p.name}</b>
                        {p.headline && <span className="small">{p.headline}</span>}
                        {p.city && <span className="small muted">📍 {p.city}</span>}
                        <span className={`rp-tag ${c ? 'ok' : ''}`}>{c ? '✓ Connected' : p.is_organizer ? 'Host' : 'Scan to connect'}</span>
                      </button>
                    )
                  })}
                </div>}
        </>
      )}
    </div>
  )
}

// What someone sees after scanning a room QR: the event, not the guest list.
function RoomJoin({ rid }: { rid: string }) {
  const [r, setR] = useState<Room | null>()
  useEffect(() => { supabase.rpc('get_room', { rid }).then(({ data }) => setR((data as Room[] | null)?.[0] ?? null)) }, [rid])
  if (r === undefined) return null
  if (!r) return <div className="app"><div className="empty-card">This room doesn't exist anymore.</div></div>
  const st = roomStatus(r)
  return (
    <div className="sheet" style={{ '--c': '#ffc145' } as CSSProperties}>
      <div className="detail public room">
        <span className="tag">✨ Event room</span>
        <span className={`status big-status ${st}`}>
          {st === 'live' ? `● Live now · closes in ${until(r.ends_at)}` : st === 'upcoming' ? `Opens in ${until(r.starts_at)}` : 'This room has ended'}
        </span>
        <h1 className="big">{r.name}</h1>
        <div className="pills">
          <span className="pill dark"><Ic n="clock" s={13} /> {fmt(new Date(r.starts_at), { weekday: 'short', day: 'numeric', month: 'short' })} · {timeOf(r.starts_at)}–{timeOf(r.ends_at)}</span>
          {r.place && <span className="pill"><Ic n="pin" s={13} /> {r.place}</span>}
          {r.organizer_name && <span className="pill">Host: {r.organizer_name}</span>}
        </div>
        {r.description && <div className="panel"><p className="pre">{r.description}</p></div>}
        <div className="join-count">
          <b>{r.member_count}</b>
          <span>{r.member_count === 1 ? 'person has' : 'people have'} joined</span>
        </div>
        <ul className="join-how">
          <li>See who's at the event while the room is open</li>
          <li>Scan each other's QR to swap full details</li>
          <li>Everyone you meet is saved under this event</li>
        </ul>
        <div className="cta">
          {st === 'ended'
            ? <a className="btn-ghost press" href="/">The room has closed · open the app</a>
            : <button className="btn-black press" onClick={() => { localStorage.setItem(PENDING_ROOM, rid); location.href = '/' }}>
                <Ic n="plus" s={18} /> Join the room
              </button>}
        </div>
        <p className="muted small center made">Made with Connections · only for people you actually meet</p>
      </div>
    </div>
  )
}

// "How did the call go?" Write it as a note or as bullet points, switch any time, or speak it.
const toPoints = (t: string) => t.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inDays = (n: number) => isoDay(new Date(Date.now() + n * DAY))
function CallNote({ c, onSave, onClose }: {
  c: Contact; onSave: (body: string, format: 'note' | 'points', next: Date) => void; onClose: () => void
}) {
  // Starts at the date you already set for them (if still ahead), otherwise their usual gap.
  const [next, setNext] = useState(c.next_call_at && dueIn(c) > 0 ? isoDay(new Date(c.next_call_at)) : inDays(c.contact_every_days))
  const [format, setFormat] = useState<'note' | 'points'>('note')
  const [text, setText] = useState('')
  const [points, setPoints] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const focusPoint = (i: number) => setTimeout(() => refs.current[i]?.focus(), 0)
  const body = format === 'note' ? text.trim() : points.map(p => p.trim()).filter(Boolean).join('\n')

  const switchTo = (f: 'note' | 'points') => {
    if (f === format) return
    if (f === 'points') setPoints(toPoints(text).length ? toPoints(text) : [''])
    else setText(points.map(p => p.trim()).filter(Boolean).join('\n'))
    setFormat(f)
  }
  const setPoint = (i: number, v: string) => setPoints(ps => ps.map((p, j) => (j === i ? v : p)))

  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <div className="bottom-sheet note-sheet" role="dialog" aria-modal="true" aria-labelledby="note-title" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <h3 id="note-title">How did the call with {c.name.split(' ')[0]} go?</h3>
        <p className="muted small">Write what you talked about so you remember next time.</p>

        <div className="seg" role="tablist">
          {(['note', 'points'] as const).map(f => (
            <button key={f} role="tab" aria-selected={format === f} className={format === f ? 'on' : ''} onClick={() => switchTo(f)}>
              {f === 'note' ? 'Note' : '• Points'}
            </button>
          ))}
        </div>

        {format === 'note'
          ? <textarea autoFocus rows={5} value={text} onChange={e => setText(e.target.value)}
              placeholder="Talked about his Dubai expansion, wants an intro to an investor next month…" />
          : <div className="point-list">
              {points.map((p, i) => (
                <div className="point" key={i}>
                  <span aria-hidden>•</span>
                  <input ref={el => { refs.current[i] = el }} value={p} autoFocus={i === points.length - 1} placeholder={i ? 'Next point' : 'First point'}
                    onChange={e => setPoint(i, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); setPoints(ps => [...ps.slice(0, i + 1), '', ...ps.slice(i + 1)]); focusPoint(i + 1) }
                      if (e.key === 'Backspace' && !p && points.length > 1) { e.preventDefault(); setPoints(ps => ps.filter((_, j) => j !== i)); focusPoint(i - 1) }
                    }} />
                </div>
              ))}
              <button className="chip press add-point" onClick={() => { setPoints(ps => [...ps, '']); focusPoint(points.length) }}>
                <Ic n="plus" s={14} /> Add point
              </button>
            </div>}

        <MicButton hint='Say what you talked about' onText={t => format === 'note'
          ? setText(p => (p ? `${p} ${t}` : t))
          : setPoints(ps => [...ps.filter(Boolean), ...toPoints(t)])} />

        <div className="next-call">
          <div className="next-head">
            <b><Ic n="calendar" s={16} /> When to call next?</b>
            <span className="muted small">{fmt(new Date(`${next}T09:00`), { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </div>
          <input type="date" className="next-date" value={next} min={inDays(1)} aria-label="Date of the next call"
            onChange={e => e.target.value && setNext(e.target.value)} />
        </div>

        <div className="two">
          <button className="btn-ghost press" onClick={onClose}>Skip</button>
          <button className="btn-black press" disabled={busy}
            onClick={() => { setBusy(true); onSave(body, format, new Date(`${next}T09:00`)) }}>
            {body ? 'Save' : 'Just schedule'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Square crop with a circle guide, so you see exactly how the photo sits in round avatars.
// Drag to move; pinch, mouse wheel or the slider to zoom. Outputs an 800x800 JPEG.
const VIEW = 280
const MAX_ZOOM = 4
function Cropper({ file, onDone, onCancel }: { file: File; onDone: (f: File) => void; onCancel: () => void }) {
  const src = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(src), [src])
  const [img, setImg] = useState<HTMLImageElement>()
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 }) // image centre offset from frame centre, in screen px
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1 // zoom 1 = image just covers the frame
  const fit = (p: { x: number; y: number }, z: number) => { // never let a gap show inside the frame
    if (!img) return p
    const mx = (img.naturalWidth * base * z - VIEW) / 2, my = (img.naturalHeight * base * z - VIEW) / 2
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) }
  }
  const zoomTo = (z: number) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z))
    setZoom(nz)
    setPos(p => fit(p, nz))
  }
  const dist = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }

  const save = async () => {
    if (!img) return
    const s = base * zoom, size = VIEW / s, OUT = 800
    const sx = img.naturalWidth / 2 - pos.x / s - size / 2, sy = img.naturalHeight / 2 - pos.y / s - size / 2
    const cv = document.createElement('canvas')
    cv.width = cv.height = OUT
    cv.getContext('2d')!.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT)
    const blob = await new Promise<Blob>(r => cv.toBlob(b => r(b!), 'image/jpeg', 0.9))
    onDone(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
  }

  return createPortal(
    <div className="backdrop crop-backdrop">
      <div className="bottom-sheet crop-sheet" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <h3 id="crop-title">Adjust your photo</h3>
        <p className="muted small">Drag to move · pinch or slide to zoom</p>
        <div className="crop-view" style={{ width: VIEW, height: VIEW }}
          onPointerDown={e => {
            pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* keep dragging without capture */ }
          }}
          onPointerMove={e => {
            const prev = pts.current.get(e.pointerId)
            if (!prev) return
            pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (pts.current.size === 1) setPos(p => fit({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }, zoom))
            else if (pts.current.size === 2) {
              pinch.current ??= { d: dist(), z: zoom }
              zoomTo(pinch.current.z * dist() / pinch.current.d)
            }
          }}
          onPointerUp={e => { pts.current.delete(e.pointerId); pinch.current = null }}
          onPointerCancel={e => { pts.current.delete(e.pointerId); pinch.current = null }}
          onWheel={e => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
          <img src={src} alt="" draggable={false} onLoad={e => setImg(e.currentTarget)}
            style={img ? {
              width: img.naturalWidth * base * zoom, height: img.naturalHeight * base * zoom,
              transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
            } : { opacity: 0 }} />
          <div className="crop-ring" />
        </div>
        <input type="range" className="crop-zoom" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
          onChange={e => zoomTo(+e.target.value)} aria-label="Zoom" />
        <div className="two">
          <button type="button" className="btn-ghost press" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-black press" onClick={save} disabled={!img}>Use photo</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Browser speech-to-text (Chrome, Edge, Safari). Hidden where unsupported, e.g. Firefox.
const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

function MicButton({ onText, hint = '"Met Ravi, does solar panels, wants investors"' }: { onText: (t: string) => void; hint?: string }) {
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
        <small>{on ? 'Speak now, release when done' : hint}</small>
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
