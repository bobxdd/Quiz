# BrainQuiz Studio 3.0 – Prüfprotokoll

Stand: 15.11.2026

## Erfolgreich getestet

- `npm run check:syntax` – alle eingebundenen JS-Dateien inklusive category-model.
- `npm test` – **188/188 Tests erfolgreich**. Neue Tests prüfen Kategorienamen, Vorlagen, Duplikate, Datenimport/-export, Legacy-Quizdateien und die Trennung von öffentlichen Spielfeld- und privaten Fragedaten.
- `npm run build:pages` – statisches GitHub-Pages-Shell-Projekt erfolgreich verifiziert.
- `python3 tests/categories-3_0-browser.py` – Chromium: vorgeschlagene und selbst benannte Kategorien erstellen, Frage anlegen, estimate-Vorlage, Umbenennung mit Fragen, Löschen nur leer, Kategorienwechsel, Inspector und Kontextmenü, Mobilbreite 390px; ohne JavaScript-Seitenfehler.
- `python3 tests/peer-2_7-browser.py` – zwei Chromium-Fenster mit PeerJS-Testtransport: Host erstellt Raum, Gast tritt bei, Freigabe, Frage, Antwort, verdeckte/aufgedeckte Antwort und zwei Spielszenen; ohne JavaScript-Seitenfehler.
- `python3 tests/question-animation-2_5-browser.py` – vier Originalfiguren, einmalige Vorhangsanimation, nächste Frage und reduzierte Bewegung erfolgreich.

## Grenzen

- PeerJS wurde für die lokalen Browsertests simuliert; ein echter WAN-/NAT-übergreifender Verbindungstest ist damit nicht nachgewiesen.
- Getestete Bildschirmgröße ist u. a. 390 × 780; nicht jede denkbare Browservergrößerung und jedes Endgerät ist abgedeckt.
- Die Animationen der vier Originalfiguren wurden nicht gegen neue Einzelbild-/Skelettanimationen getauscht.
