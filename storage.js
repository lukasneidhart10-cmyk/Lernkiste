// storage.js – Speichern und Laden aller Daten.
// Alles bleibt im Browser auf diesem Gerät (localStorage). Es gibt keinen Server.

const Storage = (() => {
  const KEY = 'lernkiste-v1';

  // Liest den gespeicherten Zustand. Gibt null zurück, wenn noch nichts gespeichert ist
  // oder der Browser das Speichern verbietet (z. B. im privaten Modus).
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Speichert den kompletten Zustand als JSON-Text.
  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Erzeugt eine eindeutige ID aus Zeitstempel und Zufallszahl.
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Wandelt Stapel in einen Text um, den man als Datei speichern oder teilen kann.
  function exportDecks(decks) {
    return JSON.stringify({ format: 'lernkiste', version: 1, decks }, null, 2);
  }

  // Liest importierten Text. Erlaubt sind:
  // 1) eine Lernkiste-Exportdatei  {format:'lernkiste', decks:[...]}
  // 2) eine Liste von Karten        [{front:'...', back:'...'}]  (z. B. aus einem KI-Chat)
  // 3) ein Objekt mit Karten        {cards:[...]} oder {name:'...', cards:[...]}
  // Rückgabe: Liste von {name, cards:[{front, back}]}
  function parseImport(text) {
    let t = String(text || '').trim();
    // KI-Chats setzen JSON oft in ```json ... ``` – das entfernen wir.
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    // Falls vor oder nach dem JSON noch Text steht: nur den JSON-Teil nehmen.
    const start = t.search(/[\[{]/);
    const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
    if (start === -1 || end === -1) throw new Error('Kein JSON gefunden.');
    const data = JSON.parse(t.slice(start, end + 1));

    // Stichwortkarten dürfen die Rückseite als Liste schicken: ["Punkt 1", "Punkt 2"]
    const cleanCards = (list) => (Array.isArray(list) ? list : [])
      .map(c => {
        const raw = c.back ?? c.antwort ?? c.answer ?? '';
        const isList = Array.isArray(raw);
        const back = isList ? raw.map(p => '• ' + String(p).replace(/^[•\-–]\s*/, '').trim()).join('\n') : String(raw).trim();
        const front = String(c.front ?? c.frage ?? c.question ?? c.titel ?? '').trim();
        const type = (c.type === 'summary' || isList) ? 'summary' : (front.includes('_____') ? 'cloze' : 'basic');
        return { front, back, type };
      })
      .filter(c => c.front && c.back);

    if (Array.isArray(data)) return [{ name: null, cards: cleanCards(data) }];
    if (Array.isArray(data.decks)) {
      return data.decks.map(d => ({ name: d.name, subject: d.subject, color: d.color, cards: cleanCards(d.cards) }));
    }
    if (data.deck) return [{ name: data.deck.name, subject: data.deck.subject, cards: cleanCards(data.deck.cards) }];
    if (Array.isArray(data.cards)) return [{ name: data.name || null, cards: cleanCards(data.cards) }];
    throw new Error('Das Format wurde nicht erkannt.');
  }

  return { load, save, uid, exportDecks, parseImport };
})();
