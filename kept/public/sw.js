/*
 * Kept's service worker.
 *
 * The app's promise is that a deadline is checkable anywhere — on the train,
 * in the shop, with no signal — so offline is a feature, not a fallback.
 *
 * It caches nothing but this app's own static assets. There is no receipt
 * data here and no request to anywhere else: the receipts live in
 * localStorage on the device, and the only origin this worker ever talks to
 * is the one it was served from.
 */

/*
 * Stamped at build time — see the stampServiceWorker plugin in vite.config.ts.
 * The name has to change when the assets do: `activate` below evicts every
 * cache that is not the current one, and with a fixed name that is nothing at
 * all. Each deploy's hashed bundles would then accumulate forever, competing
 * for the same storage quota the app keeps the user's receipts in — and this
 * app shows a standing warning when that quota runs out.
 *
 * Left as a literal so this file is still valid, servable JavaScript when
 * read straight out of public/.
 */
const CACHE = 'kept-__BUILD_ID__';

/**
 * The shell, precached at install so a first offline launch works. Hashed
 * bundle URLs are deliberately absent — they change every build and a stale
 * hard-coded list would poison the cache. They are picked up at runtime
 * instead, on the first online load.
 */
const SHELL = ['/app/', '/manifest.webmanifest', '/icons/icon.svg', '/fonts/space-grotesk.woff2', '/fonts/instrument-sans.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      // A single 404 in the shell list would reject addAll and leave the
      // worker uninstalled; better to install with a partial cache and fill
      // the rest at runtime.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin requests are not this worker's business — and the app makes
  // none. Letting them fall through keeps that true rather than quietly
  // becoming a cache for whatever a future dependency decides to fetch.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a deployed update is picked up on the
  // next online launch, with the cached shell behind it for offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/app/', copy));
          return res;
        })
        .catch(() => caches.match('/app/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Everything else — hashed bundles, fonts, icons — is immutable per URL, so
  // cache first and fill on miss.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

/**
 * A deadline alert exists to get someone back into the app, so clicking one
 * must land them there — focusing the tab they already have open rather than
 * stacking up a second copy of the app beside it.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/app/') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow('/app/');
    }),
  );
});
