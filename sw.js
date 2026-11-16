/*
 * Unsparkle – service worker: makes the app installable and usable offline.
 * The app shell is cached on install; the big AI files (models, onnxruntime)
 * are cached the first time they're used. Images are never cached or stored.
 * Bump VERSION on every release so visitors get the new files.
 */
const VERSION = 'unsparkle-v9';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/i18n.js', 'js/guard.js', 'js/meta.js', 'js/tagtool.js', 'js/masks.js', 'js/core.js', 'js/work.js', 'js/zip.js',
  'js/upscale.js', 'js/fill.js', 'js/eraser.js', 'js/prefs.js', 'js/app.js', 'js/magic.js',
  'js/vendor/mediabunny.min.js', 'js/video.js', 'js/videoapp.js', 'js/bgremove.js',
  'assets/logo.svg', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/fonts/inter-latin.woff2', 'assets/fonts/space-grotesk-latin.woff2',
  'manifest.webmanifest',
];
const RUNTIME = [/\/js\/models\//, /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@/];

// GitHub Pages can't send custom headers, so the page is made cross-origin
// isolated here. That lets the AI tools (upscale, erase, background) use every
// CPU core instead of one: about 2-3x faster when there's no usable GPU.
function isolate(req, res) {
  if (!res || req.mode !== 'navigate' || res.type === 'opaque' || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  // no-cache: always check the server (a quick 304 when unchanged), so a new
  // release never mixes fresh and stale files from the browser's own cache
  e.respondWith(
    (req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone(); // copy now, before the page reads the body
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return isolate(req, res);
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => isolate(req, hit) || caches.match('index.html').then((r) => isolate(req, r)))),
  );
});
