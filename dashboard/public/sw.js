/* Only the explicitly public offline screen and branding are stored on disk.
 * API responses, dashboard HTML, app code and financial data are never cached. */
const CACHE = 'financeiro-public-offline-v3';
const PUBLIC_ASSETS = ['/offline.html', '/offline.css', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('financeiro-public-offline-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match('/offline.html')));
    return;
  }
  if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});

// Notifications never expose financial details on the lock screen.
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use the private default. */ }
  const tag = typeof payload.tag === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(payload.tag) ? payload.tag : 'finance-pending';
  event.waitUntil(self.registration.showNotification('Assistente de Finanças', {
    body: 'Você tem um lembrete ou uma pendência para conferir. Abra seu financeiro.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag, renotify: false, data: { url: '/?reminders=1' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => new URL(item.url).origin === self.location.origin);
    if (client) {
      await client.focus(); client.postMessage({ type: 'OPEN_REMINDERS' });
    } else await self.clients.openWindow('/?reminders=1');
  })());
});
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({ type:'window' }).then(windows => {
    for (const client of windows) client.postMessage({ type:'PUSH_SUBSCRIPTION_CHANGED' });
  }));
});
