// Minimal service worker so browsers offer "Install app". Pages always come from the network;
// ponytail: no offline cache yet, add one (e.g. cache the app shell) if offline use matters.
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate')
    e.respondWith(fetch(e.request).catch(() => new Response('You are offline. Connect to the internet and try again.', { headers: { 'Content-Type': 'text/plain' } })))
})
