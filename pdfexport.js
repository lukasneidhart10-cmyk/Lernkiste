// pdfexport.js – erstellt eine übersichtliche PDF-Datei mit den Karteikarten (wie beim Drucken).
// Benutzt die kostenlose Bibliothek jsPDF.
//
// Wichtig: Eine Karte wird NIE zwischen zwei Seiten zerschnitten.
// Vor dem Zeichnen wird jede Karte "vermessen". Passt die Kartenreihe nicht mehr ganz
// auf die Seite, kommt sie komplett auf die nächste Seite.

const PdfExport = (() => {
  // Maße in Millimetern (A4: 210 x 297)
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 12;
  const GAP = 5;
  const COLS = 2;
  const COL_W = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const PAD = 4;
  const FOOTER = 8;
  const PT = 0.3528; // 1 Punkt in Millimetern

  // Die eingebaute PDF-Schrift kennt nur westeuropäische Zeichen. Andere Zeichen werden ersetzt.
  const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const REPLACE = { '→': '->', '←': '<-', '⇒': '=>', '✓': 'v', '✔': 'v', '≈': '~', '≠': '!=', '≤': '<=', '≥': '>=', '‚': ',', ' ': ' ' };
  function clean(text) {
    return [...String(text)].map(ch => {
      if (REPLACE[ch]) return REPLACE[ch];
      const c = ch.codePointAt(0);
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA.includes(ch) || ch === '\n') return ch;
      return '?';
    }).join('');
  }

  // Eine Karte in einzelne Zeilen zerlegen: [{text, size, bold, color, indent, gapBefore, line}]
  function rowsOf(doc, card, pointsOf) {
    const rows = [];
    const inner = COL_W - 2 * PAD;
    const add = (text, size, opts = {}) => {
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const width = inner - (opts.indent || 0);
      doc.splitTextToSize(clean(text), width).forEach((t, i) => {
        rows.push({ text: t, size, bold: !!opts.bold, color: opts.color || [20, 27, 51], indent: opts.indent || 0,
          bullet: opts.bullet && i === 0, gapBefore: i === 0 ? (opts.gapBefore || 0) : 0, h: size * PT * 1.3 });
      });
    };
    if (card.type === 'summary') {
      add(card.front, 10.5, { bold: true });
      rows.push({ line: 'title', h: 2.5 });
      pointsOf(card).forEach((p, i) => add(p, 9.5, { indent: 3.5, bullet: true, gapBefore: i ? 0.8 : 0 }));
    } else {
      add(card.front.replace(/_____/g, '________'), 10, { bold: true });
      rows.push({ line: 'dash', h: 3 });
      add(card.back, 9.5, { color: [80, 90, 115] });
    }
    return rows;
  }

  const heightOf = (rows) => 2 * PAD + rows.reduce((h, r) => h + r.h + (r.gapBefore || 0), 0);

  // Karten, die höher als eine ganze Seite sind, werden (nur dann) in Teile aufgeteilt.
  function splitTooTall(rows, maxH, title) {
    if (heightOf(rows) <= maxH) return [rows];
    const parts = [];
    let cur = [];
    rows.forEach(r => {
      if (cur.length && heightOf([...cur, r]) > maxH) {
        parts.push(cur);
        cur = [{ text: title + ' (Fortsetzung)', size: 9, bold: true, color: [90, 101, 131], indent: 0, h: 9 * PT * 1.3 }];
      }
      cur.push(r);
    });
    if (cur.length) parts.push(cur);
    return parts;
  }

  function drawCard(doc, rows, x, y, h, isSummary) {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, COL_W, h, 2, 2, 'S');
    let cy = y + PAD;
    rows.forEach(r => {
      if (r.line) {
        if (r.line === 'title') {
          doc.setDrawColor(224, 82, 74);
          doc.setLineWidth(0.4);
          doc.line(x + PAD, cy + 1, x + COL_W - PAD, cy + 1);
        } else {
          doc.setDrawColor(190, 190, 190);
          doc.setLineWidth(0.2);
          doc.setLineDashPattern([1, 1], 0);
          doc.line(x + PAD, cy + 1.5, x + COL_W - PAD, cy + 1.5);
          doc.setLineDashPattern([], 0);
        }
        cy += r.h;
        return;
      }
      cy += r.gapBefore || 0;
      doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
      doc.setFontSize(r.size);
      doc.setTextColor(...r.color);
      const baseline = cy + r.size * PT * 1.0;
      if (r.bullet) {
        doc.setFillColor(44, 75, 214);
        doc.rect(x + PAD + 0.3, baseline - r.size * PT * 0.55, 1.4, 1.4, 'F');
      }
      doc.text(r.text, x + PAD + r.indent, baseline);
      cy += r.h;
    });
  }

  // decks: Liste von Stapeln. pointsOf: Funktion, die die Stichpunkte einer Karte liefert.
  function build(decks, pointsOf) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Der PDF-Baustein konnte nicht geladen werden.');
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const bottom = PAGE_H - MARGIN - FOOTER;
    const maxCardH = bottom - MARGIN - 12;
    let y = MARGIN;
    let first = true;

    decks.forEach(deck => {
      if (!first) { doc.addPage(); y = MARGIN; }
      first = false;

      // Stapel-Überschrift
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(20, 27, 51);
      doc.text(clean(deck.name), MARGIN, y + 5);
      if (deck.subject) {
        const w = doc.getTextWidth(clean(deck.name));
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(90, 101, 131);
        doc.text(clean(' · ' + deck.subject), MARGIN + w + 1, y + 5);
      }
      y += 11;

      // Stichwortkarten zuerst, dann Lernkarten (wie in der App)
      const ordered = [...deck.cards.filter(c => c.type === 'summary'), ...deck.cards.filter(c => c.type !== 'summary')];
      const blocks = [];
      ordered.forEach(card => {
        splitTooTall(rowsOf(doc, card, pointsOf), maxCardH, card.front).forEach(rows => {
          blocks.push({ rows, h: heightOf(rows), summary: card.type === 'summary' });
        });
      });

      // Immer zwei Karten nebeneinander. Passt die Reihe nicht mehr, kommt sie auf die nächste Seite.
      for (let i = 0; i < blocks.length; i += COLS) {
        const row = blocks.slice(i, i + COLS);
        const rowH = Math.max(...row.map(b => b.h));
        if (y + rowH > bottom) {
          doc.addPage();
          y = MARGIN;
        }
        row.forEach((b, k) => drawCard(doc, b.rows, MARGIN + k * (COL_W + GAP), y, rowH, b.summary));
        y += rowH + GAP;
      }
      if (!deck.cards.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text('(keine Karten)', MARGIN, y + 4);
      }
    });

    // Seitenzahlen
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text(`Lernkiste · Seite ${p} von ${pages}`, PAGE_W / 2, PAGE_H - MARGIN + 2, { align: 'center' });
    }
    return doc.output('blob');
  }

  return { build };
})();
