# BrainQuiz Studio 3.6 – Audit und Testbericht

## Teststand

- `npm test`: **203 von 203 bestanden**; neuer Test prüft Schutz nicht aufgedeckter Bild-Imposter, persistente Editor-/Host-Oberflächenzustände und Buzzer-Sperren.
- `npm run check:syntax`: **bestanden**.
- `npm run build:pages`: **bestanden**.
- `tests/peer-2_7-browser.py`: **bestanden** – Host und Gast mit simulierter PeerJS-Verbindung; Auswahl, Antwortübersicht, verdeckte Lösungen, Scores, Rückkehr zum Brett.
- `tests/features-3_4-browser.py`: **bestanden** – Host + 3 Gäste; zwei Mitglieder teilen privaten Teamchat, fremdes Team sieht nichts; Kartenpins bleiben bis Freigabe geheim; 4 Hinweise einzeln; nach falscher Teamantwort halber Punktabzug, Sperre und freie Teilnahme des anderen Teams; korrekte zweite Antwort gibt Punkte.
- `tests/categories-3_0-browser.py`: **bestanden** – Kategorien/Fragen bearbeiten, einrichten, löschen, umbuchen, Kontextmenü und mobile Navigation.
- `tests/editor-3_1-browser.py`: **bestanden** – Mehrfachbearbeitung, Vorschau und Frageübernahme.
- `tests/question-animation-2_5-browser.py`: **bestanden** – Fragen-Cover mit Figur, keine Doppelanimation je Runde, Rücksicht auf reduzierte Bewegung.

## Anforderungen mit Umsetzung

| Bereich | Umsetzung |
| --- | --- |
| WYSIWYG-Frageneditor | Szene entspricht der Zuschauerfläche; Auswahl/Position von Elementen direkt am Canvas, Kontextmenü, Undo/Redo, Vorschau für unterschiedliche Geräte |
| Kategorien und Fragen löschen | Kategorien einschließlich Fragen und einzelne Fragen mit Bestätigung, auch per Rechtsklick |
| Standard-Buzzer | Wer zuerst buzzert, erhält das Antwortrecht, unabhängig davon wer aufgedeckt hat; Host wertet richtig oder falsch |
| Punkte/Sperren | Richtig: voller Fragewert; falsch: minus halber Fragewert; Sieger-/Team-Sperre für aktuelle Runde, andere dürfen weiterbuzzern; Host-Freigabe |
| Sonderfragen | Bilder, Sounds, Ability-Imposter, universelle Bild-Imposter bis acht Grafiken, Schätzen, Splash, Sortieren, Zitate, Karten, Tipps |
| Schriftliche Sammelrunde | Alle antworten getrennt; private Antworten werden zunächst nicht veröffentlicht; Host kann einzelne Karten und Lösung aufdecken |
| Weltkarte | Lokales SVG ohne fremde Karten-API, Pin-Steuerung, geheime Einsendungen und Zielkoordinate erst nach Aufdeckung |
| 1–4 Tipps | Schrittweise Host-Aufdeckung, direkt sichtbarer Button in der Host-Steuerleiste |
| Teams | Pro Team gemeinsamer Chat, von fremden Teams nicht einsehbar; Host darf Teamkanäle moderieren |
| Zwei Zuschauer-Szenen | Quizbrett mit ausgegrauten benutzten Feldern und Punktestand unten; Frage/Antwort in separater Szene |
| Figuren | Vier vom Nutzer gelieferte Bilder unverändert im Motiv, als Freisteller; figurengeführte Coverbewegungen und variable seitliche Peeks, reduzierte Bewegung respektiert |
| Keine Discord/Firebase-Kopplung | Keine Kommunikation oder Kontoeinstellungen der Dienste erforderlich; Live-P2P über PeerJS/WebRTC |

## Grenzen und Transparenz

Browser-End-to-End-Tests nutzen einen lokalen **simulierten PeerJS-Transport**; realer Internetverkehr und problematische Router-/Firewallkonfigurationen wurden nicht als erfolgreich verifiziert. Quizbrett-Seitenwechsel sind für viele Fragen notwendig, da unendlich viele lesbare Kacheln nicht auf einen einzigen kleinen Bildschirm passen. CSS bewegt vollständige Original-Sprites und Cover, jedoch **keine einzeln geriggten Arme oder Hände**. Die Browserprüfung bestätigt funktionierende Animationstransitionen, nicht die exakte Wirkung auf jedem Mobilgerät. Bei aktivem Host muss das Browserfenster verbunden bleiben.
