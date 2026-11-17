// quiz.js – Quiz mit 4 Antwortmöglichkeiten.
// Die falschen Antworten nehmen wir von anderen Karten desselben Stapels.
// Darum braucht ein Stapel mindestens 4 Karten mit verschiedenen Antworten.

const Quiz = (() => {
  const MIN_CARDS = 4;

  // Stichwortkarten (lange Listen) eignen sich nicht als Antwortmöglichkeit und bleiben im Quiz außen vor.
  const quizCards = (deck) => deck.cards.filter(c => c.type !== 'summary');

  function canQuiz(deck) {
    return new Set(quizCards(deck).map(c => c.back.trim())).size >= MIN_CARDS;
  }

  // Baut bis zu "count" Fragen. Jede Frage: {card, options:[4 Texte], answer}
  function build(deck, count = 10) {
    if (!canQuiz(deck)) return null;
    const cards = quizCards(deck);
    return SRS.shuffle(cards).slice(0, count).map(card => {
      const answer = card.back.trim();
      // Zuerst falsche Antworten vom gleichen Kartentyp (Lückentext zu Lückentext),
      // damit die falschen Antworten nicht zu leicht zu erkennen sind.
      const sameType = cards.filter(o => o.type === card.type).map(o => o.back.trim());
      const allBacks = cards.map(o => o.back.trim());
      let pool = [...new Set(sameType)].filter(b => b !== answer);
      if (pool.length < 3) pool = [...new Set(allBacks)].filter(b => b !== answer);
      const wrong = SRS.shuffle(pool).slice(0, 3);
      return { card, answer, options: SRS.shuffle([answer, ...wrong]) };
    });
  }

  return { MIN_CARDS, canQuiz, build };
})();
