/* Kaching offline service worker
   Strategy: stale-while-revalidate for the app shell — the cached copy opens
   instantly (even fully offline), and a fresh copy is fetched in the background
   so the NEXT open runs the newest deployed version. API calls (JSONBin,
   Anthropic) are never intercepted. */
const CACHE = 'kaching-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const isSameOrigin = url.origin === location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isSameOrigin && !isFont) return; // JSONBin / Anthropic / anything else: network only

  // App shell navigation: serve cache immediately, refresh in background
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      const refresh = fetch(req).then((resp) => {
        if (resp && resp.ok) {
          cache.put('./index.html', resp.clone());
          cache.put('./', resp.clone());
        }
        return resp;
      }).catch(() => null);
      if (cached) { e.waitUntil(refresh); return cached; }
      const fresh = await refresh;
      return fresh || new Response('<h1 dir="rtl">אין חיבור לאינטרנט</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })());
    return;
  }

  // Static assets + fonts: cache-first with background refresh
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const refresh = fetch(req).then((resp) => {
      if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
      return resp;
    }).catch(() => cached);
    if (cached) { e.waitUntil(refresh.catch(() => {})); return cached; }
    return refresh;
  })());
});
