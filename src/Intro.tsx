import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Av } from './faces'
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

// ---- screen 2: scan, speak, save ----
function Stage2() {
  const chips: [string, string, string?][] = [
    ['👤', 'Ravi Kumar', '1.5'], ['🏢', 'SolarCo', '1.9'], ['📞', '+91 98765 43210', '2.3'],
    ['🎤', '“wants investors”', '2.8'], ['📍', 'Startup Summit', '3.2'],
  ]
  return (
    <div className="stage-in st2">
      <div className="bizcard">
        <i className="brk tl" /><i className="brk tr" /><i className="brk bl" /><i className="brk br" />
        <span className="bc-logo"><i /><i /></span>
        <b className="bc-name">RAVI KUMAR</b>
        <span className="bc-role">Founder &amp; CEO</span>
        <b className="bc-co">SolarCo Technologies</b>
        <span className="bc-line">+91 98765 43210</span>
        <span className="bc-line">ravi@solarco.in</span>
        <i className="beam" />
      </div>
      <span className="selfie"><Av i={0} /><em>📷</em></span>
      <div className="fields">
        {chips.map(([ic, t, d], k) => (
          <span key={t} className={`fchip c${k}`} style={{ '--d': `${d}s` } as CSSProperties}>
            {ic} {t}{k < 3 && <i className="ok">✓</i>}
          </span>
        ))}
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
    h: <>Save anyone in<br /><mark>10 seconds.</mark></>,
    p: 'Scan their card, say a quick note, snap a selfie. Name, number and where you met, saved before they walk away.',
  },
  {
    stage: <Stage3 />,
    h: <>Be the one who<br /><mark>always calls back.</mark></>,
    p: 'Health rings show who’s fading. A 9 AM nudge tells you who to call. Turn every handshake into a lifelong connection.',
  },
]

export default function Intro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const x0 = useRef<number | null>(null)
  const last = SLIDES.length - 1
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)))
  const next = () => (i === last ? onDone() : go(i + 1))

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
          <button className="skip" style={{ visibility: i < last ? 'visible' : 'hidden' }} onClick={onDone}>Skip</button>
        </header>

        <div className="viewport">
          <div className="track" style={{ transform: `translateX(${-i * 100}%)` }}>
            {SLIDES.map((s, k) => (
              <section key={k} className={`slide ${k === i ? 'on' : ''}`} aria-hidden={k !== i} aria-label={`${k + 1} of ${SLIDES.length}`}>
                <div className="stage">{s.stage}</div>
                <h1>{s.h}</h1>
                <p>{s.p}</p>
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
