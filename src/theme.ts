// Light / Dark / System. The resolved theme is written to <html data-theme="light|dark"> and all dark styles
// hang off that attribute. index.html sets it before first paint so there's no flash of the wrong theme.
import { useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'theme'
const DARK_BAR = '#0c0a12'
const LIGHT_BAR = '#efeaff'
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export const getPref = (): ThemePref => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' }
}
export const resolveTheme = (p: ThemePref = getPref()): 'light' | 'dark' => (p === 'system' ? (mq?.matches ? 'dark' : 'light') : p)

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function applyTheme(animate = false) {
  const t = resolveTheme()
  const root = document.documentElement
  if (animate) { // a short cross-fade instead of a hard flip
    root.classList.add('theme-anim')
    window.setTimeout(() => root.classList.remove('theme-anim'), 450)
  }
  root.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? DARK_BAR : LIGHT_BAR)
  emit()
}

export function setPref(p: ThemePref) {
  try { if (p === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p) } catch { /* private mode */ }
  applyTheme(true)
}

// "System" follows the phone live, e.g. when it switches to dark at sunset.
mq?.addEventListener('change', () => { if (getPref() === 'system') applyTheme(true) })
// Also re-check when you come back to the app: a phone that switched to dark while the app was in the background
// doesn't always send the change event, so this keeps "System" honest.
const resync = () => { if (getPref() === 'system' && document.documentElement.dataset.theme !== resolveTheme()) applyTheme(true) }
document.addEventListener('visibilitychange', () => { if (!document.hidden) resync() })
addEventListener('focus', resync)
addEventListener('pageshow', resync)

/** Current preference and the theme actually showing; re-renders when either changes. */
export function useTheme() {
  const snap = useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => `${getPref()}|${resolveTheme()}`,
  )
  const [pref, theme] = snap.split('|') as [ThemePref, 'light' | 'dark']
  return { pref, theme, setPref }
}
