// ocr.js – Texterkennung aus Fotos mit Tesseract.js (kostenlos, läuft komplett im Browser).
// Ablauf: Foto laden -> verkleinern und Kontrast verbessern -> Tesseract liest den Text.

const OCR = (() => {
  // Die Dateien liegen direkt bei der App (im selben Ordner). Dadurch klappt es auch offline.
  // Falls sie fehlen, wird als Ersatz ein kostenloser CDN-Server benutzt.
  const SOURCES = [
    {
      workerPath: 'worker.min.js',
      corePath: './',
      langPath: './',
    },
    {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
      langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int/',
    },
  ];

  const STATUS = {
    'loading tesseract core': 'Texterkennung wird geladen',
    'initializing tesseract': 'Texterkennung wird gestartet',
    'loading language traineddata': 'Deutsche Sprachdaten werden geladen',
    'initializing api': 'Wird vorbereitet',
    'recognizing text': 'Text wird gelesen',
  };

  const abs = (p) => new URL(p, document.baseURI).href;

  // Bild verbessern: auf max. 2000 Pixel verkleinern, in Graustufen umwandeln, Kontrast erhöhen.
  // Das macht die Erkennung schneller und genauer.
  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Das Bild konnte nicht geöffnet werden.'));
        i.src = url;
      });
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      const contrast = 1.5;
      for (let i = 0; i < px.length; i += 4) {
        // Helligkeit nach Wahrnehmung des Auges (Grün zählt am meisten).
        const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const v = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(data, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function runWith(source, canvas, onProgress) {
    const worker = await Tesseract.createWorker('deu', 1, {
      workerPath: abs(source.workerPath),
      corePath: abs(source.corePath),
      langPath: abs(source.langPath),
      workerBlobURL: false,
      logger: (m) => onProgress(m.progress || 0, STATUS[m.status] || 'Bitte warten'),
    });
    try {
      const { data } = await worker.recognize(canvas);
      return data.text;
    } finally {
      await worker.terminate();
    }
  }

  // Hauptfunktion: liefert den erkannten Text. onProgress(0..1, statusText) für die Fortschrittsanzeige.
  async function recognize(file, onProgress = () => {}) {
    if (typeof Tesseract === 'undefined') throw new Error('Die Texterkennung konnte nicht geladen werden.');
    onProgress(0, 'Bild wird verbessert');
    const canvas = await prepareImage(file);
    let lastError;
    for (const source of SOURCES) {
      try {
        return await runWith(source, canvas, onProgress);
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error('Die Texterkennung hat nicht geklappt. ' + (lastError && lastError.message ? lastError.message : ''));
  }

  return { recognize, prepareImage };
})();
