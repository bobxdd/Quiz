# BrainQuiz Studio 3.1 — Editor, Host und Zuschauer

## 1. Frageneditor
- Kategorien und Frageauswahl wie in Version 3.0 beibehalten.
- Mehrere Fragen per Checkbox auswählen und Kategorie/Punktzahl gleichzeitig ändern. Eine gemeinsame Undo-Aktion stellt die vorherigen Werte wieder her.
- Fragenbank: Frage aus einer anderen Kategorie im selben Quiz in die aktuell ausgewählte Kategorie kopieren. Die ursprüngliche Frage bleibt unabhängig und unverändert.
- Stets sichtbare automatische Speicheranzeige, inklusive Fehlerstatus. Eingaben werden bei Navigation und Seitenwechsel synchron gesichert.
- Teilnehmer-Vorschau mit Start-/Hinweis-/Lösungsstufe und Desktop-/Mobilformat. Die Vorschau ist lokal und startet keine Live-Runde.
- Editor im Handyformat: drei umschaltbare Bereiche „Bibliothek“, „Bearbeiten“, „Eigenschaften“.

## 2. Host
- Spielphasenbezogene Haupt-Aktionsleiste; Hinweise und seltene Einstellungen bleiben bei Bedarf aufklappbar.
- Erfolgsmeldungen für wichtige Aktionen wie Frage öffnen, Auflösung zeigen und Punkteaktualisierung.
- Room-/Runden-/Aktion-bezogene Sperre gegen doppelte gleichzeitige Host-Anfragen; Retry nach Verbindungsfehler möglich.
- Warnung vor Zurückwechsel zum Brett, wenn bereits Antworten abgegeben wurden.
- Bisherige Host-Werkzeuge zur Bewertung, Punktekorrektur, Teamchat, Zeitmessung und Buzzer bleiben erhalten.

## 3. Zuschauer
- Der bereits in 3.0 eingeführte Zwei-Szenen-Ansatz bleibt: Quizbrett mit grauen, deaktivierten gespielten Fragen oder Frage/Auflösung, nie beides gleichzeitig.
- Punktestand im Spielbereich unten; bestehende mobile Pagination bleibt erhalten.
- Keine privaten Host-Lösungen im öffentlichen Spielzustand vor der Freigabe.

## 4. Qualität
- Quizcheck erkennt unvollständige Fragen und zeigt direkt aufrufbare Problemstellen; doppelte Titel/Punktwerte als Hinweise.
- Veröffentlichung mit Fehlern wird gestoppt, Hinweise können bewusst bestätigt werden.
- Undo/Redo, Rechtsklick, Shift+F10, Tastatur und lange Berührung unverändert verfügbar.
- Service-Worker-Cache auf 3.1.0 geändert und neue Ressourcen aufgenommen.

**Nicht verändert:** Bilddateien und Animationen der vier Originalfiguren.
**Architektur:** GitHub Pages / PeerJS/WebRTC ohne Firebase.
