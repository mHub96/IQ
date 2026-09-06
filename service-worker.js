// service-worker.js - Dynamic versioning for Hospital Main Hub
const CACHE_VERSION = 'v2.0.0';
const CACHE_NAME = `hospital-hub-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './Home.html',
  './signup.html',
  './admin.html',
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
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[Service Worker] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});
