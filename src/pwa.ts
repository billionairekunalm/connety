// "Install app" support. Chrome/Edge/Android fire beforeinstallprompt; iPhone has no prompt,
// so there we show "Share → Add to Home Screen" instructions instead.
let deferred: any = null
const subs = new Set<() => void>()
const notify = () => subs.forEach(f => f())

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify() })
window.addEventListener('appinstalled', () => { deferred = null; notify() })
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
export const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
export const canPrompt = () => !!deferred
export const onInstallChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export async function promptInstall() {
  if (!deferred) return false
  deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  notify()
  return outcome === 'accepted'
}

// Push reminders. iPhone only allows them for apps added to the Home Screen.
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushNeedsInstall = () => isIOS && !isStandalone()

export async function subscribePush(publicKey: string) {
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error('Notifications are blocked. Allow them for this site in your phone or browser settings.')
  const reg = await navigator.serviceWorker.ready
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
  return sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
}
