# BrainQuiz Studio 2.5 – Charaktere, Pixel-Glass und sichere Fragerunden

## Figuren
- Vier deutlich unterschiedliche, eigens gezeichnete Pixelmännchen ohne Gegenstände in den Händen. Der ursprüngliche mauvefarbene Kapuzencharakter bleibt als Stilreferenz erhalten, trägt aber keinen Dolch mehr.
- Separate Körper-/Kopfformen, Gesichter, Haar-/Kapuzenschnitte, Mantelsilhouetten und Farben.
- Figuren sind als optimierte transparente PNGs unter `docs/mascot-*.png` eingebunden; reproduzierbare Erzeugung in `scripts/generate-pixel-characters.py`.
- Host-/Teilnehmeransicht besitzt eine schmale, nicht überlagernde Charakterleiste unter den Spielinhalten. Hover hebt die Figuren leicht an; nach Abschluss einer Fragerunde gibt es einen kurzen kleinen Auftritt.

## Pixel-Glass-Layout
- In Host- und Teilnehmeransicht markantere pixelartige Randstufen, Kachelbevels, Statussymbole, Labels und Auswahlzustände.
- Moderne Typografie, gut lesbare Textflächen und Glasmaterialien bleiben erhalten; editorseitig keine aggressive Pixeltextur.
- Die Teilnehmer-Fragenfläche nutzt bei einer offenen Frage die ganze Breite. Das Eingabefeld bleibt gut erreichbar.
- Aufdeckungsansicht bleibt unverstellt; vier Figuren befinden sich in einem eigenen Fußbereich, nicht über Karten oder Buttons.
- Geprüfte Darstellung auch bei schmalen Fensterbreiten.

## Fragenaufdeckungs-Animation
- Vier Richtungen (links, rechts, oben, unten): Eine kleine Figur bewegt eine anthrazitfarbene Pixel-Glasabdeckung aus der Frage.
- Pro Raum, Runde und Frage-ID nur ein Mal pro Client. Häufige Live-Neuzeichnungen lösen keine Wiederholung aus.
- Aufdeckung betrifft ausschließlich die bereits freigegebene Frage, keine Musterlösung oder geheime Antworten.
- Automatische Deaktivierung bei `prefers-reduced-motion: reduce`; kurze Laufzeit und automatische Entfernung des Animationselements.

## Strikte Trennung von Fragen und Kategorien
- Eindeutige Frage-ID als zentrale Identität; Kategorienamen/Positionen wählen keine Frage aus.
- Serverseitiger, atomarer Transaktionspfad für das Öffnen einer Frage anstelle eines ungeprüften Mehrfeld-Updates.
- Vergleich von ID, Kategorie, Punktwert, unbenutztem Feld und erwarteter Rundennummer.
- Markierung „benutzt“, aktueller Frageninhalt und neue Rundennummer werden gemeinsam geschrieben.
- Schutz gegen Doppelklicks und parallele Hostaktionen.
- Runde/Frage-ID müssen auch bei Hinweisen, Aufdeckungen, manuellen Antwortfreigaben und Zurück-zum-Brett-Aktionen weiter stimmen. Veraltete Aktionen werden verworfen.
- Ergänzende Firebase-Validierungsregel zur Konsistenz von aktueller Frage, Quizbrett und Benutzt-Status.

## Sonstiges
- `docs/question-flow.mjs` eingeführt; `docs/firebase-client.mjs` und `docs/app.mjs` entsprechend überarbeitet.
- Version und Service-Worker-Cache auf `2.5.0` angehoben, neues Modul gecacht.
- Keine Änderungen am Grundschema der Host-Quizdateien. Nur GitHub-Pages/Web-Version.
