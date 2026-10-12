// service-worker.js - Hospital Main Hub
// Pages and scripts are served network-first so every deploy reaches installed apps on
// their next launch; the cache is only the offline fallback. API calls are never cached.
const CACHE_VERSION = 'v3.0.1';
const CACHE_NAME = `hospital-hub-${CACHE_VERSION}`;
const CDN_CACHE = 'hospital-hub-cdn-v1';
const NETWORK_TIMEOUT_MS = 4000;

const APP_SHELL = [
  './',
  './index.html',
  './Home.html',
  './emergency.html',
  './emergency.js',
  './emergency-data.js',
  './residents.html',
  './schedule.html',
  './specialists.html',
  './icu.html',
  './signup.html',
  './admin.html',
  './scheduler.html',
  './s.html',
  './hub-sync.js',
  './hub-core.js',
  './nav-component.js',
  './nav-component.css',
  './manifest.webmanifest',
  './pwa.js',
  './pwa-icon.svg'
];

const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(url =>
        // One missing file must not abort the whole install.
        cache.add(new Request(url, { cache: 'reload' })).catch(err => console.warn('[Service Worker] Not cached:', url, err))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const activation = caches.keys().then(keys => {
    // Pages open right now were served by the old cache-first worker (v2.x), i.e. they run
    // the old GitHub-based code; they get reloaded once below.
    const fromOldGeneration = keys.some(key => /^hospital-hub-v2\./.test(key));
    return Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== CDN_CACHE).map(key => caches.delete(key))
    ).then(() => self.clients.claim())
      .then(() => fromOldGeneration);
  });
  event.waitUntil(activation);

  // The reload must start after activation has finished: until then this worker cannot
  // answer the reloaded page's requests, so navigating from inside waitUntil would deadlock.
  activation.then(fromOldGeneration => {
    if (!fromOldGeneration) return;
    setTimeout(() => {
      self.clients.matchAll({ type: 'window' })
        .then(windows => windows.forEach(win => win.navigate(win.url).catch(() => {})));
    }, 300);
  });
});

function networkFirst(request) {
  return new Promise(resolve => {
    let settled = false;
    const fallback = () => caches.match(request, { ignoreSearch: true }).then(cached => cached || caches.match('./index.html'));
    const timer = setTimeout(() => {
      fallback().then(cached => {
        if (cached && !settled) {
          settled = true;
          resolve(cached);
        }
      });
    }, NETWORK_TIMEOUT_MS);

    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        }
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(response);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        fallback().then(cached => {
          if (!settled) {
            settled = true;
            resolve(cached || new Response('Offline', { status: 503, statusText: 'Offline' }));
          }
        });
      });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(CDN_CACHE).then(cache =>
    cache.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // The old shared data file is no longer the source of truth; never serve it from cache.
    if (url.pathname.endsWith('/hub-data.json')) return;
    event.respondWith(networkFirst(request));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else (the Cloudflare API, GitHub, ...) goes straight to the network.
});
