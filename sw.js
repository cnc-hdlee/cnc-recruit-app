// CNC 채용 커맨드센터 — viewer service worker
// Strategy:
//  - Pre-cache the app shell so the page opens instantly (and offline) after first visit.
//  - Network-first for snapshot.json (data freshness wins).
//  - Cache-first for built assets (immutable hashed filenames).
//  - Bump VERSION on every release to evict stale caches.

const VERSION = 'cnc-viewer-2026-04-29-a';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const SHELL_ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept cross-origin (Pretendard CDN, Google APIs, etc.)
  if (url.origin !== self.location.origin) return;

  // Network-first for the data snapshot — always want fresh.
  if (url.pathname.endsWith('/snapshot.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })))
    );
    return;
  }

  // Navigation requests → app shell fallback (SPA).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((c) => c || caches.match('./')))
    );
    return;
  }

  // Cache-first for built assets / icons.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
