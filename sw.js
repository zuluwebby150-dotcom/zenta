// Bump V only when you want to purge old caches; updates to files are picked up automatically.
const V = 'zenta-v26';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'privacy.html', 'terms.html'];
const FIREBASE = ['app', 'auth', 'firestore'].map(n => `https://www.gstatic.com/firebasejs/10.12.2/firebase-${n}.js`);
const NET_TIMEOUT = 4000; // on weak networks, fall back to cache after 4s

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(async c => {
    await c.addAll(SHELL);
    await Promise.allSettled(FIREBASE.map(u => c.add(u))); // so the first offline launch works
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

const cacheable = u => u.origin === self.location.origin || u.hostname === 'www.gstatic.com'
  || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !cacheable(url)) return;
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const net = fetch(req).then(r => { if (r.ok && r.status === 200) cache.put(req, r.clone()); return r; });
    try {
      return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, NET_TIMEOUT))]);
    } catch (_) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || net;
      return net;
    }
  })());
});
