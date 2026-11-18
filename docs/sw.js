// Offline support for the GitHub Pages build. Serves the cached app straight away and
// refreshes the cache in the background, so a new version shows up on the next launch.
const CACHE = 'underover-1.1';
const mine = k => k.startsWith('underover-');
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png'];

// GitHub Pages can't send custom headers, so the worker adds the two that make the page cross-origin
// isolated. That unlocks SharedArrayBuffer, which the threaded DS core (3D on a second core) needs.
function isolate(r) {
  if (!r || r.type === 'opaque' || !(r.headers.get('content-type') || '').includes('text/html')) return r;
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so an update never re-caches the old page
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => mine(k) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Only the app itself is served from the cache. Downloads (APKs, the HTML builds), version.json
  // and the other pages always go to the network, so a link to an APK downloads the APK.
  const rel = url.href.slice(self.registration.scope.length).split(/[?#]/)[0];
  if (!(rel === '' || FILES.includes(rel))) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(key, { ignoreSearch: true });
    const fresh = fetch(req).then(r => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => hit);
    return isolate(await (hit || fresh));
  }));
});
