import { cloneElement, Fragment, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Av } from './faces'
import { backward, beep, ding, forward, notify, pop, setSoundMuted, stopSound, success, swoosh, unlockSound } from './sound'
import './intro.css'

// Three story screens shown once, before sign-in. Everything is SVG + CSS (no images, no libraries).


type NodeProps = { i: number; x: number; y: number; s?: number; d?: number; cls?: string; ring?: string; children?: ReactNode }
const Node = ({ i, x, y, s = 52, d = 0, cls = '', ring, children }: NodeProps) => (
  <span className={`node ${cls}`} style={{ '--x': `${x}px`, '--y': `${y}px`, '--s': `${s}px`, '--d': `${d}s`, ...(ring ? { '--ring': ring } : {}) } as CSSProperties}>
    <Av i={i} />{children}
  </span>
)

// ---- screen 1: faces fade ----
function Stage1() {
  return (
    <div className="stage-in st1">
      <i className="ring r1" /><i className="ring r2" />
      <Node i={0} x={0} y={0} s={76} d={0} cls="mine" />
      <Node i={1} x={86} y={31} d={0.3} />
      <Node i={2} x={-70} y={59} d={0.4} cls="forget" />
      <Node i={3} x={-16} y={-91} d={0.5} />
      <Node i={4} x={126} y={72} d={0.6} cls="forget f2" />
      <Node i={5} x={-72} y={126} d={0.7} />
      <Node i={6} x={-126} y={-72} d={0.8} cls="forget f3" />
      <Node i={7} x={72} y={-126} d={0.9} />
      <span className="say a" style={{ '--d': '1.1s' } as CSSProperties}>“Let’s stay in touch!” 🤝</span>
      <span className="say b" style={{ '--d': '2.6s' } as CSSProperties}>…wait, who was that? 🤔</span>
    </div>
  )
}

// ---- screen 2: meet in person, scan one QR, get everything ----
// A believable-looking (fake) QR: 17x17 cells, the three corner finders, room in the middle for the logo.
const QN = 17
const QR_CELLS: boolean[] = (() => {
  const c: boolean[] = Array(QN * QN).fill(false)
  let seed = 7
  for (let i = 0; i < c.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; c[i] = seed / 0x7fffffff > 0.52 }
  const finder = (ox: number, oy: number) => {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
      const gx = ox + x, gy = oy + y
      if (gx < 0 || gy < 0 || gx >= QN || gy >= QN) continue
      const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6
      c[gy * QN + gx] = inside && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4))
    }
  }
  finder(0, 0); finder(QN - 7, 0); finder(0, QN - 7)
  for (let y = 6; y <= 10; y++) for (let x = 6; x <= 10; x++) c[y * QN + x] = false
  return c
})()

const Stage2Pill = ({ d, children }: { d: number; children: ReactNode }) => (
  <span className="ipill" style={{ '--d': `${d}s` } as CSSProperties}>{children}</span>
)

function Stage2() {
  return (
    <div className="stage-in st2">
      <div className="qrcard">
        <div className="qrbox">
          <svg className="qr" viewBox={`0 0 ${QN} ${QN}`} shapeRendering="crispEdges" aria-hidden>
            {QR_CELLS.map((on, i) => on && <rect key={i} x={i % QN} y={Math.floor(i / QN)} width="1" height="1" />)}
          </svg>
          <span className="qr-logo"><i /><i /></span>
          <i className="brk tl" /><i className="brk tr" /><i className="brk bl" /><i className="brk br" />
          <i className="beam" />
        </div>
        <b>Priya Shah</b>
        <small>Scan to connect</small>
      </div>

      <div className="scan-state"><span className="ss a">📷 Scanning…</span><span className="ss b">✓ Connected</span></div>
      <span className="meet">🤝 Met in person</span>

      <div className="conn-info">
        <div className="ci-head">
          <span className="ci-av"><Av i={1} /></span>
          <span className="grow"><b>Priya Shah <em>✓</em></b><small>Founder · GreenLoop</small></span>
          <span className="lks">
            <i className="lk in">in</i>
            <i className="lk ig"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="3" y="3" width="18" height="18" rx="5.5" /><circle cx="12" cy="12" r="4" /></svg></i>
            <i className="lk web">🌐</i>
          </span>
        </div>
        <div className="ci-pills">
          <Stage2Pill d={2.5}>📞 +91 98123 45678</Stage2Pill>
          <Stage2Pill d={2.65}>📍 Pune</Stage2Pill>
          <Stage2Pill d={2.8}>✉️ priya@greenloop.in</Stage2Pill>
          <Stage2Pill d={2.95}>💡 Helps with fundraising</Stage2Pill>
        </div>
      </div>
    </div>
  )
}

