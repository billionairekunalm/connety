// Sounds for the intro screens, synthesised with the Web Audio API: no audio files to download.
// The background music is a slow ambient loop kept at a very low level; effects sit just above it.
// Browsers only allow audio after a tap/keypress, so nothing is created until unlockSound() is called from one.
let ctx: AudioContext | null = null
let master!: GainNode, musicBus!: GainNode, sfxBus!: GainNode, bellBus!: GainNode, echo!: DelayNode
let noise: AudioBuffer | null = null
let muted = false
let started = false
let timer: number | undefined
let nextBar = 0
let barNo = 0
let watching = false

const BAR = 4 // seconds per chord
const MUSIC_LEVEL = 0.05 // very quiet on purpose
const SFX_LEVEL = 0.2

// C maj7 -> A min7 -> F maj7 -> G6: warm and unobtrusive
const CHORDS = [
  { bass: 130.81, notes: [261.63, 329.63, 392.0, 493.88] },
  { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] },
  { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] },
  { bass: 98.0, notes: [196.0, 246.94, 293.66, 329.63] },
]
const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0]

function ensure(): AudioContext | null {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = muted ? 0 : 1
  master.connect(ctx.destination)
  musicBus = ctx.createGain()
  musicBus.gain.value = 0
  musicBus.connect(master)
  sfxBus = ctx.createGain()
  sfxBus.gain.value = SFX_LEVEL
  sfxBus.connect(master)
  // a soft echo makes the bells feel roomy
  echo = ctx.createDelay(1)
  echo.delayTime.value = 0.42
  const fb = ctx.createGain()
  fb.gain.value = 0.36
  echo.connect(fb)
  fb.connect(echo)
  echo.connect(musicBus)
  bellBus = ctx.createGain()
  bellBus.connect(musicBus)
  bellBus.connect(echo)
  if (!watching) {
    watching = true
    document.addEventListener('visibilitychange', () => { // silence when the tab is hidden
      if (!ctx) return
      if (document.hidden) void ctx.suspend(); else void ctx.resume()
    })
  }
  return ctx
}

function tone(freq: number, t: number, dur: number, peak: number, type: OscillatorType, dest: AudioNode, attack = 0.01) {
  const c = ctx!
  const o = c.createOscillator(), g = c.createGain()
  o.type = type
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g)
  g.connect(dest)
  o.start(t)
  o.stop(t + dur + 0.05)
}

function pad(freq: number, t: number, dur: number, peak: number, type: OscillatorType = 'triangle') {
  const c = ctx!
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = 1000
  const g = c.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + 1.3)
  g.gain.setValueAtTime(peak, t + dur - 1.4)
  g.gain.linearRampToValueAtTime(0, t + dur)
  f.connect(g)
  g.connect(musicBus)
  for (const detune of [-5, 5]) {
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.detune.value = detune
    o.connect(f)
    o.start(t)
    o.stop(t + dur + 0.1)
  }
}

function scheduleBar(t: number) {
  const ch = CHORDS[barNo++ % CHORDS.length]
  const dur = BAR + 1.4 // overlap into the next bar so chords melt together
  ch.notes.forEach(n => pad(n, t, dur, 0.18))
  pad(ch.bass, t, dur, 0.22, 'sine')
  for (let k = 0, n = 2 + Math.floor(Math.random() * 2); k < n; k++) {
    const f = BELLS[Math.floor(Math.random() * BELLS.length)], bt = t + 0.4 + Math.random() * 3.2
    tone(f, bt, 1.6, 0.14, 'sine', bellBus, 0.01)
    tone(f * 2, bt, 0.9, 0.03, 'sine', bellBus, 0.01)
  }
}

/** Call from a tap/keypress. Starts (or resumes) the audio engine and the background music. */
export function unlockSound() {
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  if (started) return
  started = true
  nextBar = c.currentTime + 0.1
  barNo = 0
  musicBus.gain.cancelScheduledValues(c.currentTime)
  musicBus.gain.setValueAtTime(0, c.currentTime)
  musicBus.gain.linearRampToValueAtTime(MUSIC_LEVEL, c.currentTime + 3) // slow fade-in
  const tick = () => { while (nextBar < c.currentTime + 1.2) { scheduleBar(nextBar); nextBar += BAR } }
  tick()
  timer = window.setInterval(tick, 500)
}

/** Fade the music out and shut the audio engine down (after effects and echoes have rung out). */
export function stopSound(fade = 0.6) {
  const c = ctx
  if (!c) return
  window.clearInterval(timer)
  started = false
  musicBus.gain.cancelScheduledValues(c.currentTime)
  musicBus.gain.setValueAtTime(musicBus.gain.value, c.currentTime)
  musicBus.gain.linearRampToValueAtTime(0, c.currentTime + fade)
  window.setTimeout(() => {
    void c.close().catch(() => {})
    if (ctx === c) { ctx = null; noise = null }
  }, (fade + 2.5) * 1000)
}

export function setSoundMuted(m: boolean) {
  muted = m
  if (ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05)
}

const live = () => (ctx && !muted ? ctx : null)

/** Airy whoosh between screens; dir 1 sweeps up (forward), -1 sweeps down (back). */
export function swoosh(dir: 1 | -1 = 1) {
  const c = live()
  if (!c) return
  if (!noise) {
    noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const t = c.currentTime
  const s = c.createBufferSource()
  s.buffer = noise
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 1.2
  f.frequency.setValueAtTime(dir > 0 ? 500 : 2600, t)
  f.frequency.exponentialRampToValueAtTime(dir > 0 ? 2600 : 500, t + 0.38)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.12)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
  s.connect(f)
  f.connect(g)
  g.connect(sfxBus)
  s.start(t)
  s.stop(t + 0.5)
}

/** A few bell notes in a row, e.g. chime([523, 659, 784]). */
export function chime(freqs: number[], gap = 0.08, peak = 0.5) {
  const c = live()
  if (!c) return
  const t = c.currentTime + 0.03
  freqs.forEach((f, i) => {
    tone(f, t + i * gap, 1.0, peak, 'sine', sfxBus, 0.005)
    tone(f * 2, t + i * gap, 0.5, peak * 0.22, 'sine', sfxBus, 0.005)
  })
}

export function pop(f = 520) {
  const c = live()
  if (!c) return
  const t = c.currentTime
  const o = c.createOscillator(), g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f * 0.6, t)
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
  o.connect(g)
  g.connect(sfxBus)
  o.start(t)
  o.stop(t + 0.2)
}

export function beep(f = 800) {
  const c = live()
  if (c) tone(f, c.currentTime, 0.12, 0.25, 'sine', sfxBus, 0.005)
}

export const ding = () => chime([1318.5, 1975.5], 0.09, 0.45)
export const success = () => chime([523.25, 659.25, 783.99, 1046.5], 0.075, 0.45)
export const notify = () => chime([1174.66, 880], 0.16, 0.45)
export const forward = () => chime([659.25, 987.77], 0.07, 0.35) // E5 -> B5, "next"
export const backward = () => chime([987.77, 659.25], 0.07, 0.3)

/** For tests/diagnostics only. */
export const soundState = () => ({ state: ctx?.state ?? 'none', muted, music: started, musicLevel: musicBus ? Number(musicBus.gain.value.toFixed(3)) : 0 })
