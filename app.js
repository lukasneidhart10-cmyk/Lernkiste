// app.js – Oberfläche und Navigation der Lernkiste.
// Die App hat mehrere "Ansichten" (Start, Stapel, Neu, Lernen, Quiz, Statistik ...).
// render() baut immer die aktuelle Ansicht neu auf. Klicks laufen über data-act="..." Attribute.

(() => {
  // ---------- Zustand ----------
  // state = alles, was gespeichert wird. ui = was gerade angezeigt wird (wird nicht gespeichert).
  // Standard-Einstellungen. Alles davon kann man auf der Seite "Einstellungen" ändern.
  const DEFAULT_SETTINGS = {
    mode: 'both',          // 'both' | 'summary' (Stichwortkarten) | 'learn' (Lernkarten)
    perCard: 6,            // höchstens so viele Stichpunkte pro Stichwortkarte (3–15)
    style: 'short',        // 'short' = Stichworte | 'full' = ganze Sätze
    definitions: true,     // Lernkarten: Begriffe & Definitionen
    lists: true,           // Lernkarten: Aufzählungen ("Nenne: ...")
    cloze: true,           // Lernkarten: Lückentexte
    summaryLearn: 'read',  // Stichwortkarten beim Lernen: 'read' | 'step' | 'flip'
  };

  let state = Storage.load() || seed();
  state.history = state.history || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  migrateExample();
  const ui = { view: 'home', deckId: null, cardId: null, createTab: 'photo', draftText: '', aiAnswer: '', preview: [], previewTarget: '', previewSource: 'rules', coverage: null, settingsOpen: false, ocr: null, session: null, quiz: null, exportText: '' };

  const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal'];
  const root = document.getElementById('app');

  function persist() {
    if (!Storage.save(state)) toast('Speichern nicht möglich. Ist der private Modus an?');
  }

  // Beispielstapel beim allerersten Start, damit man sofort sieht, wie die App funktioniert.
  function sampleSummaryCards() {
    return Generator.summarize(Generator.SAMPLE, { perCard: 6 }).cards.map(c => SRS.newCard(c.front, c.back, 'summary'));
  }

  // Ältere Versionen hatten im Beispielstapel noch keine Stichwortkarten.
  function migrateExample() {
    if (state.exampleV2) return;
    const ex = state.decks.find(d => d.name === 'Beispiel: Die Zelle');
    if (ex && !ex.cards.some(c => c.type === 'summary')) ex.cards.unshift(...sampleSummaryCards());
    state.exampleV2 = true;
  }

  function seed() {
    const learn = Generator.generate(Generator.SAMPLE).map((c, i) => {
      const card = SRS.newCard(c.front, c.back, c.type);
      if (i % 3 === 1) { card.box = 2; card.due = SRS.addDays(1); }
      if (i % 3 === 2) { card.box = 3; card.due = SRS.addDays(3); }
      return card;
    });
    const cards = [...sampleSummaryCards(), ...learn];
    return { decks: [{ id: Storage.uid(), name: 'Beispiel: Die Zelle', subject: 'Biologie', color: 'green', cards }], history: {}, exampleV2: true };
  }

  // ---------- Hilfsfunktionen ----------
  // Text sicher in HTML einsetzen (verhindert, dass eingegebener Text als Code ausgeführt wird).
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const deckById = (id) => state.decks.find(d => d.id === id);
  const dueCards = (deck) => deck.cards.filter(SRS.isDue);
  const totalDue = () => state.decks.reduce((n, d) => n + dueCards(d).length, 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function go(view, extra = {}) {
    Object.assign(ui, { view }, extra);
    render();
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2600);
  }

  // Eigene Sicherheitsabfrage (statt confirm(), das nicht überall funktioniert).
  function ask(message, okLabel = 'Löschen') {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
        <p>${esc(message)}</p>
        <div class="row end"><button class="btn ghost" data-r="0">Abbrechen</button><button class="btn danger" data-r="1">${esc(okLabel)}</button></div>
      </div>`;
      wrap.addEventListener('click', e => {
        const b = e.target.closest('[data-r]');
        if (!b && e.target !== wrap) return;
        wrap.remove();
        resolve(b ? b.dataset.r === '1' : false);
      });
      document.body.appendChild(wrap);
      wrap.querySelector('[data-r="1"]').focus();
    });
  }

  function logReview(known) {
    const d = SRS.today();
    const h = state.history[d] || (state.history[d] = { right: 0, wrong: 0 });
    known ? h.right++ : h.wrong++;
  }

  // Lernserie: wie viele Tage am Stück wurde gelernt (heute oder bis gestern).
  function streak() {
    let n = 0;
    const d = new Date();
    if (!state.history[SRS.dateStr(d)]) d.setDate(d.getDate() - 1);
    while (state.history[SRS.dateStr(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function cardFrontHtml(card) {
    return esc(card.front).replace('_____', '<span class="gap">_____</span>');
  }

  // Stichpunkte einer Stichwortkarte als Liste (ohne "• ").
  function pointsOf(card) {
    return card.back.split('\n').map(p => p.replace(/^[•\-–]\s*/, '').trim()).filter(Boolean);
  }

  const MODE_LABEL = { both: 'Stichwort- + Lernkarten', summary: 'Nur Stichwortkarten', learn: 'Nur Lernkarten' };

  function settingsSummary() {
    const s = state.settings;
    const parts = [MODE_LABEL[s.mode]];
    if (s.mode !== 'learn') parts.push(`${s.perCard} Infos pro Karte`, s.style === 'short' ? 'Stichworte' : 'ganze Sätze');
    return parts.join(' · ');
  }

  function radio(key, value, title, sub) {
    const s = state.settings;
    return `<label class="opt"><input type="radio" name="set-${key}" value="${value}" data-setting="${key}" ${s[key] === value ? 'checked' : ''}>
      <span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  }

  function toggle(key, title, sub) {
    return `<label class="toggle"><input type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''}>
      <span><b>${title}</b><small>${sub}</small></span><i aria-hidden="true"></i></label>`;
  }

  // Einstellungen zum Erzeugen von Karten (werden auf mehreren Seiten angezeigt).
  function settingsControls() {
    const s = state.settings;
    return `
      <fieldset class="setting"><legend>Welche Karten?</legend>
        <div class="opts">
          ${radio('mode', 'both', 'Beides', 'Stichwortkarten + Lernkarten')}
          ${radio('mode', 'summary', 'Stichwortkarten', 'Der ganze Inhalt in Stichpunkten')}
          ${radio('mode', 'learn', 'Lernkarten', 'Frage → umdrehen → Antwort')}
        </div>
      </fieldset>
      ${s.mode !== 'learn' ? `
      <fieldset class="setting"><legend>Stichwortkarten</legend>
        <label for="setPerCard" class="range-label"><span>Infos pro Karte</span><output id="perCardOut" class="tnum">${s.perCard}</output></label>
        <input type="range" id="setPerCard" min="3" max="15" step="1" value="${s.perCard}" data-setting="perCard">
        <div class="range-scale"><span>3: wenig pro Karte, mehr Karten</span><span>15: viel pro Karte</span></div>
        <div class="opts two">
          ${radio('style', 'short', 'Stichworte', '„Osmose: Diffusion von Wasser …“')}
          ${radio('style', 'full', 'Ganze Sätze', '„Unter Osmose versteht man …“')}
        </div>
        <p class="muted small">Es wird nichts weggelassen. Jeder Satz und jede Zeile wird zu einem Stichpunkt, Überschriften werden zu Kartentiteln.</p>
      </fieldset>` : ''}
      ${s.mode !== 'summary' ? `
      <fieldset class="setting"><legend>Lernkarten</legend>
        ${toggle('definitions', 'Begriffe & Definitionen', '„Zellkern: …“, „Was ist …?“, „Was versteht man unter …?“')}
        ${toggle('lists', 'Aufzählungen', '„Nenne: Zellorganellen“')}
        ${toggle('cloze', 'Lückentexte', 'Ein wichtiges Wort im Satz wird abgedeckt')}
      </fieldset>` : ''}`;
  }

  function learnControls() {
    return `
      <fieldset class="setting"><legend>Stichwortkarten beim Lernen</legend>
        <div class="opts">
          ${radio('summaryLearn', 'read', 'Durchlesen', 'Alle Stichpunkte sind sofort sichtbar')}
          ${radio('summaryLearn', 'step', 'Punkt für Punkt', 'Du deckst einen Stichpunkt nach dem anderen auf')}
          ${radio('summaryLearn', 'flip', 'Abfragen', 'Erst nur das Thema, dann alles aufdecken')}
        </div>
      </fieldset>`;
  }

  // Erzeugt Karten aus Text, so wie es in den Einstellungen steht.
  function buildCards(text) {
    const s = state.settings;
    const cards = [];
    ui.coverage = null;
    if (s.mode !== 'learn') {
      const result = Generator.summarize(text, { perCard: s.perCard, short: s.style === 'short' });
      ui.coverage = { points: result.points, skipped: result.skipped };
      cards.push(...result.cards);
    }
    if (s.mode !== 'summary') {
      cards.push(...Generator.generate(text, { definitions: s.definitions, lists: s.lists, cloze: s.cloze }));
    }
    return cards;
  }

  function settingsDetails() {
    return `<details class="settings-inline" ${ui.settingsOpen ? 'open' : ''}>
      <summary><span class="sd-title">Einstellungen</span><span class="muted small">${esc(settingsSummary())}</span></summary>
      <div class="stack">${settingsControls()}</div>
    </details>`;
  }

  function boxBar(cards) {
    const counts = SRS.boxCounts(cards);
    const total = cards.length || 1;
    return `<div class="boxbar" aria-label="Verteilung auf die Fächer">${[1, 2, 3, 4, 5]
      .map(b => counts[b] ? `<span class="b${b}" style="flex:${counts[b] / total}" title="Fach ${b}: ${counts[b]}"></span>` : '').join('')}</div>`;
  }

  // ---------- Ansichten ----------
  const views = {
    home() {
      const due = totalDue();
      const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
      return `
        <header class="top home-top">
          <div><p class="eyebrow">${esc(date)}</p><h1>Lernkiste</h1></div>
          <button class="icon-btn gear" data-act="go" data-view="settings" aria-label="Einstellungen" title="Einstellungen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>
          </button>
        </header>
        <section class="hero-card">
          <div>
            <p class="big tnum">${due}</p>
            <p>${due === 1 ? 'Karte ist' : 'Karten sind'} heute fällig</p>
          </div>
          ${due ? `<button class="btn primary" data-act="learnAll">Jetzt lernen</button>` : `<p class="muted small">Alles erledigt. Morgen geht's weiter.</p>`}
        </section>
        <section class="stack">
          <div class="sec-head"><h2>Deine Stapel</h2><button class="btn small" data-act="newDeck">+ Stapel</button></div>
          ${state.decks.length ? `<div class="deck-grid">${state.decks.map(d => `
            <button class="deck" data-act="openDeck" data-id="${d.id}" style="--deck: var(--c-${esc(d.color)})">
              <span class="deck-tab">${esc(d.subject || 'Allgemein')}</span>
              <strong>${esc(d.name)}</strong>
              <span class="muted small">${plural(d.cards.length, 'Karte', 'Karten')} · <b class="${dueCards(d).length ? 'due' : ''}">${dueCards(d).length} fällig</b></span>
              ${boxBar(d.cards)}
            </button>`).join('')}</div>`
            : `<div class="empty"><p>Noch keine Stapel. Fotografiere einen Hefteintrag oder lege einen Stapel an.</p><button class="btn primary" data-act="go" data-view="create">Karten aus Foto erstellen</button></div>`}
        </section>
        <p class="note">Deine Karten sind nur auf diesem Gerät gespeichert. <button class="link" data-act="go" data-view="data">Sichern, teilen &amp; installieren</button></p>`;
    },

    deck() {
      const d = deckById(ui.deckId);
      if (!d) return views.home();
      const due = dueCards(d).length;
      const counts = SRS.boxCounts(d.cards);
      return `
        <header class="top with-back">
          <button class="back" data-act="go" data-view="home" aria-label="Zurück">‹ Stapel</button>
          <p class="eyebrow" style="color: var(--c-${esc(d.color)})">${esc(d.subject || 'Allgemein')}</p>
          <h1>${esc(d.name)}</h1>
        </header>
        <div class="actions">
          <button class="btn primary" data-act="learnDeck" ${due ? '' : 'disabled'}>Lernen <span class="pill">${due}</span></button>
          <button class="btn" data-act="startQuiz" ${Quiz.canQuiz(d) ? '' : 'disabled'}>Quiz</button>
          <button class="btn" data-act="practiceAll" ${d.cards.length ? '' : 'disabled'}>Alle üben</button>
          ${d.cards.some(c => c.type === 'summary') ? `<button class="btn" data-act="readDeck">Lesen</button>` : ''}
        </div>
        ${!Quiz.canQuiz(d) && d.cards.length ? `<p class="muted small">Für das Quiz braucht der Stapel mindestens ${Quiz.MIN_CARDS} Karten mit verschiedenen Antworten.</p>` : ''}
        <section class="boxes" aria-label="Leitner-Fächer">
          ${[1, 2, 3, 4, 5].map(b => `<div class="box b${b}"><span class="tnum">${counts[b]}</span><small>Fach ${b}</small></div>`).join('')}
        </section>
        <div class="sec-head"><h2>${plural(d.cards.length, 'Karte', 'Karten')}</h2>
          <div class="row"><button class="btn small" data-act="go" data-view="create" data-target="${d.id}">Aus Foto/Text</button><button class="btn small" data-act="newCard">+ Karte</button></div>
        </div>
        <ul class="card-list">
          ${d.cards.map(c => `
            <li>
              <span class="badge b${c.box}" title="Fach ${c.box}">${c.box}</span>
              <div class="cl-text">${c.type === 'summary' ? '<span class="chip">Stichwortkarte</span>' : ''}<p class="cl-front">${cardFrontHtml(c)}</p><p class="cl-back muted">${esc(c.back)}</p></div>
              <div class="cl-btns">
                <button class="icon-btn" data-act="editCard" data-id="${c.id}" aria-label="Bearbeiten">✎</button>
                <button class="icon-btn" data-act="deleteCard" data-id="${c.id}" aria-label="Löschen">✕</button>
              </div>
            </li>`).join('') || '<li class="muted">Noch keine Karten in diesem Stapel.</li>'}
        </ul>
        <div class="row wrap foot-actions">
          <button class="btn ghost small" data-act="editDeck">Stapel bearbeiten</button>
          <button class="btn ghost small" data-act="exportDeck">Exportieren</button>
          <button class="btn ghost small danger-text" data-act="deleteDeck">Stapel löschen</button>
        </div>`;
    },

    deckForm() {
      const d = ui.deckId ? deckById(ui.deckId) : null;
      const color = d ? d.color : 'blue';
      return `
        <header class="top with-back">
          <button class="back" data-act="${d ? 'openDeck' : 'go'}" data-view="home" data-id="${d ? d.id : ''}">‹ Zurück</button>
          <h1>${d ? 'Stapel bearbeiten' : 'Neuer Stapel'}</h1>
        </header>
        <form class="form" data-form="deck">
          <label for="deckName">Name</label>
          <input id="deckName" name="name" required maxlength="60" value="${esc(d ? d.name : '')}" placeholder="z. B. Bio – Die Zelle">
          <label for="deckSubject">Fach</label>
          <input id="deckSubject" name="subject" maxlength="30" value="${esc(d ? d.subject : '')}" placeholder="z. B. Biologie">
          <fieldset><legend>Farbe</legend><div class="swatches">
            ${COLORS.map(c => `<label class="swatch" style="--deck: var(--c-${c})"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span></span><span class="sr">${c}</span></label>`).join('')}
          </div></fieldset>
          <button class="btn primary" type="submit">Speichern</button>
        </form>`;
    },

    cardForm() {
      const d = deckById(ui.deckId);
      const c = ui.cardId ? d.cards.find(x => x.id === ui.cardId) : null;
      return `
        <header class="top with-back">
          <button class="back" data-act="openDeck" data-id="${d.id}">‹ ${esc(d.name)}</button>
          <h1>${c ? 'Karte bearbeiten' : 'Neue Karte'}</h1>
        </header>
        <form class="form" data-form="card">
          <label for="cardFront">Vorderseite (Frage oder Begriff)</label>
          <textarea id="cardFront" name="front" required rows="3">${esc(c ? c.front : '')}</textarea>
          <label for="cardBack">Rückseite (Antwort)</label>
          <textarea id="cardBack" name="back" required rows="4">${esc(c ? c.back : '')}</textarea>
          <p class="muted small">Tipp: Schreibe _____ (fünf Unterstriche) in die Vorderseite, dann wird es ein Lückentext.</p>
          <button class="btn primary" type="submit">Speichern</button>
        </form>`;
    },

    create() {
      const tab = ui.createTab;
      const tabs = [['photo', 'Foto'], ['text', 'Text'], ['ai', 'KI-Chat']];
      let body = '';
      if (tab === 'photo') {
        const o = ui.ocr;
        body = `
          <p>Fotografiere einen Hefteintrag, ein Arbeitsblatt oder eine Buchseite. Der Text wird direkt auf deinem Gerät gelesen.</p>
          <div class="row wrap">
            <label class="btn primary file-btn">Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-ocr></label>
            <label class="btn file-btn">Bild auswählen<input type="file" accept="image/*" data-ocr></label>
          </div>
          ${o ? `<div class="ocr-box">
            ${o.preview ? `<img src="${o.preview}" alt="Ausgewähltes Foto">` : ''}
            <div class="ocr-status">
              <p>${esc(o.status)}${o.error ? '' : ` <span class="tnum">${Math.round(o.progress * 100)} %</span>`}</p>
              ${o.error ? `<p class="error">${esc(o.error)}</p>` : `<div class="progress"><span style="width:${Math.round(o.progress * 100)}%"></span></div>`}
            </div>
          </div>` : ''}
          <ul class="tips">
            <li>Gerade von oben fotografieren, gutes Licht, kein Schatten.</li>
            <li>Gedruckter Text klappt am besten. Handschrift wird oft nicht richtig erkannt.</li>
            <li>Beim ersten Mal werden die deutschen Sprachdaten geladen (ca. 1,3 MB).</li>
          </ul>`;
      } else if (tab === 'text') {
        body = `
          <label for="srcText">Lerntext</label>
          <textarea id="srcText" rows="12" data-draft placeholder="Text hier einfügen oder eintippen …">${esc(ui.draftText)}</textarea>
          ${settingsDetails()}
          <div class="row wrap">
            <button class="btn primary" data-act="generate">Karten erzeugen</button>
            <button class="btn ghost" data-act="sampleText">Beispieltext einfügen</button>
          </div>
          <details class="rules"><summary>Welche Muster erkennt die App?</summary>
            <table>
              <tr><td><code>Begriff: Erklärung</code></td><td>Karte Begriff → Erklärung</td></tr>
              <tr><td><code>Begriff = Erklärung</code></td><td>Karte Begriff → Erklärung</td></tr>
              <tr><td><code>Begriff – Erklärung</code></td><td>Karte Begriff → Erklärung</td></tr>
              <tr><td><code>X ist / sind …</code></td><td>„Was ist X?“</td></tr>
              <tr><td><code>Als X bezeichnet man …</code></td><td>„Was bezeichnet man als X?“</td></tr>
              <tr><td><code>Unter X versteht man …</code></td><td>„Was versteht man unter X?“</td></tr>
              <tr><td><code>Überschrift:</code> + Aufzählung</td><td>„Nenne: Überschrift“</td></tr>
              <tr><td>andere Sätze</td><td>Lückentext mit dem wichtigsten Nomen</td></tr>
            </table>
          </details>`;
      } else {
        body = `
          <p>Ohne KI klappt es schon gut. Wenn du an deiner Schule einen KI-Chat nutzen darfst (zum Beispiel fobizz), bekommst du damit oft bessere Karten. Kostenlos und ohne Schlüssel, du kopierst nur hin und her.</p>
          <ol class="steps">
            <li><label for="srcTextAi">Lerntext einfügen</label>
              <textarea id="srcTextAi" rows="6" data-draft placeholder="Text hier einfügen …">${esc(ui.draftText)}</textarea></li>
            <li>Auftrag kopieren und im KI-Chat einfügen
              <div class="row"><button class="btn" data-act="copyPrompt">Auftrag kopieren</button></div>
              <textarea id="aiPrompt" rows="4" readonly class="mono">${esc(aiPrompt(ui.draftText))}</textarea></li>
            <li><label for="aiAnswer">Antwort des KI-Chats hier einfügen</label>
              <textarea id="aiAnswer" rows="5" class="mono" data-ai placeholder='[{"front": "...", "back": "..."}]'>${esc(ui.aiAnswer)}</textarea>
              <button class="btn primary" data-act="importAi">Karten übernehmen</button></li>
          </ol>
          <p class="muted small">Prüfe die Karten der KI immer. KI-Chats machen manchmal Fehler.</p>`;
      }
      return `
        <header class="top"><p class="eyebrow">Neue Karten</p><h1>Aus Foto oder Text</h1></header>
        <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>
        <section class="stack">${body}</section>`;
    },

    preview() {
      const n = ui.preview.filter(c => c.keep).length;
      const target = ui.previewTarget || (state.decks[0] ? state.decks[0].id : 'new');
      const item = (c, i) => `
        <li class="${c.keep ? '' : 'off'} ${c.type === 'summary' ? 'pv-summary' : ''}">
          <div class="pv-head">
            <label class="check"><input type="checkbox" data-pv="${i}" data-field="keep" ${c.keep ? 'checked' : ''}> übernehmen</label>
            <span class="chip">${esc(c.rule)}</span>
          </div>
          <label class="sr" for="pvf${i}">${c.type === 'summary' ? 'Titel' : 'Vorderseite'}</label>
          <textarea id="pvf${i}" rows="${c.type === 'summary' ? 1 : 2}" data-pv="${i}" data-field="front" class="${c.type === 'summary' ? 'pv-title' : ''}">${esc(c.front)}</textarea>
          <label class="sr" for="pvb${i}">${c.type === 'summary' ? 'Stichpunkte' : 'Rückseite'}</label>
          <textarea id="pvb${i}" rows="${Math.min(16, c.back.split('\n').length + 1)}" data-pv="${i}" data-field="back">${esc(c.back)}</textarea>
        </li>`;
      const group = (isSummary, title, hint) => {
        const idx = ui.preview.map((c, i) => i).filter(i => (ui.preview[i].type === 'summary') === isSummary);
        if (!idx.length) return '';
        return `<section class="stack">
          <div class="sec-head"><h2>${title} <span class="muted tnum">${idx.length}</span></h2></div>
          ${hint ? `<p class="muted small">${hint}</p>` : ''}
          <ul class="preview-list">${idx.map(i => item(ui.preview[i], i)).join('')}</ul>
        </section>`;
      };

      // Vollständigkeit: stehen alle Stichpunkte aus dem Text auf (ausgewählten) Stichwortkarten?
      let coverage = '';
      if (ui.coverage && ui.previewSource === 'rules') {
        const kept = ui.preview.filter(c => c.type === 'summary' && c.keep).reduce((sum, c) => sum + pointsOf(c).length, 0);
        const all = ui.coverage.points;
        const ok = kept >= all;
        coverage = `<div class="coverage ${ok ? 'ok' : 'warn'}">
          <b>${ok ? '✓ Vollständig' : '⚠ Nicht vollständig'}</b>
          <span>${ok
            ? `Alle ${all} Stichpunkte aus deinem Text stehen auf den Stichwortkarten.`
            : `${all - kept} von ${all} Stichpunkten fehlen, weil Stichwortkarten abgewählt oder gekürzt sind.`}</span>
          ${ui.coverage.skipped.length ? `<small>Nicht übernommen, weil es nicht nach Inhalt aussieht: ${ui.coverage.skipped.map(x => '„' + esc(x) + '“').join(', ')}</small>` : ''}
        </div>`;
      }

      return `
        <header class="top with-back">
          <button class="back" data-act="go" data-view="create">‹ Zurück</button>
          <p class="eyebrow">Vorschau</p>
          <h1>${plural(ui.preview.length, 'Karte', 'Karten')} erstellt</h1>
        </header>
        ${ui.previewSource === 'rules' ? settingsDetails() : ''}
        ${ui.previewSource === 'rules' && ui.settingsOpen ? '<p class="muted small">Änderst du eine Einstellung, werden die Karten sofort neu erzeugt. Eigene Änderungen in der Vorschau gehen dabei verloren.</p>' : ''}
        ${coverage}
        ${ui.preview.length ? '' : `<div class="empty"><p>Im Text wurden keine passenden Muster gefunden. Probiere Zeilen wie „Begriff: Erklärung“ oder lege Karten von Hand an.</p></div>`}
        ${group(true, 'Stichwortkarten', 'Der Inhalt zum Durchlesen und Wiederholen. Ein Stichpunkt pro Zeile.')}
        ${group(false, 'Lernkarten', 'Frage oder Lückentext vorne, Antwort hinten.')}
        ${ui.preview.length ? `<div class="save-bar">
          <label for="pvTarget">Speichern in</label>
          <select id="pvTarget" data-pvtarget>
            ${state.decks.map(d => `<option value="${d.id}" ${d.id === target ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
            <option value="new" ${target === 'new' ? 'selected' : ''}>Neuer Stapel …</option>
          </select>
          ${target === 'new' ? `<label for="pvNewName">Name des neuen Stapels</label><input id="pvNewName" value="${esc(ui.previewNewName || '')}" data-pvname placeholder="z. B. Bio – Die Zelle">` : ''}
          <button class="btn primary" data-act="savePreview" ${n ? '' : 'disabled'}>${plural(n, 'Karte', 'Karten')} speichern</button>
        </div>` : ''}`;
    },

    learnPick() {
      const due = totalDue();
      return `
        <header class="top"><p class="eyebrow">Lernen</p><h1>Was willst du üben?</h1></header>
        <button class="btn primary wide" data-act="learnAll" ${due ? '' : 'disabled'}>Alle fälligen Karten <span class="pill">${due}</span></button>
        <ul class="pick-list">
          ${state.decks.map(d => `
            <li style="--deck: var(--c-${esc(d.color)})">
              <div><strong>${esc(d.name)}</strong><span class="muted small">${dueCards(d).length} fällig · ${d.cards.length} gesamt</span></div>
              <div class="row">
                <button class="btn small" data-act="learnDeck" data-id="${d.id}" ${dueCards(d).length ? '' : 'disabled'}>Lernen</button>
                <button class="btn small ghost" data-act="startQuiz" data-id="${d.id}" ${Quiz.canQuiz(d) ? '' : 'disabled'}>Quiz</button>
              </div>
            </li>`).join('')}
        </ul>`;
    },

    session() {
      const s = ui.session;
      if (s.idx >= s.queue.length) {
        const total = s.right + s.wrong;
        const rate = total ? Math.round((s.right / total) * 100) : 0;
        return `
          <header class="top"><p class="eyebrow">Geschafft</p><h1>Lerneinheit beendet</h1></header>
          <section class="result">
            <p class="big tnum">${rate} %</p>
            <p>${s.right} gewusst · ${s.wrong} nicht gewusst</p>
            <p class="muted small">Nicht gewusste Karten liegen wieder in Fach 1 und kommen morgen dran.</p>
          </section>
          <div class="row wrap"><button class="btn primary" data-act="go" data-view="home">Zur Startseite</button><button class="btn" data-act="go" data-view="stats">Statistik ansehen</button></div>`;
      }
      const item = s.queue[s.idx];
      const card = deckById(item.deckId).cards.find(c => c.id === item.cardId);
      const top = `
        <header class="top with-back session-top">
          <button class="back" data-act="endSession">✕ Beenden</button>
          <span class="tnum muted">${s.idx + 1} / ${s.queue.length}</span>
        </header>
        <div class="progress"><span style="width:${(s.idx / s.queue.length) * 100}%"></span></div>
        ${item.retry ? '<p class="chip retry">Wiederholung</p>' : ''}`;

      // Stichwortkarte: je nach Einstellung sofort lesen, Punkt für Punkt aufdecken oder abfragen.
      if (card.type === 'summary') {
        const points = pointsOf(card);
        const mode = state.settings.summaryLearn;
        if (s.revealed == null) s.revealed = mode === 'read' ? points.length : 0;
        const done = s.revealed >= points.length;
        return `${top}
          <article class="readcard ${done ? '' : 'tappable'}" ${done ? '' : 'data-act="reveal" tabindex="0"'}>
            <span class="face-label">Stichwortkarte · Fach ${card.box} · ${points.length} Punkte</span>
            <h2>${esc(card.front)}</h2>
            <ul class="points">${points.map((p, i) => i < s.revealed
              ? `<li>${esc(p)}</li>`
              : `<li class="pt-hidden"><span></span><span class="sr">verdeckt</span></li>`).join('')}</ul>
            ${done ? '' : `<span class="hint">${mode === 'step' ? 'Tippen für den nächsten Punkt' : 'Weißt du alle Punkte? Tippen zum Aufdecken'}</span>`}
          </article>
          <div class="grade-row">${done
            ? `<button class="btn bad" data-act="grade" data-known="0">Nochmal anschauen</button><button class="btn good" data-act="grade" data-known="1">Sitzt</button>`
            : mode === 'step'
              ? `<button class="btn" data-act="revealAll">Alle zeigen</button><button class="btn primary" data-act="reveal" style="flex:1">Nächster Punkt</button>`
              : `<button class="btn primary wide" data-act="revealAll">Aufdecken</button>`}
          </div>`;
      }

      return `${top}
        <div class="flash-wrap">
          <div class="flashcard ${s.flipped ? 'flipped' : ''}" id="flashcard" tabindex="0" aria-label="Karte, tippen zum Umdrehen">
            <div class="face front"><span class="face-label">Frage · Fach ${card.box}</span><p>${cardFrontHtml(card)}</p><span class="hint">Tippen zum Umdrehen</span></div>
            <div class="face back"><span class="face-label">Antwort</span><p>${esc(card.back)}</p><span class="hint">Wischen: links = nicht gewusst · rechts = gewusst</span></div>
          </div>
        </div>
        <div class="grade-row">
          ${s.flipped
            ? `<button class="btn bad" data-act="grade" data-known="0">Nicht gewusst</button><button class="btn good" data-act="grade" data-known="1">Gewusst</button>`
            : `<button class="btn primary wide" data-act="flip">Umdrehen</button>`}
        </div>`;
    },

    quiz() {
      const q = ui.quiz;
      if (q.idx >= q.questions.length) {
        return `
          <header class="top"><p class="eyebrow">Quiz beendet</p><h1>${q.score} von ${q.questions.length} richtig</h1></header>
          <section class="result"><p class="big tnum">${Math.round((q.score / q.questions.length) * 100)} %</p></section>
          <div class="row wrap"><button class="btn primary" data-act="startQuiz" data-id="${q.deckId}">Nochmal</button><button class="btn" data-act="openDeck" data-id="${q.deckId}">Zum Stapel</button></div>`;
      }
      const item = q.questions[q.idx];
      return `
        <header class="top with-back session-top">
          <button class="back" data-act="openDeck" data-id="${q.deckId}">✕ Beenden</button>
          <span class="tnum muted">Frage ${q.idx + 1} / ${q.questions.length} · ${q.score} Punkte</span>
        </header>
        <div class="progress"><span style="width:${(q.idx / q.questions.length) * 100}%"></span></div>
        <section class="quiz-q"><p>${cardFrontHtml(item.card)}</p></section>
        <div class="options">
          ${item.options.map((o, i) => {
            let cls = '';
            if (q.chosen !== null) {
              if (o === item.answer) cls = 'correct';
              else if (i === q.chosen) cls = 'wrong';
            }
            return `<button class="option ${cls}" data-act="answer" data-i="${i}" ${q.chosen !== null ? 'disabled' : ''}>${esc(o)}</button>`;
          }).join('')}
        </div>
        ${q.chosen !== null ? `<button class="btn primary wide" data-act="nextQuestion">${q.idx + 1 < q.questions.length ? 'Weiter' : 'Ergebnis'}</button>` : ''}`;
    },

    read() {
      const d = deckById(ui.deckId);
      const cards = d.cards.filter(c => c.type === 'summary');
      return `
        <header class="top with-back">
          <button class="back" data-act="openDeck" data-id="${d.id}">‹ ${esc(d.name)}</button>
          <p class="eyebrow">Zusammenfassung · ${plural(cards.length, 'Stichwortkarte', 'Stichwortkarten')}</p>
          <h1>${esc(d.name)}</h1>
        </header>
        ${cards.map((c, i) => `
          <article class="readcard">
            <span class="face-label tnum">${i + 1} / ${cards.length}</span>
            <h2>${esc(c.front)}</h2>
            <ul class="points">${pointsOf(c).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          </article>`).join('')}`;
    },

    settings() {
      return `
        <header class="top with-back">
          <button class="back" data-act="go" data-view="home">‹ Start</button>
          <h1>Einstellungen</h1>
        </header>
        <section class="stack">
          <h2>Karten erzeugen</h2>
          <p class="muted small">Gilt, wenn du aus einem Foto oder Text Karten erstellst.</p>
          ${settingsControls()}
        </section>
        <section class="stack">
          <h2>Lernen</h2>
          ${learnControls()}
        </section>
        <section class="stack">
          <h2>Daten</h2>
          <button class="btn" data-act="go" data-view="data">Sichern, teilen &amp; installieren</button>
        </section>`;
    },

    stats() {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = SRS.dateStr(d);
        const h = state.history[key] || { right: 0, wrong: 0 };
        days.push({ label: d.toLocaleDateString('de-DE', { weekday: 'short' }), ...h });
      }
      const right = days.reduce((n, d) => n + d.right, 0);
      const wrong = days.reduce((n, d) => n + d.wrong, 0);
      const max = Math.max(1, ...days.map(d => d.right + d.wrong));
      const allCards = state.decks.flatMap(d => d.cards);
      return `
        <header class="top"><p class="eyebrow">Statistik</p><h1>Dein Fortschritt</h1></header>
        <section class="tiles">
          <div class="tile"><span class="tnum">${streak()}</span><small>Tage Lernserie</small></div>
          <div class="tile"><span class="tnum">${right + wrong ? Math.round((right / (right + wrong)) * 100) + ' %' : '–'}</span><small>richtig (7 Tage)</small></div>
          <div class="tile"><span class="tnum">${allCards.length}</span><small>Karten gesamt</small></div>
        </section>
        <section class="stack">
          <h2>Wiederholungen der letzten 7 Tage</h2>
          <div class="week">
            ${days.map(d => `<div class="day"><div class="day-bar" title="${d.right} richtig, ${d.wrong} falsch">
              <span class="w" style="height:${(d.wrong / max) * 100}%"></span><span class="r" style="height:${(d.right / max) * 100}%"></span>
            </div><small>${esc(d.label)}</small><small class="tnum muted">${d.right + d.wrong}</small></div>`).join('')}
          </div>
          <p class="legend"><span class="key r"></span>gewusst <span class="key w"></span>nicht gewusst</p>
        </section>
        <section class="stack">
          <h2>Fächer pro Stapel</h2>
          ${state.decks.map(d => `<div class="deck-stat"><div class="row between"><strong>${esc(d.name)}</strong><span class="muted small tnum">${d.cards.length}</span></div>${boxBar(d.cards)}</div>`).join('') || '<p class="muted">Noch keine Stapel.</p>'}
          <p class="legend">${[1, 2, 3, 4, 5].map(b => `<span class="key b${b}"></span>Fach ${b}`).join(' ')}</p>
        </section>
        <section class="stack explain">
          <h2>So funktioniert das Leitner-System</h2>
          <p>Jede Karte liegt in einem von fünf Fächern. Weißt du die Antwort, rückt sie ein Fach weiter und kommt erst später wieder. Weißt du sie nicht, fällt sie zurück in Fach 1.</p>
          <table class="intervals">
            <tr><th>Fach</th>${[1, 2, 3, 4, 5].map(b => `<td><span class="badge b${b}">${b}</span></td>`).join('')}</tr>
            <tr><th>wieder nach</th>${[1, 2, 3, 4, 5].map(b => `<td class="tnum">${plural(SRS.INTERVALS[b], 'Tag', 'Tagen')}</td>`).join('')}</tr>
          </table>
        </section>`;
    },

    data() {
      return `
        <header class="top with-back">
          <button class="back" data-act="go" data-view="home">‹ Start</button>
          <h1>Sichern &amp; teilen</h1>
        </header>
        <section class="stack">
          <h2>Exportieren</h2>
          <p>Deine Karten liegen nur in diesem Browser. Speichere regelmäßig eine Sicherung oder schicke die Datei an Mitschüler.</p>
          <div class="row wrap">
            <button class="btn primary" data-act="exportAll">Alle Stapel exportieren</button>
          </div>
          ${ui.exportText ? `
            <textarea id="exportBox" rows="6" readonly class="mono">${esc(ui.exportText)}</textarea>
            <div class="row wrap"><button class="btn" data-act="copyExport">Text kopieren</button><button class="btn" data-act="downloadExport">Als Datei speichern</button></div>` : ''}
        </section>
        <section class="stack">
          <h2>Importieren</h2>
          <label class="btn file-btn">Datei auswählen<input type="file" accept=".json,application/json,text/plain" data-import></label>
          <label for="importBox">oder Text einfügen</label>
          <textarea id="importBox" rows="4" class="mono" placeholder='{"format": "lernkiste", ...}'></textarea>
          <button class="btn" data-act="importText">Importieren</button>
        </section>
        <section class="stack">
          <h2>Als App installieren</h2>
          <p><strong>iPhone (Safari):</strong> Teilen-Symbol antippen, dann „Zum Home-Bildschirm“.</p>
          <p><strong>Android (Chrome):</strong> Menü ⋮ antippen, dann „App installieren“ oder „Zum Startbildschirm hinzufügen“.</p>
          <p class="muted small">Danach startet die Lernkiste wie eine normale App, auch ohne Internet.</p>
        </section>
        <section class="stack">
          <button class="btn ghost danger-text" data-act="resetAll">Alle Daten löschen</button>
        </section>`;
    },
  };

  // Auftrag für einen KI-Chat (fobizz, ChatGPT, …). Die Antwort kann direkt importiert werden.
  function aiPrompt(text) {
    const st = state.settings;
    const parts = [];
    if (st.mode !== 'learn') {
      parts.push(`STICHWORTKARTEN (type "summary"): Fasse den GESAMTEN Lerntext ${st.style === 'short' ? 'stichwortartig' : 'in ganzen Sätzen'} zusammen. Lass KEINE Information weg. Ordne nach Themen. Vorderseite = Thema, Rückseite = Liste der Stichpunkte, höchstens ${st.perCard} Stichpunkte pro Karte (bei mehr Inhalt mehrere Karten zum selben Thema).`);
    }
    if (st.mode !== 'summary') {
      parts.push('LERNKARTEN (type "qa"): 8 bis 20 Karten, jede Karte fragt genau eine Sache ab. Vorderseite = klare Frage, Rückseite = kurze, richtige Antwort.');
    }
    const example = [
      st.mode !== 'learn' ? '{"type": "summary", "front": "Thema", "back": ["Stichpunkt 1", "Stichpunkt 2"]}' : '',
      st.mode !== 'summary' ? '{"type": "qa", "front": "Frage", "back": "Antwort"}' : '',
    ].filter(Boolean).join(', ');
    return `Erstelle aus dem folgenden Lerntext Karteikarten für eine Klassenarbeit.
${parts.map((p, i) => `${i + 1}. ${p}`).join('\n')}
Verwende nur Inhalte aus dem Text, erfinde nichts dazu.
Antworte NUR mit JSON in genau diesem Format, ohne weiteren Text:
[${example}]

Lerntext:
"""
${text.trim() || '(hier deinen Lerntext einfügen)'}
"""`;
  }

  // ---------- Aktionen (Klicks) ----------
  function startSession(decks, onlyDue = true) {
    // Erst die Stichwortkarten in ihrer Reihenfolge (Stoff durchgehen), dann die Lernkarten gemischt (abfragen).
    const summary = [];
    const learn = [];
    decks.forEach(d => (onlyDue ? dueCards(d) : d.cards).forEach(c => {
      (c.type === 'summary' ? summary : learn).push({ deckId: d.id, cardId: c.id, retry: false });
    }));
    const queue = [...summary, ...SRS.shuffle(learn)];
    if (!queue.length) return toast('Keine fälligen Karten.');
    go('session', { session: { queue, idx: 0, flipped: false, revealed: null, right: 0, wrong: 0 } });
  }

  function flip() {
    ui.session.flipped = !ui.session.flipped;
    const el = document.getElementById('flashcard');
    if (el) el.classList.toggle('flipped', ui.session.flipped);
    // Nur die Buttons neu zeichnen, damit die Umdreh-Animation sichtbar bleibt.
    const row = root.querySelector('.grade-row');
    if (row) row.innerHTML = ui.session.flipped
      ? `<button class="btn bad" data-act="grade" data-known="0">Nicht gewusst</button><button class="btn good" data-act="grade" data-known="1">Gewusst</button>`
      : `<button class="btn primary wide" data-act="flip">Umdrehen</button>`;
  }

  function grade(known) {
    const s = ui.session;
    const item = s.queue[s.idx];
    const card = deckById(item.deckId).cards.find(c => c.id === item.cardId);
    if (!item.retry) {
      SRS.grade(card, known);
      logReview(known);
      known ? s.right++ : s.wrong++;
      // Nicht gewusste Karten kommen am Ende dieser Lerneinheit noch einmal.
      if (!known) s.queue.push({ ...item, retry: true });
      persist();
    }
    s.idx++;
    s.flipped = false;
    s.revealed = null;
    render();
  }

  function currentCard() {
    const s = ui.session;
    if (!s || s.idx >= s.queue.length) return null;
    const item = s.queue[s.idx];
    return deckById(item.deckId).cards.find(c => c.id === item.cardId);
  }

  // Stichwortkarte: nächsten Punkt (oder bei "Abfragen" alle Punkte) aufdecken.
  function reveal(all = false) {
    const card = currentCard();
    if (!card) return;
    const n = pointsOf(card).length;
    ui.session.revealed = (all || state.settings.summaryLearn === 'flip') ? n : Math.min(n, (ui.session.revealed || 0) + 1);
    render();
  }

  async function runOcr(file) {
    ui.ocr = { progress: 0, status: 'Bild wird geladen', preview: '', error: '' };
    try {
      const canvas = await OCR.prepareImage(file);
      ui.ocr.preview = canvas.toDataURL('image/jpeg', 0.5);
    } catch (e) { /* Vorschau ist nicht wichtig */ }
    render();
    let lastPaint = 0;
    try {
      const text = await OCR.recognize(file, (p, status) => {
        ui.ocr.progress = p;
        ui.ocr.status = status;
        const now = Date.now();
        if (now - lastPaint > 150 && ui.view === 'create' && ui.createTab === 'photo') { lastPaint = now; render(); }
      });
      ui.ocr = null;
      ui.draftText = text.trim();
      if (!ui.draftText) return go('create', { createTab: 'photo', ocr: { progress: 0, status: 'Fertig', error: 'Auf dem Foto wurde kein Text gefunden.' } });
      toast('Text erkannt. Prüfe ihn kurz und tippe auf „Karten erzeugen“.');
      go('create', { createTab: 'text' });
    } catch (e) {
      ui.ocr.status = 'Fehler';
      ui.ocr.error = e.message + ' Du kannst den Text auch im Reiter „Text“ einfügen.';
      render();
    }
  }

  function showPreview(cards, target, keepScroll = false) {
    ui.preview = cards.map(c => ({ ...c, keep: true }));
    ui.previewTarget = target || ui.previewTarget || (state.decks[0] ? state.decks[0].id : 'new');
    if (ui.previewTarget !== 'new' && !deckById(ui.previewTarget)) ui.previewTarget = state.decks[0] ? state.decks[0].id : 'new';
    if (keepScroll) { ui.view = 'preview'; render(); } else go('preview');
  }

  function importDecks(text) {
    let parsed;
    try {
      parsed = Storage.parseImport(text);
    } catch (e) {
      return toast('Import nicht möglich: ' + e.message);
    }
    let count = 0;
    parsed.forEach(p => {
      if (!p.cards.length) return;
      state.decks.push({
        id: Storage.uid(),
        name: p.name || 'Importierter Stapel',
        subject: p.subject || '',
        color: COLORS.includes(p.color) ? p.color : 'teal',
        cards: p.cards.map(c => SRS.newCard(c.front, c.back, c.type)),
      });
      count += p.cards.length;
    });
    if (!count) return toast('Keine Karten gefunden.');
    persist();
    toast(`${plural(count, 'Karte', 'Karten')} importiert.`);
    go('home');
  }

  async function copyText(text, fallbackId) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Kopiert.');
    } catch (e) {
      const box = document.getElementById(fallbackId);
      if (box) { box.focus(); box.select(); }
      toast('Bitte markierten Text selbst kopieren.');
    }
  }

  const actions = {
    go: (ds) => go(ds.view, ds.target ? { previewTarget: ds.target } : {}),
    tab: (ds) => go('create', { createTab: ds.tab }),
    openDeck: (ds) => go('deck', { deckId: ds.id || ui.deckId }),
    newDeck: () => go('deckForm', { deckId: null }),
    editDeck: () => go('deckForm'),
    newCard: () => go('cardForm', { cardId: null }),
    editCard: (ds) => go('cardForm', { cardId: ds.id }),
    async deleteCard(ds) {
      if (!(await ask('Diese Karte löschen?'))) return;
      const d = deckById(ui.deckId);
      d.cards = d.cards.filter(c => c.id !== ds.id);
      persist();
      render();
    },
    async deleteDeck() {
      const d = deckById(ui.deckId);
      if (!(await ask(`Den Stapel „${d.name}“ mit ${plural(d.cards.length, 'Karte', 'Karten')} löschen?`))) return;
      state.decks = state.decks.filter(x => x.id !== d.id);
      persist();
      go('home');
    },
    exportDeck() {
      ui.exportText = Storage.exportDecks([deckById(ui.deckId)]);
      go('data');
    },
    exportAll() {
      ui.exportText = Storage.exportDecks(state.decks);
      render();
    },
    copyExport: () => copyText(ui.exportText, 'exportBox'),
    downloadExport() {
      const blob = new Blob([ui.exportText], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lernkiste-${SRS.today()}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    importText: () => importDecks(document.getElementById('importBox').value),
    async resetAll() {
      if (!(await ask('Wirklich alle Stapel und den Lernverlauf löschen? Das kann man nicht rückgängig machen.', 'Alles löschen'))) return;
      state = { decks: [], history: {} };
      persist();
      go('home');
    },
    readDeck: () => go('read'),
    reveal: () => reveal(false),
    revealAll: () => reveal(true),
    learnAll: () => startSession(state.decks),
    learnDeck: (ds) => startSession([deckById(ds.id || ui.deckId)]),
    practiceAll: () => startSession([deckById(ui.deckId)], false),
    flip,
    grade: (ds) => grade(ds.known === '1'),
    endSession: () => go('home'),
    startQuiz(ds) {
      const deck = deckById(ds.id || ui.deckId);
      const questions = Quiz.build(deck);
      if (!questions) return toast(`Für das Quiz braucht der Stapel mindestens ${Quiz.MIN_CARDS} verschiedene Antworten.`);
      go('quiz', { deckId: deck.id, quiz: { deckId: deck.id, questions, idx: 0, score: 0, chosen: null } });
    },
    answer(ds) {
      const q = ui.quiz;
      q.chosen = Number(ds.i);
      if (q.questions[q.idx].options[q.chosen] === q.questions[q.idx].answer) q.score++;
      render();
    },
    nextQuestion() {
      ui.quiz.idx++;
      ui.quiz.chosen = null;
      render();
    },
    sampleText() {
      ui.draftText = Generator.SAMPLE;
      render();
    },
    generate() {
      if (!ui.draftText.trim()) return toast('Bitte zuerst Text einfügen.');
      ui.previewSource = 'rules';
      showPreview(buildCards(ui.draftText));
    },
    copyPrompt: () => copyText(aiPrompt(ui.draftText), 'aiPrompt'),
    importAi() {
      try {
        const parsed = Storage.parseImport(ui.aiAnswer);
        const cards = parsed.flatMap(p => p.cards).map(c => ({ ...c, rule: c.type === 'summary' ? 'KI · Stichwortkarte' : 'KI-Chat' }));
        if (!cards.length) return toast('In der Antwort wurden keine Karten gefunden.');
        ui.previewSource = 'ai';
        ui.coverage = null;
        showPreview(cards);
      } catch (e) {
        toast('Die Antwort konnte nicht gelesen werden. Hat der KI-Chat nur JSON geantwortet?');
      }
    },
    savePreview() {
      const keep = ui.preview.filter(c => c.keep && c.front.trim() && c.back.trim());
      if (!keep.length) return;
      let deck;
      if (ui.previewTarget === 'new' || !deckById(ui.previewTarget)) {
        deck = { id: Storage.uid(), name: (ui.previewNewName || '').trim() || 'Neuer Stapel', subject: '', color: COLORS[state.decks.length % COLORS.length], cards: [] };
        state.decks.push(deck);
      } else {
        deck = deckById(ui.previewTarget);
      }
      keep.forEach(c => deck.cards.push(SRS.newCard(c.front.trim(), c.back.trim(), c.type)));
      persist();
      ui.preview = [];
      ui.draftText = '';
      ui.aiAnswer = '';
      ui.previewNewName = '';
      toast(`${plural(keep.length, 'Karte', 'Karten')} gespeichert.`);
      go('deck', { deckId: deck.id });
    },
  };

  // ---------- Ereignisse ----------
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el.dataset);
  });

  root.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('input[type="range"][data-setting]')) {
      const out = document.getElementById('perCardOut');
      if (out) out.textContent = t.value;
      return;
    }
    if (t.matches('[data-draft]')) {
      ui.draftText = t.value;
      const p = document.getElementById('aiPrompt');
      if (p) p.value = aiPrompt(ui.draftText);
    } else if (t.matches('[data-ai]')) {
      ui.aiAnswer = t.value;
    } else if (t.matches('[data-pvname]')) {
      ui.previewNewName = t.value;
    } else if (t.matches('[data-pv]')) {
      const c = ui.preview[Number(t.dataset.pv)];
      if (t.dataset.field === 'keep') {
        c.keep = t.checked;
        render();
      } else {
        c[t.dataset.field] = t.value;
      }
    }
  });

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-setting]')) {
      const key = t.dataset.setting;
      state.settings[key] = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
      persist();
      // In der Vorschau werden die Karten mit den neuen Einstellungen sofort neu erzeugt.
      if (ui.view === 'preview' && ui.previewSource === 'rules') showPreview(buildCards(ui.draftText), undefined, true);
      else render();
      return;
    }
    if (t.matches('[data-ocr]') && t.files[0]) runOcr(t.files[0]);
    if (t.matches('[data-pvtarget]')) { ui.previewTarget = t.value; render(); }
    if (t.matches('[data-import]') && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => importDecks(reader.result);
      reader.readAsText(t.files[0]);
    }
  });

  // Merken, ob der Einstellungs-Bereich aufgeklappt ist.
  root.addEventListener('toggle', e => {
    if (e.target.matches && e.target.matches('.settings-inline')) ui.settingsOpen = e.target.open;
  }, true);

  root.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (e.target.dataset.form === 'deck') {
      const name = String(f.get('name')).trim();
      if (!name) return;
      let d = ui.deckId ? deckById(ui.deckId) : null;
      if (!d) {
        d = { id: Storage.uid(), cards: [] };
        state.decks.push(d);
      }
      Object.assign(d, { name, subject: String(f.get('subject')).trim(), color: f.get('color') || 'blue' });
      persist();
      go('deck', { deckId: d.id });
    } else if (e.target.dataset.form === 'card') {
      const d = deckById(ui.deckId);
      const front = String(f.get('front')).trim();
      const back = String(f.get('back')).trim();
      if (!front || !back) return;
      const type = front.includes('_____') ? 'cloze' : 'basic';
      const c = ui.cardId ? d.cards.find(x => x.id === ui.cardId) : null;
      if (c) Object.assign(c, { front, back, type });
      else d.cards.push(SRS.newCard(front, back, type));
      persist();
      go('deck');
    }
  });

  // Wischen auf der Lernkarte: kurz tippen = umdrehen, nach rechts = gewusst, nach links = nicht gewusst.
  function attachSwipe() {
    const el = document.getElementById('flashcard');
    if (!el) return;
    let startX = null;
    let dx = 0;
    el.addEventListener('pointerdown', e => { startX = e.clientX; dx = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (startX === null || !ui.session.flipped) return;
      dx = e.clientX - startX;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
      el.classList.toggle('lean-good', dx > 60);
      el.classList.toggle('lean-bad', dx < -60);
    });
    const end = () => {
      if (startX === null) return;
      startX = null;
      el.style.transform = '';
      el.classList.remove('lean-good', 'lean-bad');
      if (Math.abs(dx) < 8) flip();
      else if (ui.session.flipped && Math.abs(dx) > 90) grade(dx > 0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { startX = null; el.style.transform = ''; });
    el.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    });
  }

  // Tastatur beim Lernen am PC: Leertaste = umdrehen, Pfeil rechts/links = gewusst/nicht gewusst.
  document.addEventListener('keydown', e => {
    if (ui.view !== 'session' || !ui.session || ui.session.idx >= ui.session.queue.length) return;
    if (e.target.matches('input, textarea')) return;
    const card = currentCard();
    if (card && card.type === 'summary') {
      const done = ui.session.revealed >= pointsOf(card).length;
      if (!done && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(false); }
      if (done && e.key === 'ArrowRight') grade(true);
      if (done && e.key === 'ArrowLeft') grade(false);
      return;
    }
    if (ui.session.flipped && e.key === 'ArrowRight') grade(true);
    if (ui.session.flipped && e.key === 'ArrowLeft') grade(false);
  });

  // ---------- Zeichnen ----------
  const NAV = [
    ['home', 'Start', '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'],
    ['create', 'Neu', '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6l2-3h4l2 3"/>'],
    ['learnPick', 'Lernen', '<rect x="4" y="5" width="13" height="15" rx="2"/><path d="M8 5V3h12v15h-3"/>'],
    ['stats', 'Statistik', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ];
  const NAV_GROUP = { home: 'home', deck: 'home', deckForm: 'home', cardForm: 'home', data: 'home', read: 'home', settings: 'home', create: 'create', preview: 'create', learnPick: 'learnPick', session: 'learnPick', quiz: 'learnPick', stats: 'stats' };

  function render() {
    const active = NAV_GROUP[ui.view];
    const focusMode = ui.view === 'session' || ui.view === 'quiz';
    root.innerHTML = `
      <main class="view view-${ui.view}">${views[ui.view]()}</main>
      ${focusMode ? '' : `<nav class="tabbar" aria-label="Hauptmenü">${NAV.map(([v, label, icon]) => `
        <button data-act="go" data-view="${v}" class="${v === active ? 'active' : ''}" ${v === active ? 'aria-current="page"' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span>
        </button>`).join('')}</nav>`}`;
    if (ui.view === 'session') attachSwipe();
  }

  render();

  // Service Worker: macht die App offline nutzbar (klappt nur über https oder localhost).
  try {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch (e) { /* in manchen Umgebungen nicht erlaubt */ }
})();
