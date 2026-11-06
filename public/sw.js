// Minimal service worker so browsers offer "Install app". Pages always come from the network;
// ponytail: no offline cache yet, add one (e.g. cache the app shell) if offline use matters.
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate')
    e.respondWith(fetch(e.request).catch(() => new Response('You are offline. Connect to the internet and try again.', { headers: { 'Content-Type': 'text/plain' } })))
})

// "Time to call" reminders sent by the send-reminders function.
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(d.title || 'Connections', {
    body: d.body || 'Time to stay in touch.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'call-reminder', // a new reminder replaces the old one instead of piling up
    data: { url: d.url || '/' },
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin))
    return open ? open.focus() : clients.openWindow(url)
  }))
})