// ---- screen 3: stay close ----
const GREEN = '#22c55e', RED = '#ef4444', GREY = '#8b8b8b'
const NET: { i: number; x: number; y: number; ring: string; d: number; cls?: string; tag?: string; tagColor?: string }[] = [
  { i: 3, x: -100, y: -95, ring: GREEN, d: 0.3, tag: 'Strong', tagColor: GREEN },
  { i: 5, x: 105, y: -100, ring: GREEN, d: 0.45 },
  { i: 1, x: 118, y: 18, ring: GREEN, d: 0.6, cls: 'cool' },
  { i: 2, x: 45, y: 66, ring: RED, d: 0.75, tag: 'Cold · 45d', tagColor: RED },
  { i: 6, x: -108, y: 50, ring: GREY, d: 0.9, cls: 'grave' },
]
function Stage3() {
  return (
    <div className="stage-in st3">
      <svg className="net" viewBox="0 0 320 340" aria-hidden>
        {NET.map(n => (
          <line key={n.i} x1="160" y1="170" x2={160 + n.x} y2={170 + n.y} pathLength="1" stroke={n.ring}
            strokeDasharray={n.cls === 'grave' ? undefined : 1} className={n.cls === 'grave' ? 'dash' : ''} style={{ '--d': `${n.d}s` } as CSSProperties} />
        ))}
      </svg>
      <Node i={0} x={0} y={0} s={70} d={0} cls="mine" />
      {NET.map(n => (
        <Node key={n.i} i={n.i} x={n.x} y={n.y} s={50} d={n.d + 0.2} ring={n.ring} cls={n.cls}>
          {n.tag && <small className="nt" style={{ '--c': n.tagColor } as CSSProperties}>{n.tag}</small>}
          {n.cls === 'grave' && <small className="grave-badge">🪦</small>}
        </Node>
      ))}
      <div className="notif">
        <span className="bell">🔔</span>
        <span className="grow"><b>Time to call Priya</b><small>Your 9 AM nudge · 45 days</small></span>
        <span className="callbtn">Call</span>
      </div>
    </div>
  )
}

const SLIDES: { stage: ReactNode; h: ReactNode; p: string }[] = [
  {
    stage: <Stage1 />,
    h: <>You meet hundreds.<br /><mark>You remember a few.</mark></>,
    p: 'Every “let’s stay in touch” fades within a week. The one person who could change your year? Forgotten.',
  },
  {
    stage: <Stage2 />,
    h: <>Met them in person?<br /><mark>Just scan.</mark></>,
    p: 'One scan and their number, links and what they do land in your phone. No typing, no “what’s your number?”. Only people you’ve really met, never strangers.',
  },
  {
    stage: <Stage3 />,
    h: <>Be the one who<br /><mark>always calls back.</mark></>,
    p: 'Health rings show who’s fading. A 9 AM nudge tells you who to call. Turn every handshake into a lifelong connection.',
  },
]

// Wraps every word in a clipped span so it can slide up out of a mask; --i staggers the words.
function words(node: ReactNode, c: { n: number }, cls: string): ReactNode {
  if (typeof node === 'string') {
    return node.split(/(\s+)/).map((part, k) =>
      part === '' || /^\s+$/.test(part) ? part : <span key={k} className={cls}><span style={{ '--i': c.n++ } as CSSProperties}>{part}</span></span>)
  }
  if (Array.isArray(node)) return node.map((n, k) => <Fragment key={k}>{words(n, c, cls)}</Fragment>)
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>
    return el.type === 'br' ? el : cloneElement(el, undefined, words(el.props.children, c, cls))
  }
  return node
}

// Little sound moments that match what happens on each screen (ms after the screen appears).
const MOMENTS: [number, () => void][][] = [
  [[1100, () => pop(560)], [2600, () => pop(420)]],
  [[800, () => beep(700)], [1250, () => beep(1000)], [1700, () => beep(1400)], [2100, success], [2300, () => pop(640)]],
  [[2300, notify]],
]

