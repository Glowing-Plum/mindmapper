// Offline support. The app is a fixed set of small static files, so the whole
// shell is cached on install and served from there, while a fresh copy is
// fetched in the background for next time.
//
// Bump VERSION when the shell changes: the old cache is dropped on activate.

const VERSION = 'mindmapper-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/editor.js',
  'src/exporters.js',
  'src/files.js',
  'src/layout.js',
  'src/measure.js',
  'src/model.js',
  'src/palette.js',
  'src/parser.js',
  'src/render.js',
  'src/samples.js',
  'src/storage.js',
  'src/viewport.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // One missing file must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline: whatever we have is the answer

      // Serve from cache at once, refresh in the background.
      return cached || network;
    }),
  );
});
