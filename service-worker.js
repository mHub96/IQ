// service-worker.js - Dynamic Network-First Strategy for Hospital Main Hub
const CACHE_VERSION = 'v2.4.0';
const CACHE_NAME = `hospital-hub-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './Home.html',
  './schedule.html',
  './signup.html',
  './admin.html',
  './owner.html',
  './scheduler.html',
  './s.html',
  './hub-core.js',
  './nav-component.js',
  './nav-component.css',
  './hub-data.json',
  './manifest.webmanifest',
  './pwa.js',
  './pwa-icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell version:', CACHE_VERSION);
        return cache.addAll(APP_SHELL).catch(err => {
          console.warn('[Service Worker] Non-fatal caching issue during install:', err);
        });
      })
      .then(() => {
        // Force immediate activation without waiting for existing tabs to close
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[Service Worker] Deleting legacy cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      // Claim clients immediately so the new worker takes control right away
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Network-First for HTML navigation and dynamic database (ensures phone always gets fresh commits)
  const isHtmlOrData = event.request.mode === 'navigate' ||
                       url.pathname.endsWith('.html') ||
                       url.pathname.endsWith('/') ||
                       url.pathname.includes('hub-data.json') ||
                       url.pathname.endsWith('.json');

  if (isHtmlOrData) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback to cache
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            // If navigating to an HTML page while offline, fallback to index.html
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html') || caches.match('./');
            }
          });
        })
    );
    return;
  }

  // Stale-While-Revalidate for other static assets (css, js, fonts, images)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failure is fine for cached assets
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// Handle explicit messages from clients
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
