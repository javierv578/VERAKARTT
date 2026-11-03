// VERA KART — service-worker.js
// Caché y modo offline. Todo el juego (incluido Three.js y los karts) queda guardado
// en el dispositivo tras la primera visita con internet.
//
// IMPORTANTE: cuando cambies cualquier archivo del juego, sube el número de VERSION
// (por ejemplo 'verakart-v2') para que los móviles descarguen la versión nueva.

const VERSION = 'verakart-v2';

// Archivos base (rutas relativas: funciona en la raíz o dentro de una subcarpeta como /verakart/)
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/kart.js',
  './js/track.js',
  './js/controls.js',
  './js/hud.js',
  './js/sky.js',
  './js/scenery.js',
  './js/effects.js',
  './js/audio.js',
  './js/net.js',
  './vendor/three/build/three.module.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './kart.glb',
  './cangri.glb',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // lo externo (otros dominios) no se toca

  // Páginas (incluye /?seed=123): red primero, y si no hay internet, la copia guardada.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Resto de archivos: caché primero (rápido y offline); si falta, red y se guarda.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
