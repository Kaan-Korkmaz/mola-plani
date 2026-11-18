// Çevrimdışı çalışma: dosyaları önbelleğe alır. Güncellemede CACHE sürümünü artır.
const CACHE = 'mola-v2';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/scheduler.js', 'js/defaults.js', 'js/store.js',
  'js/export.js', 'js/importer.js', 'vendor/xlsx.bundle.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Önce ağ (güncel sürüm), ağ yoksa önbellek.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