export default function Intro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const x0 = useRef<number | null>(null)
  const last = SLIDES.length - 1
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)))
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('intro-sound') !== '0' } catch { return true } })
  const prev = useRef(0)
  // leaving the intro: music fades out, a happy chime if they finished it
  const leave = (finished: boolean) => { if (finished) success(); stopSound(finished ? 1.4 : 0.5); onDone() }
  const next = () => (i === last ? leave(true) : go(i + 1))

  // Browsers allow audio only after a tap/keypress: the first one starts the music.
  useEffect(() => {
    setSoundMuted(!sound)
    const unlock = () => unlockSound()
    addEventListener('pointerdown', unlock, { capture: true, once: true })
    addEventListener('keydown', unlock, { capture: true, once: true })
    return () => {
      removeEventListener('pointerdown', unlock, { capture: true })
      removeEventListener('keydown', unlock, { capture: true })
      stopSound(0.4)
    }
  }, [])
  useEffect(() => { setSoundMuted(!sound); try { localStorage.setItem('intro-sound', sound ? '1' : '0') } catch { /* private mode */ } }, [sound])

  // a whoosh + chime on every screen change, and the per-screen sound moments
  useEffect(() => {
    if (prev.current !== i) { const dir = i > prev.current ? 1 : -1; swoosh(dir); (dir > 0 ? forward : backward)() }
    prev.current = i
    const timers = MOMENTS[i].map(([ms, fn]) => window.setTimeout(fn, ms))
    return () => timers.forEach(clearTimeout)
  }, [i])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') go(i - 1) }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })

  return (
    <div className="intro" data-s={i}
      onPointerDown={e => { x0.current = e.clientX }}
      onPointerUp={e => {
        if (x0.current == null) return
        const dx = e.clientX - x0.current
        x0.current = null
        if (dx < -50) go(i + 1); else if (dx > 50) go(i - 1)
      }}
      onPointerCancel={() => { x0.current = null }}>
      <div className="intro-bg"><i /><i /><i /></div>
      {[ ['12%', '14%', 0 ], ['86%', '9%', 1.2 ], ['8%', '42%', 2.1 ], ['92%', '38%', 0.6 ], ['80%', '58%', 1.7 ]].map(([l, t, d], k) => (
        <i key={k} className="spark" style={{ left: l, top: t, animationDelay: `${d}s` }} />
      ))}

      <div className="intro-in">
        <header>
          <button className="ib back" aria-label="Back" style={{ visibility: i ? 'visible' : 'hidden' }} onClick={() => go(i - 1)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="bars" role="progressbar" aria-valuemin={1} aria-valuemax={SLIDES.length} aria-valuenow={i + 1}>
            {SLIDES.map((_, k) => <i key={k} className={k <= i ? 'on' : ''}><b /></i>)}
          </div>
          <button className={`ib snd ${sound ? '' : 'off'}`} aria-label={sound ? 'Turn sound off' : 'Turn sound on'} aria-pressed={sound}
            onClick={() => { setSound(v => !v); unlockSound() }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10v4h4l5 4V6L8 10z" />
              {sound ? <path d="M16.500 9a4 4 0 0 1 0 6M19 6.500a8 8 0 0 1 0 11" /> : <path d="M17 9l5 6M22 9l-5 6" />}
            </svg>
          </button>
          <button className="skip" style={{ visibility: i < last ? 'visible' : 'hidden' }} onClick={() => leave(false)}>Skip</button>
        </header>

        <div className="viewport">
          <div className="track" style={{ transform: `translateX(${-i * 100}%)` }}>
            {SLIDES.map((s, k) => (
              <section key={k} className={`slide ${k === i ? 'on' : ''}`} aria-hidden={k !== i} aria-label={`${k + 1} of ${SLIDES.length}`}>
                <div className="stage">{s.stage}</div>
                <h1>{words(s.h, { n: 0 }, 'w')}</h1>
                <p>{words(s.p, { n: 0 }, 'w pw')}</p>
              </section>
            ))}
          </div>
        </div>

        <button className={`go press ${i === last ? 'pulse' : ''}`} onClick={next}>
          {i === last ? 'Get started' : 'Next'}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  )
}
