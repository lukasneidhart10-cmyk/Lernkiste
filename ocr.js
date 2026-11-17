// ocr.js – Texterkennung aus Fotos mit Tesseract.js (kostenlos, läuft komplett im Browser).
// Ablauf: Bild laden -> verkleinern und Kontrast verbessern -> Tesseract liest den Text.
// Bei mehreren Fotos oder PDF-Seiten wird die Texterkennung nur EINMAL gestartet und dann
// für alle Seiten benutzt (das spart viel Zeit).

const OCR = (() => {
  // Wo liegen die Tesseract-Dateien? Wir schauen nach, woher tesseract.min.js geladen wurde.
  // Klappt mit Unterordnern (vendor/tesseract/...) und ohne (alle Dateien in einem Ordner).
  function localSource() {
    const script = document.querySelector('script[src*="tesseract.min.js"]');
    const base = script ? script.src.replace(/tesseract\.min\.js.*$/, '') : new URL('./', document.baseURI).href;
    const nested = /\/vendor\/tesseract\/$/.test(base);
    return {
      workerPath: base + 'worker.min.js',
      corePath: nested ? new URL('../tesseract-core/', base).href : base,
      langPath: nested ? new URL('../lang/', base).href : base,
    };
  }

  // Ersatz, falls die Dateien fehlen: kostenloser CDN-Server (braucht Internet).
  const CDN = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int/',
  };

  const STATUS = {
    'loading tesseract core': 'Texterkennung wird geladen',
    'initializing tesseract': 'Texterkennung wird gestartet',
    'loading language traineddata': 'Deutsche Sprachdaten werden geladen',
    'initializing api': 'Wird vorbereitet',
    'recognizing text': 'Text wird gelesen',
  };

  // Bild verbessern: auf max. 2000 Pixel verkleinern, Graustufen, Kontrast erhöhen.
  function enhance(source, width, height) {
    const scale = Math.min(1, 2000 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
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
  }

  // Foto-Datei -> verbessertes Bild (Canvas)
  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Das Bild konnte nicht geöffnet werden.'));
        i.src = url;
      });
      return enhance(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Startet die Texterkennung einmal. Rückgabe: { read(canvas, onProgress), close() }
  async function start(onStatus = () => {}) {
    if (typeof Tesseract === 'undefined') throw new Error('Die Texterkennung konnte nicht geladen werden.');
    let progressCb = () => {};
    const logger = (m) => {
      const text = STATUS[m.status] || 'Bitte warten';
      if (m.status === 'recognizing text') progressCb(m.progress || 0, text);
      else onStatus(text, m.progress || 0);
    };
    let worker = null;
    let lastError;
    for (const src of [localSource(), CDN]) {
      try {
        worker = await Tesseract.createWorker('deu', 1, { ...src, workerBlobURL: false, logger });
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!worker) throw new Error('Die Texterkennung hat nicht geklappt. ' + (lastError && lastError.message ? lastError.message : ''));
    return {
      async read(canvas, onProgress = () => {}) {
        progressCb = onProgress;
        const { data } = await worker.recognize(canvas);
        return data.text;
      },
      close: () => worker.terminate(),
    };
  }

  return { start, prepareImage, enhance };
})();
