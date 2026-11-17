// sw.js – Service Worker: speichert alle Dateien der App im Browser-Cache.
// Dadurch startet die App auch ohne Internet. Bei Änderungen VERSION erhöhen.
const VERSION = 'lernkiste-v3';
const FILES = [
  './', 'index.html', 'manifest.json', 'style.css',
  'storage.js', 'srs.js', 'generator.js', 'ocr.js', 'pdfreader.js', 'quiz.js', 'app.js',
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'tesseract.min.js', 'worker.min.js', 'pdf.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Erst im Cache nachschauen, sonst aus dem Internet laden und für später speichern
// (so landen auch die großen Texterkennungs-Dateien nach der ersten Nutzung im Cache).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
