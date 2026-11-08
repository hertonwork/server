// Service worker. `npm run build` fills in VERSION (a hash of everything in PRECACHE) and PRECACHE, so a deploy
// that changes any shipped file is a new cache, and one that changes nothing leaves the installed worker alone.
//
//   install   precache the shell, the not-found page, the manifest and the icons
//   activate  drop every older cache, take over open pages
//   fetch     same-origin GET only, never /api/*, never a request marked x-probe (the page inspecting the server)
//             navigations  → network, and the cached shell when the network is away (the app opens offline)
//             other files  → cache first, refreshed in the background (stale-while-revalidate)
//   message   'skip' → activate the waiting version now (the page's "Reload" button)
const VERSION = 'b29c7fce';
const CACHE = 'simple-server-' + VERSION;
const PRECACHE = ["/index.html","/404.html","/manifest.webmanifest","/favicon.ico","/apple-touch-icon.png","/android-chrome-192x192.png","/android-chrome-512x512.png","/icon-maskable-512.png"];
const SHELL = '/index.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('x-probe')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(SHELL)));
    return;
  }

  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req);
    const refresh = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => hit || Response.error());
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  }));
});
