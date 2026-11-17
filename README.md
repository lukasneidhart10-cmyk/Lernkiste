# Lernkiste

Kostenlose Lern-App für Schüler: Hefteintrag fotografieren, daraus automatisch
Stichwortkarten und Lernkarten erzeugen und mit dem Leitner-System lernen.

- Läuft komplett im Browser, ohne Server, ohne Anmeldung, ohne KI-Schlüssel
- Texterkennung mit [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0-Lizenz, Dateien `tesseract.min.js`, `worker.min.js`, `tesseract-core-*.wasm.js`, `deu.traineddata.gz`; PDF-Leser [pdf.js](https://mozilla.github.io/pdf.js/) von Mozilla (Apache-2.0))
- Karten werden per Regeln erzeugt (`generator.js`), gelernt wird mit dem Leitner-System (`srs.js`)
- Daten bleiben auf dem Gerät (localStorage)
- Installierbar als App (PWA) und offline nutzbar

Entstanden als GFS-Projekt zum Thema Vibe Coding.
