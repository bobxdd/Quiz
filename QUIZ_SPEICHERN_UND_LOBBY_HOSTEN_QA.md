# Quiz speichern → gespeichertes Quiz auswählen → Lobby hosten

## Der neue Standardablauf

1. **Neues Quiz erstellen** oder unter **Meine Quizze → Bearbeiten** ein vorhandenes Quiz öffnen.
2. Fragen/Kategorien anlegen. **Quiz speichern** schreibt den aktuellen Stand mit Revision und Konfliktkontrolle in die lokale Quizbibliothek. Die bestehende automatische Speicherung bleibt als zusätzliche Sicherung.
3. Mit **Meine Quizze** zur Startseite wechseln. Jedes Quiz besitzt getrennte Aktionen **Bearbeiten** und **Lobby hosten**. Alternativ direkt im Editor **Mit diesem Quiz Lobby hosten** wählen.
4. Der Host prüft die **ausgewählte gespeicherte Brett-ID** und die vollständige Quizvorlage mit `quizAudit`. Unvollständige Quizze eröffnen keinen Raum. Ein neues Quiz wird nicht mit dem zuletzt zufällig bearbeiteten Brett verwechselt.
5. Die neue PeerJS-/WebRTC-Lobby erhält beim Erstellen sofort das korrekte öffentliche Quizbrett und den Zustand `published:true`. Der Host landet in **Team-Lobby**. Gäste erhalten keine privaten Lösungen oder Originalfragenobjekte. Das gewählte Quiz bleibt als lokale Vorlage separat, unverändert und wiederverwendbar.
6. Der Host kann die Lobby vor Spielbeginn schließen, ohne sein gespeichertes Quiz zu löschen. Er kann dieselbe Vorlage für eine andere Runde erneut hosten. Die bisherige Regel nach Veröffentlichung – keine Änderungen im laufenden Quiz – bleibt bestehen.

## Sicherheits- und Fehlerfälle

- `loadBoard` überprüft stabile Kennung und Datenintegrität. Keine stillschweigende Ersetzung durch den zuletzt geöffneten Entwurf.
- `studio.flush()` und `saveLocal()` erfolgen **vor** dem Netzwerkstart. Bei Schreibkonflikt oder Speicherfehler bleibt der User im Editor.
- `game.create(...,{published:true})` setzt das veröffentlichte Brett atomar als **Initialzustand** des Raums, bevor Gäste das erste Snapshot empfangen. Kein kurzes Veröffentlichen leerer Fragenräume.
- Scheitert Raumstart oder privates Speichern, wird der unvollständige Peer-Raum abgebrochen. Der lokale Entwurf bleibt erhalten.
- Wiederholte Klicks auf „Lobby hosten“ werden mit `hostingSavedBoard` gegen doppelte Raumstarts geschützt.
- Die alte Funktion „Online-Raum erstellen“ bleibt als sekundäre Legacy-Option erreichbar, um alte Workflows nicht unbemerkt zu zerstören. Der neue Standardweg ist Quiz → speichern → hosten.

## Recherchebezug

- [MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API): `localStorage` bleibt browser-/originbezogen persistent; `sessionStorage` ist tabbezogen. Deshalb wird die Quizbibliothek in `localStorage` verwaltet, während Teilnehmergeheimnisse tabbezogen bleiben.
- [MDN Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): Browser-Speicher ist kontingentiert. Speicherfehler werden abgefangen, dürfen die gespeicherte Vorlage aber nicht still überschreiben.
- [NN/g – Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/): Keine störende Bestätigung vor jedem normalen Speichern. Bestätigung nur bei Folgen wie dem Beenden eines Spielraums oder beim Starten trotz Quiz-Warnungen.
- [NN/g – Cancel vs Close](https://www.nngroup.com/articles/cancel-vs-close/): Klar beschriftete Navigation und bewusster Lobby-Abbruch, statt eines mehrdeutigen X-Buttons.
- Projektinterne Quellen: `docs/board-workspace.mjs` (Revision, Mehrfachbretter), `docs/editor-workflows.mjs` (`quizAudit`), `docs/peer-client.mjs` (Host-autoritativer P2P-Raum), `docs/lobby-view.mjs` (Teams und Bereitschaft).

## QA / Regression

- Neuer Chromium-Test `tests/saved-quiz-host-lobby-browser.py`: zwei unterschiedliche lokale Quizze, Speichern und Wiederöffnen, fehlende Fragen blockieren Hosting, gezielte Auswahl statt zuletzt bearbeitetem Quiz, Lobby veröffentlichtes Brett, keine Host-Lösungen beim Gast, korrekte Raumbeendigung und erneutes Hosting, Editor-Direktstart, Doppelklick und veraltete Aktionen.
- Weiterhin die vollständigen JavaScript-Tests sowie Browserfälle für 10 Teilnehmer, 5 Teams, Buzzern, Kartenfragen, Host-/Gast-Freigaben, UX und Mobilansicht.
- Grenzen: GitHub Pages ist statisch und speichert keine Quizvorlagen serverseitig. **Meine Quizze** ist die Bibliothek im aktuellen Browser. Für Wechsel auf ein anderes Gerät weiterhin Quiz-Datei exportieren/importieren. Echtgeräte-Netzwerk-ICE/TURN sowie Safari/Firefox nicht durch Chromium-Mocks abgedeckt.
