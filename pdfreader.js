// pdfreader.js – liest PDF-Dateien (z. B. aus GoodNotes exportiert) mit pdf.js von Mozilla.
//
// Zwei Fälle pro Seite:
//   1. Die Seite enthält echten Text (getippt, Arbeitsblatt, Buch-PDF): Text wird direkt
//      ausgelesen. Das ist fehlerfrei und sehr schnell.
//   2. Die Seite ist ein Bild oder Handschrift (Scan, GoodNotes-Notizen): Die Seite wird
//      als Bild gezeichnet und dann mit der Texterkennung (ocr.js) gelesen.

const PdfReader = (() => {
  let ready = false;

  function lib() {
    if (typeof pdfjsLib === 'undefined') throw new Error('Der PDF-Leser konnte nicht geladen werden.');
    if (!ready) {
      // Der "Worker" von pdf.js liegt neben pdf.min.js (mit oder ohne Unterordner).
      const script = document.querySelector('script[src*="pdf.min.js"]');
      pdfjsLib.GlobalWorkerOptions.workerSrc = script
        ? script.src.replace(/pdf\.min\.js.*$/, 'pdf.worker.min.js')
        : 'pdf.worker.min.js';
      ready = true;
    }
    return pdfjsLib;
  }

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  async function open(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    return lib().getDocument({
      data,
      isEvalSupported: false,
      // Zusatzdaten für besondere Schriften (nur nötig bei manchen PDFs, brauchen dann Internet)
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
    }).promise;
  }

  // Text einer Seite mit Zeilenumbrüchen wieder zusammensetzen.
  // Jedes Textstück hat eine Position (x, y). Gleiche Höhe = gleiche Zeile.
  // Großer Abstand nach unten = neuer Absatz (Leerzeile), das hilft beim Erkennen von Überschriften.
  async function pageText(page) {
    const content = await page.getTextContent();
    const items = content.items.filter(it => it.str !== undefined);
    const lines = [];
    items.forEach(it => {
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      let line = lines.find(l => Math.abs(l.y - y) < h * 0.5);
      if (!line) { line = { y, h, parts: [] }; lines.push(line); }
      line.parts.push({ x, str: it.str, w: it.width || 0 });
    });
    lines.sort((a, b) => b.y - a.y);
    let out = '';
    let lastY = null;
    let lastH = 10;
    lines.forEach(l => {
      l.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      l.parts.forEach(p => {
        if (end !== null && p.x - end > l.h * 0.2 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
        text += p.str;
        end = p.x + p.w;
      });
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (lastY !== null && lastY - l.y > Math.max(lastH, l.h) * 1.9) out += '\n';
      out += text + '\n';
      lastY = l.y;
      lastH = l.h;
    });
    return out.trim();
  }

  // Seite als Bild zeichnen (für die Texterkennung).
  async function renderPage(page) {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2000 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // Hat die Seite genug echten Text? Sonst ist es ein Bild/Handschrift.
  function hasRealText(text) {
    return (text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 25;
  }

  return { isPdf, open, pageText, renderPage, hasRealText };
})();
