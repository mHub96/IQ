// service-worker.js - Hospital Main Hub
// The app's own files are served straight from the cache (instant, like an installed app) and
// refreshed in the background; a deploy also bumps CACHE_VERSION, which re-downloads all of them
// and reloads open pages once. API calls are never cached.
const CACHE_VERSION = 'v3.12.1';
// Next to the live site on the same origin (mhub96.github.io/IQ-new/), the beta's caches carry
// their own prefix, and only those are ever cleaned up here: the live site's caches are left alone.
const SCOPE_MATCH = /\/(IQ-[^/]+)\//i.exec(new URL(self.registration.scope).pathname);
const SCOPE_PREFIX = SCOPE_MATCH ? SCOPE_MATCH[1].toLowerCase() + '-' : '';
const CACHE_NAME = `${SCOPE_PREFIX}hospital-hub-${CACHE_VERSION}`;
const CDN_CACHE = 'hospital-hub-cdn-v1';
const NETWORK_TIMEOUT_MS = 4000;

const APP_SHELL = [
  './',
  './app.html',
  './app-shell.js',
  './app-shell.css',
  './app-view.js',
  './index.html',
  './Home.html',
  './emergency.html',
  './emergency.js',
  './emergency-data.js',
  './emergency-portal.js',
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
  './hub-aa.js',
  './hub-accounts.js',
  './hub-accounts.css',
  './hub-ios.css',
  './hub-panel.js',
  './hub-myschedule.js',
  './hub-myschedule.css',
  './hub-avatar.js',
  './account.html',
  './nav-component.js',
  './nav-component.css',
  './manifest.webmanifest',
  './pwa.js',
  './pwa-icon.svg',
  './storage-scope.js'
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
    const fromOldGeneration = keys.some(key => key.startsWith(SCOPE_PREFIX + 'hospital-hub-v2.'));
    return Promise.all(
      keys.filter(key => key.startsWith(SCOPE_PREFIX + 'hospital-hub-') && key !== CACHE_NAME && key !== CDN_CACHE).map(key => caches.delete(key))
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

// The app's files: answer from the cache at once, fetch a fresh copy for next time.
// Pages are matched without their query (?hospital=…), so every address of a page is instant.
function cacheFirstRevalidate(request, event) {
  const isPage = request.mode === 'navigate' || request.destination === 'document' || request.destination === 'iframe';
  return caches.open(CACHE_NAME).then(cache =>
    cache.match(request, { ignoreSearch: isPage }).then(cached => {
      const network = fetch(request).then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          cache.put(isPage ? new URL(request.url).pathname : request, copy).catch(() => {});
        }
        return response;
      });
      if (cached) {
        if (event) event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return networkFirst(request);
    })
  );
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
    event.respondWith(cacheFirstRevalidate(request, event));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else (the Cloudflare API, GitHub, ...) goes straight to the network.
});

// ---------------------------------------------------------------------------
// Push notifications (sent by the API; payload: { title, body, url, tag })
// ---------------------------------------------------------------------------
self.addEventListener('push', event => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = { title: 'Hosp Hub', body: event.data ? event.data.text() : '' }; }
  const title = msg.title || 'بوابة المستشفيات';
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: msg.body || '',
      icon: './pwa-icon.svg',
      badge: './pwa-icon.svg',
      tag: msg.tag || undefined,
      renotify: !!msg.tag,
      dir: 'rtl',
      lang: 'ar',
      data: { url: msg.url || './index.html?portal=true' }
    }),
    // Count on the app icon; the open app corrects it on its next check.
    self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './index.html?portal=true', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const tops = windows.filter(w => w.frameType !== 'nested' && w.url.startsWith(self.registration.scope));
      // The running app opens the screen in place (no reload); an older page is navigated.
      const app = tops.find(w => new URL(w.url).pathname.endsWith('/app.html'));
      if (app) { app.postMessage({ type: 'app:open', url: target }); return app.focus(); }
      const open = tops[0];
      if (open) return open.navigate(target).then(w => (w || open).focus()).catch(() => open.focus());
      return self.clients.openWindow(target);
    })
  );
});
