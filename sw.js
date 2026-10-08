/*
 * Unsparkle – service worker: makes the app installable and usable offline.
 * The app shell is cached on install; the big AI files (models, onnxruntime)
 * are cached the first time they're used. Images are never cached or stored.
 * Bump VERSION on every release so visitors get the new files.
 */
const VERSION = 'unsparkle-v2';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/i18n.js', 'js/guard.js', 'js/masks.js', 'js/core.js', 'js/work.js', 'js/zip.js',
  'js/upscale.js', 'js/fill.js', 'js/eraser.js', 'js/prefs.js', 'js/app.js', 'js/magic.js',
  'js/vendor/mediabunny.min.js', 'js/video.js', 'js/videoapp.js',
  'assets/logo.svg', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/fonts/inter-latin.woff2', 'assets/fonts/space-grotesk-latin.woff2',
  'manifest.webmanifest',
];
const RUNTIME = [/\/js\/models\//, /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@/];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  const sameOrigin = url.startsWith(self.location.origin);
  const big = RUNTIME.some((re) => re.test(url));
  if (!sameOrigin && !big) return;

  if (big) {
    // AI files never change for a given version: cache first, network once
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // app shell: network first so updates show up, cache when offline
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone(); // copy now, before the page reads the body
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
