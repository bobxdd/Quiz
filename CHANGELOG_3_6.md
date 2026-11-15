# BrainQuiz Studio 3.6 — Finalisierung des bisherigen Funktionsumfangs

## Korrigiert

- Live-Szenen merken sich geöffnete, relevante Werkzeugbereiche bei Datenaktualisierungen; beim Übergang zwischen Quizbrett und Frage werden überdeckende Chatpanels geschlossen. Der Teamchat bleibt innerhalb seiner Szene während neuer Nachrichten offen.
- Tipps 1–4 direkt in der sichtbaren Host-Steuerleiste statt in einem offscreen positionierten Untermenü. Bild- und Szenenhinweise bleiben getrennt steuerbar.
- Bild-Imposter verarbeitet bis zu acht Bilder durchgängig: Editor/Reconcile und öffentliche Darstellung waren zuvor auf fünf begrenzt. Originalbild und Lösungsindex sind vor Aufdeckung weiterhin privat.
- Rechtsklick „Duplizieren“ in der Fragenbibliothek kopiert jetzt tatsächlich die angeklickte Frage statt der zuvor ausgewählten.
- Älterer Browsertest akzeptiert die neue absichtlich variable Verteilung von einer oder zwei sichtbaren Figuren in der Aufdeckung.
- Cache-/Versionsnummer und Projektdokumentation aktualisiert, statischer GitHub-Pages-Build geprüft.

## Erhalten und nachgeprüft

WYSIWYG-Szeneneditor und Kategorienverwaltung; Löschung von Fragen/Kategorien mit Bestätigung und Kontextmenü; Standard-Buzzer mit Host-Bewertung und halbem Punkteabzug, Teamsperren und Freigaben; schriftliche Sammelantworten; lokale Weltkarte mit privaten Pins; 1–4 Tipps; Bild, Sound, Splash-Art, Zitate, Schätzen, Reihenfolge und universeller Bild-Imposter; teamgetrennter gemeinsamer Chat; zwei öffentliche Szenen, Punktestand und gespielte Felder; vier unverändert zugeschnittene Originalfiguren und bewegte Fragecover.

## Technische Grenzen

Öffentliche GitHub-Pages-Dateien enthalten keinen Host-Spielstand. Echtzeit-Verbindung nutzt PeerJS und WebRTC: Host-Browser muss offen bleiben. Restriktive Netzwerke können TURN benötigen. Browser-Testläufe verwenden simulierten PeerJS; echte netzübergreifende WebRTC-Verbindungsqualität ist nicht durch sie bestätigt. Keine Discord-Anbindung.
