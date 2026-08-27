/* Apex Appraise service worker — installable PWA with sane caching.
   Static hashed assets: cache-first (immutable). Navigations: network-first
   with cached-shell fallback so the app opens offline. API/uploads/reports:
   never cached — money data must always be live. */
// Bumped when the precached set changes — activate deletes every other cache,
// which is what makes an old client pick up the new shell.
const VERSION = 'apex-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];
// The typefaces are precached, not merely cacheable. The field app is used on
// sites with no signal, and a font fetched lazily is a font that is missing the
// first time it is needed offline. Self-hosting is what makes this possible at
// all: the fetch handler below ignores cross-origin requests, so the previous
// Google-hosted fonts could never have been cached here.
const FONTS = [
  '/fonts/schibsted-grotesk-latin.woff2',
  '/fonts/schibsted-grotesk-latin-ext.woff2',
  '/fonts/jetbrains-mono-latin.woff2',
  '/fonts/jetbrains-mono-latin-ext.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then(async (c) => {
        // The shell IS the app. If one of these cannot be fetched there is
        // nothing worth installing, so let the install fail and be retried.
        await c.addAll(SHELL);
        /**
         * The typefaces are not. addAll is all-or-nothing, so folding them into
         * the line above would mean one renamed or missing font fails the whole
         * install — and the app silently loses offline mode altogether. That is
         * a far worse outcome than an inspection rendered in a fallback face,
         * so these are cached one at a time and a miss is tolerated.
         */
        await Promise.all(FONTS.map((f) => c.add(f).catch(() => undefined)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const NEVER_CACHE = /^\/(trpc|uploads|reports|webhooks|health)/;

/**
 * `fetch()` only rejects when the network fails. A 502 from a restarting API, a
 * 404 from a half-finished deploy and a maintenance page all RESOLVE — so
 * caching whatever comes back writes the failure into the cache as though it
 * were the app.
 *
 * That is worst for the two things cached here, in opposite ways:
 *
 * - The shell is what the field app opens from with no signal. Cache a 502 under
 *   `/` and the surveyor on a site with no reception gets "502 Bad Gateway",
 *   permanently — the only thing that would overwrite it is a successful
 *   navigation, which needs the signal they do not have. And the poisoning
 *   happens precisely WHEN the network is flaky, which is when this matters.
 * - `/assets/` and `/fonts/` are cache-first because they are content-hashed and
 *   immutable. A cached 404 is therefore also immutable: that client never loads
 *   that asset again, even after the deploy that broke it is rolled back.
 *
 * So nothing enters the cache unless the server actually served it.
 */
const worthCaching = (res) => res && res.ok && res.type === 'basic';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || NEVER_CACHE.test(url.pathname)) return;

  // hashed build assets and typefaces — cache-first (both are immutable)
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (worthCaching(res)) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(e.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // navigations — network-first, cached shell offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // `redirected` as well as `ok`: handing a redirected response back for
          // a navigation is a TypeError, so one cached under `/` would break
          // every subsequent offline open rather than serving the app
          if (worthCaching(res) && !res.redirected) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/')),
    );
  }
});
