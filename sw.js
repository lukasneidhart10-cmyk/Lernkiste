// sw.js – Service Worker: speichert die Dateien der App im Browser, damit sie auch offline startet.
// Bei Änderungen VERSION erhöhen.
//
// Strategie:
//  - App-Dateien (HTML, CSS, JS): ZUERST aus dem Internet holen (immer die neueste Version),
//    nur ohne Internet die gespeicherte Kopie nehmen.
//  - Große Bibliotheken (Texterkennung, PDF-Leser): aus dem Speicher, weil sie sich nie ändern.
const VERSION = 'lernkiste-v6';
const FILES = [
  './', 'index.html', 'manifest.json', 'style.css',
  'storage.js', 'srs.js', 'generator.js', 'ocr.js', 'pdfreader.js', 'pdfexport.js', 'ai.js', 'quiz.js', 'app.js',
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'tesseract.min.js', 'worker.min.js', 'pdf.min.js', 'jspdf.umd.min.js',
];
const BIG = /(jspdf|tesseract|worker\.min|pdf\.min|traineddata|wasm)/;

self.addEventListener('install', (e) => {
  // cache: 'reload' = am Browser-Zwischenspeicher vorbei direkt vom Server laden
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function save(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(VERSION).then((c) => c.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;

  if (sameOrigin && !BIG.test(url.pathname)) {
    // Internet zuerst, Speicher als Ersatz
    e.respondWith(
      fetch(e.request.url, { cache: 'no-cache' })
        .then((res) => save(e.request, res))
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./')))
    );
    return;
  }
  // Speicher zuerst (große Bibliotheken, Schriften)
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    // Schriften und der KI-Baustein (WebLLM vom CDN) werden für offline gespeichert.
    // Das KI-Modell selbst speichert WebLLM in einem eigenen Speicher.
    return (sameOrigin || url.hostname.includes('fonts.g') || url.pathname.includes('@mlc-ai/web-llm')) ? save(e.request, res) : res;
  })));
});
