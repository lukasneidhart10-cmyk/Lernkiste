// ai.js – KI direkt auf dem Gerät (kostenlos, ohne Anmeldung, ohne Schlüssel).
//
// Benutzt WebLLM (https://webllm.mlc.ai). Das KI-Modell wird beim ersten Mal einmalig
// heruntergeladen (ca. 1–1,5 GB) und danach im Browser gespeichert. Die Notizen verlassen
// das Gerät nie. Nötig ist WebGPU: Safari ab iPadOS 26 / iOS 26, aktueller Chrome oder Edge.
//
// Aufgabe der KI: den eingelesenen Text AUFRÄUMEN (Lesefehler, Tabellen, Überschriften).
// Die Karten macht danach wie gewohnt generator.js. So bleibt die Vollständigkeitsprüfung erhalten.

const AI = (() => {
  const WEBLLM_VERSION = '0.2.86';
  const MODELS = {
    standard: { id: 'gemma-2-2b-it-q4f16_1-MLC', name: 'Gemma 2 (2B)', size: 'ca. 1,5 GB' },
    light: { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 (1,5B)', size: 'ca. 1 GB' },
  };

  const PROMPT = `Du hilfst einem Schüler, Lernnotizen für Karteikarten aufzubereiten. Der Text kommt aus einer Texterkennung und kann Lesefehler enthalten.

Regeln:
1. Behalte ALLE Informationen. Lass nichts weg und erfinde nichts dazu.
2. Korrigiere offensichtliche Lesefehler und falsch getrennte Wörter.
3. Schreibe jede Überschrift in eine eigene Zeile mit "# " davor.
4. Schreibe jede Information in eine eigene Zeile mit "- " davor.
5. Begriffe mit Erklärung schreibst du so: "- Begriff: Erklärung".
6. Tabellen schreibst du Zeile für Zeile so: "- linke Spalte: rechte Spalte". Die Kopfzeile der Tabelle lässt du weg.
7. Lass Seitenzahlen und Fußzeilen weg (z. B. "Lernzettel zur Klassenarbeit Seite 3").
8. Antworte NUR mit dem aufbereiteten Text, ohne Einleitung und ohne Erklärung.

Beispiel
Text:
Zellorganellen
Begriff Bedeutung
Zellkern Steuerzentrale der ZeIle
Mitochondrien = Kraftwerke der Zelle, hier findet die Zellatmung statt
Biologie Lernzettel Seite 4
Antwort:
# Zellorganellen
- Zellkern: Steuerzentrale der Zelle
- Mitochondrien: Kraftwerke der Zelle, hier findet die Zellatmung statt`;

  let engine = null;
  let loadedId = null;
  let webllm = null;

  // WebGPU vorhanden? Ohne WebGPU kann die KI nicht laufen.
  function supported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  // WebLLM laden: zuerst neben der App (falls vorhanden), sonst vom kostenlosen CDN jsDelivr.
  async function lib() {
    if (webllm) return webllm;
    const urls = [
      new URL('vendor/webllm/web-llm.js', document.baseURI).href,
      new URL('web-llm.js', document.baseURI).href,
      `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/lib/index.js`,
    ];
    for (const url of urls) {
      try {
        const mod = await import(url);
        if (mod && mod.CreateMLCEngine) { webllm = mod; return mod; }
      } catch (e) { /* nächste Quelle probieren */ }
    }
    throw new Error('Der KI-Baustein konnte nicht geladen werden. Bist du mit dem Internet verbunden?');
  }

  async function isDownloaded(key) {
    try {
      const mod = await lib();
      return await mod.hasModelInCache(MODELS[key].id);
    } catch (e) {
      return false;
    }
  }

  // Modell starten. onProgress(0..1, text)
  async function load(key, onProgress = () => {}) {
    const model = MODELS[key] || MODELS.standard;
    if (engine && loadedId === model.id) return engine;
    if (!supported()) throw new Error('Dieses Gerät oder dieser Browser unterstützt die KI nicht (WebGPU fehlt). Nötig ist iPadOS 26 bzw. ein aktueller Chrome.');
    const mod = await lib();
    if (engine) { try { await engine.unload(); } catch (e) { /* egal */ } engine = null; }
    const cached = await mod.hasModelInCache(model.id).catch(() => false);
    engine = await mod.CreateMLCEngine(model.id, {
      initProgressCallback: (r) => {
        const pct = Math.round((r.progress || 0) * 100);
        onProgress(r.progress || 0, cached ? `KI wird gestartet … ${pct} %` : `KI wird heruntergeladen (einmalig, ${model.size}) … ${pct} %`);
      },
    });
    loadedId = model.id;
    return engine;
  }

  // Text in Abschnitte von höchstens ~1400 Zeichen teilen (an Leerzeilen bzw. Zeilenenden),
  // damit jeder Abschnitt in das "Gedächtnis" des kleinen Modells passt.
  function chunks(text, max = 1400) {
    const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    const parts = [];
    let cur = '';
    const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
    blocks.forEach(block => {
      if (block.length > max) {
        push();
        block.split('\n').forEach(line => {
          if (cur.length + line.length + 1 > max) push();
          cur += line + '\n';
        });
        push();
      } else {
        if (cur.length + block.length + 2 > max) push();
        cur += block + '\n\n';
      }
    });
    push();
    return parts;
  }

  // Antwort der KI säubern (Code-Blöcke, Einleitungssätze entfernen).
  function tidy(answer) {
    let t = String(answer).replace(/```[a-z]*\n?/gi, '').trim();
    t = t.replace(/^(hier ist|hier sind|aufbereiteter text|antwort)[^\n]*:\s*\n/i, '');
    return t.trim();
  }

  let stopRequested = false;

  // Hauptfunktion: räumt den Text abschnittsweise auf.
  // Rückgabe: { text, kept } – kept = Anzahl Abschnitte, bei denen der Originaltext behalten wurde,
  // weil die KI-Antwort verdächtig kurz war (Sicherheitsnetz: es darf nichts verloren gehen).
  async function cleanup(text, key, onProgress = () => {}) {
    stopRequested = false;
    const eng = await api.load(key, (p, msg) => onProgress(p * 0.15, msg));
    const parts = chunks(text);
    const out = [];
    let kept = 0;
    for (let i = 0; i < parts.length; i++) {
      if (stopRequested) { out.push(...parts.slice(i)); break; }
      const part = parts[i];
      const label = `KI verbessert Abschnitt ${i + 1} von ${parts.length}`;
      onProgress(0.15 + 0.85 * (i / parts.length), label);
      let answer = '';
      const stream = await eng.chat.completions.create({
        messages: [{ role: 'user', content: `${PROMPT}\n\nJetzt du\nText:\n${part}\nAntwort:` }],
        temperature: 0.2,
        max_tokens: Math.min(2000, Math.round(part.length / 2.2) + 250),
        stream: true,
      });
      for await (const chunk of stream) {
        answer += (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || '';
        const share = Math.min(1, answer.length / Math.max(1, part.length));
        onProgress(0.15 + 0.85 * ((i + share) / parts.length), label);
      }
      const cleaned = tidy(answer);
      // Sicherheitsnetz: viel kürzer als das Original? Dann lieber das Original behalten.
      const letters = (s) => (s.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
      if (letters(cleaned) < letters(part) * 0.6) {
        out.push(part);
        kept++;
      } else {
        out.push(cleaned);
      }
    }
    onProgress(1, 'Fertig');
    return { text: out.join('\n\n'), kept };
  }

  function stop() {
    stopRequested = true;
    try { if (engine) engine.interruptGenerate(); } catch (e) { /* egal */ }
  }

  const api = { MODELS, supported, load, cleanup, stop, chunks, isDownloaded };
  return api;
})();
