// generator.js – erzeugt Karteikarten aus Text, OHNE KI.
// Das Programm sucht nach typischen Mustern in Hefteinträgen. Jede Regel ist eine eigene Funktion.
//
// Reihenfolge:
//   1. Aufzählung nach einer Überschrift   "Zellorganellen:" + "- Zellkern" ...
//   2. Doppelpunkt                          "Begriff: Erklärung"
//   3. Gleichheitszeichen                   "Begriff = Erklärung"
//   4. Gedankenstrich                       "Begriff – Erklärung"
//   5. Definitionssätze                     "X ist ...", "Als X bezeichnet man ...", "Unter X versteht man ..."
//   6. Lückentext                           ein wichtiges Wort im Satz wird durch _____ ersetzt

const Generator = (() => {
  // Füllwörter, die nie als Lücke gewählt werden (Vergleich in Kleinbuchstaben).
  const STOPWORDS = new Set(('der die das den dem des ein eine einer einem einen eines und oder aber ' +
    'nicht auch sich mit von zu im in am an auf aus bei nach vor für über unter durch gegen ohne ' +
    'um ist sind war waren wird werden wurde hat haben kann können muss müssen man es er sie wir ihr ' +
    'dies diese dieser dieses jede jeder jedes alle viele einige beispiel beispiele gegensatz ' +
    'merke wichtig hinweis aufgabe seite kapitel bild abbildung tabelle').split(' '));

  // Erkennt Aufzählungszeichen am Zeilenanfang: -, •, *, 1., 2) ...
  const BULLET = /^\s*(?:[-•*·▪●–+»]|\d+[.)])\s+/;  // "+" und "»": so liest die Texterkennung oft "•"

  // Begriffe dürfen höchstens 5 Wörter und 40 Zeichen lang sein, sonst ist es wohl kein Begriff.
  function isYear(text) {
    return /^\d{3,4}$/.test(text.trim());
  }

  function isTerm(text) {
    const t = text.trim();
    if (isYear(t)) return true;
    return t.length >= 2 && t.length <= 40 && t.split(/\s+/).length <= 5 && /[A-Za-zÄÖÜäöüß]/.test(t);
  }

  function makeCard(front, back, type, rule) {
    return { front: front.trim(), back: back.trim(), type, rule };
  }

  // Text vorbereiten: Leerzeichen vereinheitlichen und Silbentrennung am Zeilenende reparieren
  // ("Zell-\nkern" -> "Zellkern"). Das passiert bei Fotos von Buchseiten oft.
  function prepare(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/([a-zäöüß])-[ \t]*\n[ \t]*([a-zäöüß])/g, '$1$2')
      .split('\n')
      .map(l => l.replace(/[ \t]+/g, ' ').trim());
  }

  // Regel 1: Eine Zeile, die mit ":" endet, und darunter mindestens 2 Aufzählungspunkte.
  function ruleList(lines, used) {
    const cards = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(.{3,60}):$/);
      if (!m) continue;
      const items = [];
      let j = i + 1;
      while (j < lines.length && BULLET.test(lines[j])) {
        items.push(lines[j].replace(BULLET, '').trim());
        j++;
      }
      if (items.length >= 2) {
        cards.push(makeCard(`Nenne: ${m[1]}`, items.map(x => '• ' + x).join('\n'), 'basic', 'Aufzählung'));
        for (let k = i; k < j; k++) used.add(k);
      }
    }
    return cards;
  }

  // Hilfsfunktion für die Regeln 2–4: Zeile an einem Trennzeichen in Begriff und Erklärung teilen.
  function ruleSeparator(lines, used, regex, ruleName) {
    const cards = [];
    lines.forEach((line, i) => {
      if (used.has(i) || !line) return;
      const clean = line.replace(BULLET, '');
      const m = clean.match(regex);
      if (m && isTerm(m[1]) && m[2].trim().length >= 3) {
        // Jahreszahlen ("1914: Kriegsbeginn") werden zur Frage "Was geschah 1914?"
        const front = isYear(m[1]) ? `Was geschah ${m[1].trim()}?` : m[1];
        cards.push(makeCard(front, m[2], 'basic', ruleName));
        used.add(i);
      }
    });
    return cards;
  }

  // Regel 2: "Begriff: Erklärung"
  function ruleColon(lines, used) {
    return ruleSeparator(lines, used, /^([^:=]{2,40}?)\s*:\s+(.+)$/, 'Doppelpunkt');
  }

  // Regel 3: "Begriff = Erklärung"
  function ruleEquals(lines, used) {
    return ruleSeparator(lines, used, /^([^=]{2,40}?)\s*=\s*(.+)$/, 'Gleichheitszeichen');
  }

  // Regel 4: "Begriff – Erklärung" (Leerzeichen vor und nach dem Strich sind Pflicht,
  // damit Wörter wie "Zell-Atmung" nicht getrennt werden).
  function ruleDash(lines, used) {
    return ruleSeparator(lines, used, /^(.{2,40}?)\s+[-–—]\s+(.+)$/, 'Gedankenstrich');
  }

  // Wörter, mit denen ein Satz nie aufhört (Artikel, Präpositionen, Bindewörter).
  // Verben wie "werden" gehören NICHT dazu, weil deutsche Sätze oft mit dem Verb enden.
  const NO_END = new Set(('der die das den dem des ein eine einer einem einen eines und oder aber sowie ' +
    'mit von zu zum zur im in am an auf aus bei nach vor für über unter durch gegen ohne um als wie dass weil wenn ob').split(' '));

  // Gehört die nächste Zeile noch zum selben Satz? (Zeilenumbruch im Foto)
  // Ja, wenn die Zeile davor nicht mit einem Satzzeichen endet UND
  // die nächste klein anfängt oder die Zeile davor mit Komma oder z. B. "in", "und", "der" endet.
  function continuesSentence(prev, next) {
    if (!prev || /[.!?:]$/.test(prev)) return false;
    if (/^[a-zäöüß(]/.test(next)) return true;
    // Offenes Anführungszeichen ("„ankommendes" ... "Geschenk“") -> Satz geht weiter
    if ((prev.match(/[„"]/g) || []).length > (prev.match(/[“”]/g) || []).length) return true;
    if (/,$/.test(prev)) return true;
    const last = prev.split(/\s+/).pop().toLowerCase();
    return NO_END.has(last);
  }

  // Übrige Zeilen zu Sätzen zusammensetzen. Eine Zeile wird mit der nächsten verbunden,
  // wenn sie nicht mit einem Satzzeichen endet und die nächste klein anfängt (Zeilenumbruch im Foto).
  function sentences(lines, used) {
    const chunks = [];
    let current = '';
    lines.forEach((line, i) => {
      if (used.has(i) || !line) {
        if (current) chunks.push(current);
        current = '';
        return;
      }
      const text = line.replace(BULLET, '');
      if (continuesSentence(current, text) && !BULLET.test(line)) {
        current += ' ' + text;
      } else {
        if (current) chunks.push(current);
        current = text;
      }
    });
    if (current) chunks.push(current);

    return chunks.flatMap(splitSentences);
  }

  // Abkürzungen wie "z. B." oder "bzw." dürfen einen Satz nicht beenden.
  const ABBREV = /\b(n\. ?Chr|v\. ?Chr|z\. ?B|d\. ?h|u\. ?a|s\. ?o|s\. ?u|o\. ?Ä|u\. ?Ä|bzw|ca|usw|etc|Nr|Abb|vgl|evtl|ggf|sog|bspw|inkl|Jh|Mio|Mrd|Std|min|max)\./g;

  // "11. November", "50. Bundesstaat", "1. Weltkrieg": ein- oder zweistellige Zahl mit Punkt = Ordnungszahl, kein Satzende.
  // (Jahreszahlen wie "1914." dürfen einen Satz beenden.)
  const ORDINAL = /\b(\d{1,2})\.(?=\s+[A-ZÄÖÜ])/g;

  // Teilt einen Textabschnitt in Sätze. Ein Satz endet bei . ! oder ?, wenn danach ein
  // Leerzeichen und ein Großbuchstabe oder eine Zahl kommt (so bleibt "3.5" ganz).
  function splitSentences(chunk) {
    const safe = chunk
      .replace(ABBREV, m => m.replace(/\./g, '§'))
      .replace(ORDINAL, '$1§')
      .replace(/\bS\.(?=\s*\d)/g, 'S§');
    return safe
      .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9„"(])/)
      .map(s => s.replace(/§/g, '.').trim())
      .filter(Boolean);
  }

  const NOUN = "[A-ZÄÖÜ][\\wäöüßÄÖÜ-]*";
  const TERM = `(?:([Dd]er|[Dd]ie|[Dd]as|[Ee]in|[Ee]ine)\\s+)?(${NOUN}(?:\\s+${NOUN}){0,2})`;

  // Regel 5: Definitionssätze in vier Varianten.
  function ruleDefinition(sentence) {
    const s = sentence.replace(/[.!?]$/, '').trim();
    let m;

    // "Als Fotosynthese bezeichnet man die Umwandlung ..."
    if ((m = s.match(new RegExp(`^Als\\s+${TERM}\\s+(bezeichnet|nennt)\\s+man\\s+(.{5,})$`)))) {
      const article = m[1] ? m[1] + ' ' : '';
      return makeCard(`Was ${m[3]} man als ${article}${m[2]}?`, m[4], 'basic', 'Definition');
    }
    // "Unter Osmose versteht man die Diffusion ..."
    if ((m = s.match(new RegExp(`^Unter\\s+(?:(dem|der|den|einem|einer)\\s+)?(${NOUN}(?:\\s+${NOUN}){0,2})\\s+versteht\\s+man\\s+(.{5,})$`)))) {
      const article = m[1] ? m[1] + ' ' : '';
      return makeCard(`Was versteht man unter ${article}${m[2]}?`, m[3], 'basic', 'Definition');
    }
    // "Die Zellmembran ist eine dünne Hülle ..." / "Mitochondrien sind ..."
    if ((m = s.match(new RegExp(`^${TERM}\\s+(ist|sind|bezeichnet|bedeutet|beschreibt)\\s+(.{5,})$`)))) {
      const article = m[1] ? m[1].toLowerCase() + ' ' : '';
      return makeCard(`Was ${m[3]} ${article}${m[2]}?`, m[4], 'basic', 'Definition');
    }
    return null;
  }

  // Regel 6: Lückentext. Wir suchen das "wichtigste" Wort im Satz:
  // großgeschrieben (Nomen), nicht das erste Wort, kein Füllwort, mindestens 5 Buchstaben.
  // Unter den Kandidaten gewinnt das längste Wort.
  function ruleCloze(sentence) {
    const words = sentence.split(/\s+/);
    if (words.length < 6 || words.length > 40) return null;
    let best = -1;
    let bestWord = '';
    words.forEach((w, i) => {
      if (i === 0) return;
      const clean = w.replace(/^[^\wÄÖÜäöüß]+|[^\wÄÖÜäöüß]+$/g, '');
      if (clean.length < 5) return;
      if (!/^[A-ZÄÖÜ][a-zäöüß]/.test(clean)) return;
      if (STOPWORDS.has(clean.toLowerCase())) return;
      if (clean.length > bestWord.length) {
        best = i;
        bestWord = clean;
      }
    });
    if (best === -1) return null;
    const gap = words.slice();
    gap[best] = gap[best].replace(bestWord, '_____');
    return makeCard(gap.join(' '), bestWord, 'cloze', 'Lückentext');
  }

  // Hauptfunktion für LERNKARTEN: führt die eingeschalteten Regeln nacheinander aus.
  // opts: { lists: true, definitions: true, cloze: true }
  function generate(text, opts = {}) {
    const o = { lists: true, definitions: true, cloze: true, ...opts };
    const lines = prepare(text);
    const used = new Set();
    // Kopf- und Fußzeilen ("… Seite 2") werden nie zu Karten.
    lines.forEach((l, i) => { if (l && isPageFooter(l)) used.add(i); });
    const cards = [];
    if (o.lists) cards.push(...ruleList(lines, used));
    if (o.definitions) cards.push(...ruleColon(lines, used), ...ruleEquals(lines, used), ...ruleDash(lines, used));
    sentences(lines, used).forEach(s => {
      const card = (o.definitions && ruleDefinition(s)) || (o.cloze && ruleCloze(s));
      if (card) cards.push(card);
    });

    // Doppelte Karten entfernen.
    const seen = new Set();
    return cards.filter(c => {
      const key = c.front.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ================= STICHWORTKARTEN =================
  // Ziel: der GESAMTE Text landet auf Karten, nichts wird weggelassen.
  // Jede Zeile bzw. jeder Satz wird zu einem Stichpunkt. Überschriften werden zu Kartentiteln.
  // Danach werden die Stichpunkte gleichmäßig auf Karten verteilt (höchstens perCard pro Karte).

  // Wörter, die man beim Stichwort-Stil weglassen kann, ohne Inhalt zu verlieren.
  const FILLERS = /\s+(eigentlich|sozusagen|übrigens|nämlich|halt|grundsätzlich|im Prinzip|im Grunde)\b/gi;

  // Macht aus einem Satz einen kurzen Stichpunkt. Der Inhalt bleibt gleich, nur die Form wird kürzer.
  function toKeyword(sentence) {
    let s = sentence.trim().replace(/[.!]$/, '');
    const dropArticle = (t) => t.replace(/^(der|die|das|ein|eine|einer|eines|einem|einen)\s+/i, '');
    let m;
    if ((m = s.match(new RegExp(`^Als\\s+${TERM}\\s+(?:bezeichnet|nennt)\\s+man\\s+(.{3,})$`)))) return `${m[2]}: ${dropArticle(m[3])}`;
    if ((m = s.match(new RegExp(`^Unter\\s+(?:(?:dem|der|den|einem|einer)\\s+)?(${NOUN}(?:\\s+${NOUN}){0,2})\\s+versteht\\s+man\\s+(.{3,})$`)))) return `${m[1]}: ${dropArticle(m[2])}`;
    if ((m = s.match(new RegExp(`^${TERM}\\s+(?:ist|sind|bedeutet|bezeichnet)\\s+([^,].{2,})$`)))) return `${m[2]}: ${dropArticle(m[3])}`;
    if ((m = s.match(/^([^:=]{2,40}?)\s*=\s*(.+)$/)) && isTerm(m[1])) s = `${m[1].trim()}: ${m[2]}`;
    else if ((m = s.match(/^(.{2,40}?)\s+[-–—]\s+(.+)$/)) && isTerm(m[1])) s = `${m[1].trim()}: ${m[2]}`;
    s = s.replace(/^(Der|Die|Das|Ein|Eine)\s+(?=[A-ZÄÖÜ])/, '');
    return s.replace(FILLERS, '').replace(/\s{2,}/g, ' ').trim();
  }

  const words = (l) => l.trim().split(/\s+/).length;

  // Kurze Zeile ohne Satzzeichen und ohne Trennzeichen: könnte eine Überschrift sein.
  function isShortLine(l) {
    return !!l && !BULLET.test(l) && !/[.!?:;,=]$/.test(l) && !/\s[-–—=]\s|:/.test(l)
      && /^[A-ZÄÖÜ0-9]/.test(l) && words(l) <= 6;
  }

  // Normaler Text: Aufzählungspunkt, längerer Satz oder Zeile mit Satzzeichen am Ende.
  function isBodyLine(l) {
    return !!l && (BULLET.test(l) || words(l) >= 6 || /[.!?:]$/.test(l));
  }

  // Ist Zeile i eine Überschrift? Sie ist kurz und danach kommt normaler Text
  // (oder eine Unterüberschrift und dann Text). So werden Tabellenzeilen wie "Aloha Wertschätzung",
  // auf die weitere kurze Zeilen folgen, NICHT für Überschriften gehalten.
  function isHeading(lines, i) {
    const line = lines[i];
    if (/^#{1,6}\s+\S/.test(line)) return true;
    if (!isShortLine(line)) return false;
    const after = (k) => { let n = k + 1; while (n < lines.length && !lines[n]) n++; return n; };
    const n1 = after(i);
    const next = lines[n1] || '';
    const next2 = lines[after(n1)] || '';
    if (!next || /^[a-zäöüß]/.test(next)) return false;
    // Steht direkt davor eine kurze Zeile (z. B. letzte Tabellenzeile), nur einzelne Wörter als Überschrift zählen.
    const prev = lines[i - 1] || '';
    if (prev && isShortLine(prev) && words(line) > 1 && !isHeadingCandidateAbove(lines, i - 1)) return false;
    return isBodyLine(next) || (isShortLine(next) && isBodyLine(next2));
  }

  // War die Zeile darüber selbst eine Überschrift (Überschrift + Unterüberschrift)?
  function isHeadingCandidateAbove(lines, k) {
    const before = lines[k - 1] || '';
    return isShortLine(lines[k]) && (!before || /[.!?:]$/.test(before) || isBodyLine(before));
  }

  // Kopf- oder Fußzeile wie "Musik: Lernzettel zur Klassenarbeit Seite 3"
  function isPageFooter(p) {
    return /^(S\.|Seite)\s*\d+$/i.test(p.trim()) || (/\bSeite\s+\d+\s*$/.test(p) && words(p) <= 8);
  }

  // Sieht ein Stichpunkt nach echtem Inhalt aus? (Seitenzahlen o. Ä. werden nicht übernommen.)
  function isContent(p) {
    return (p.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 3 && !isPageFooter(p);
  }

  // opts: { perCard: 6, short: true, fallbackTitle: 'Zusammenfassung' }
  // Rückgabe: { cards, points (Anzahl), skipped (nicht übernommene Zeilen) }
  function summarize(text, opts = {}) {
    const o = { perCard: 6, short: true, fallbackTitle: 'Zusammenfassung', ...opts };
    const lines = prepare(text);
    const sections = [];
    const skipped = [];
    let section = { title: null, points: [] };
    let buffer = '';
    let parent = null;

    const addPoint = (p) => {
      if (!isContent(p)) { if (p.trim()) skipped.push(p.trim()); return; }
      section.points.push(o.short ? toKeyword(p) : p.trim());
    };
    const flush = () => {
      if (buffer) splitSentences(buffer).forEach(addPoint);
      buffer = '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) { flush(); continue; }
      let n = i + 1;
      while (n < lines.length && !lines[n]) n++;
      const next = lines[n] || '';
      const textLine = line.replace(BULLET, '');

      // Fußzeile ("… Seite 3"): nicht übernehmen, und eine neue Seite beginnt (Haupttitel zurücksetzen).
      if (isPageFooter(line)) {
        flush();
        skipped.push(line);
        parent = null;
        continue;
      }

      // Zeilenumbruch mitten im Satz: an den vorherigen Text anhängen.
      if (continuesSentence(buffer, textLine) && !BULLET.test(line)) {
        buffer += ' ' + textLine;
        continue;
      }

      // Überschrift: neue Karte(n) beginnen
      if (isHeading(lines, i)) {
        flush();
        const title = line.replace(/^#+\s*/, '');
        // Überschrift direkt nach Überschrift: beide zusammen bilden den Titel ("Notenlesen – Violinschlüssel").
        // Ist die erste Überschrift der Anfang des ganzen Textes, gilt sie als Haupttitel für alle Karten
        // dieser Seite ("Der Erste Weltkrieg – Ursachen", "Der Erste Weltkrieg – Verlauf").
        let combined = title;
        if (section.title && !section.points.length) {
          combined = `${section.title} – ${title}`;
          if (section.isFirst) parent = section.title;
        } else {
          if (section.points.length) sections.push(section);
          if (parent && parent !== title) combined = `${parent} – ${title}`;
        }
        const isFirst = !sections.length && !section.points.length && !section.title;
        section = { title: combined, points: [], isFirst };
        continue;
      }

      // "Überschrift:" mit Aufzählung darunter -> ein Stichpunkt "Überschrift: a, b, c"
      const listHead = line.match(/^(.{2,60}):$/);
      if (listHead && BULLET.test(next)) {
        flush();
        const items = [];
        let j = n;
        while (j < lines.length && BULLET.test(lines[j])) { items.push(lines[j].replace(BULLET, '').trim()); j++; }
        if (items.join(', ').length <= 160) {
          section.points.push(`${listHead[1]}: ${items.join(', ')}`);
        } else {
          section.points.push(`${listHead[1]}:`);
          items.forEach(it => section.points.push('– ' + it));
        }
        i = j - 1;
        continue;
      }

      flush();
      buffer = textLine;
    }
    flush();
    if (section.points.length) sections.push(section);

    // Mini-Abschnitte mit nur einem Stichpunkt ("Rhythmus" + ein Satz) werden an den vorherigen
    // Abschnitt angehängt ("Rhythmus: …"), statt eine eigene, fast leere Karte zu bekommen.
    for (let k = 1; k < sections.length; ) {
      const sec = sections[k];
      const before = sections[k - 1];
      if (sec.points.length === 1 && sec.title && before.points.length < o.perCard) {
        const p = sec.points[0];
        before.points.push(p.toLowerCase().startsWith(sec.title.toLowerCase()) ? p : `${sec.title}: ${p}`);
        sections.splice(k, 1);
      } else {
        k++;
      }
    }

    // Stichpunkte gleichmäßig verteilen: 9 Punkte bei max. 6 -> 5 + 4 statt 6 + 3.
    const cards = [];
    let total = 0;
    sections.forEach(sec => {
      const pts = sec.points;
      if (!pts.length) return;
      total += pts.length;
      const parts = Math.ceil(pts.length / o.perCard);
      const size = Math.ceil(pts.length / parts);
      for (let p = 0; p < parts; p++) {
        const chunk = pts.slice(p * size, (p + 1) * size);
        const title = (sec.title || o.fallbackTitle) + (parts > 1 ? ` (${p + 1}/${parts})` : '');
        cards.push(makeCard(title, chunk.map(x => '• ' + x).join('\n'), 'summary', 'Stichwortkarte'));
      }
    });
    return { cards, points: total, skipped };
  }

  const SAMPLE = `Die Zelle

Zellorganellen:
- Zellkern
- Mitochondrien
- Ribosomen
- Chloroplasten

Zellkern: Steuerzentrale der Zelle, enthält die Erbinformation (DNA)
Mitochondrien = Kraftwerke der Zelle, hier findet die Zellatmung statt
Ribosomen – Orte der Proteinbiosynthese
Die Zellmembran ist eine dünne Hülle, die die Zelle nach außen abgrenzt.
Als Fotosynthese bezeichnet man die Umwandlung von Lichtenergie in chemische Energie.
Unter Osmose versteht man die Diffusion von Wasser durch eine halbdurchlässige Membran.
Pflanzenzellen besitzen eine feste Zellwand, die hauptsächlich aus Cellulose besteht.
Die Chloroplasten enthalten den grünen Farbstoff Chlorophyll.`;

  return { generate, summarize, SAMPLE };
})();
