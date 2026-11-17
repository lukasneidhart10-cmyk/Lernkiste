// srs.js – Lern-Algorithmus (Spaced Repetition) nach dem Leitner-System.
//
// Idee: Jede Karte liegt in einem von 5 Fächern.
//   Gewusst       -> Karte rückt ein Fach weiter und kommt erst später wieder dran.
//   Nicht gewusst -> Karte fällt zurück in Fach 1 und kommt morgen wieder dran.
// So übt man schwierige Karten oft und leichte Karten selten.

const SRS = (() => {
  // Nach wie vielen Tagen eine Karte im jeweiligen Fach wieder fällig ist.
  const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

  // Datum als Text "JJJJ-MM-TT" (lokale Zeit). So kann man Daten einfach vergleichen.
  function dateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function today() {
    return dateStr(new Date());
  }

  function addDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }

  // Neue Karten starten in Fach 1 und sind sofort fällig.
  function newCard(front, back, type = 'basic') {
    return { id: Storage.uid(), front, back, type, box: 1, due: today(), right: 0, wrong: 0 };
  }

  function isDue(card) {
    return card.due <= today();
  }

  // Das Herz des Algorithmus: Karte nach der Antwort in ein neues Fach legen.
  function grade(card, known) {
    if (known) {
      card.box = Math.min(5, card.box + 1);
      card.right++;
    } else {
      card.box = 1;
      card.wrong++;
    }
    card.due = addDays(INTERVALS[card.box]);
  }

  // Mischt eine Liste zufällig (Fisher-Yates-Verfahren).
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Zählt, wie viele Karten in jedem Fach liegen: {1: 3, 2: 0, ...}
  function boxCounts(cards) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    cards.forEach(c => counts[c.box]++);
    return counts;
  }

  return { INTERVALS, today, addDays, dateStr, newCard, isDue, grade, shuffle, boxCounts };
})();
