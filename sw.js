// Cache-first app shell. Everything here is static, so a plain cache-first
// strategy is correct; bump VERSION whenever any cached file changes and the
// new service worker will drop the old cache on activate.
const VERSION = 'v16';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'kanji.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // cache:'reload' bypasses the browser's own HTTP cache. Without it a plain
  // addAll re-reads whatever is still fresh there -- GitHub Pages serves these
  // files with max-age -- and fills the brand new cache with the PREVIOUS
  // release's bytes, so bumping VERSION changes nothing that anyone can see.
  const fresh = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
