/* Immunopolis service worker: cache-first app shell for offline play.
   Bump CACHE_VERSION on every release that changes any shell file. */
const CACHE_VERSION = 'immunopolis-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Same-origin: cache-first (app shell). Cross-origin (fonts, analytics):
  // network with silent failure so offline play is never blocked on them.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then(hit =>
        hit || fetch(e.request).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
          }
          return res;
        })
      )
    );
  }
});
