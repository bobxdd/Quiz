# BrainQuiz Studio 3.2 – Editor-/Host-UX-Fokus

## Umgesetzt

### 1) Frageneditor näher an der finalen Zuschaueransicht
- dauerhafte **Zuschauer-Vorschau** direkt im Editor
- separate **Layout-Bearbeiten**-Fläche unter derselben Frage
- klarerer Hinweistext: oben echte Vorschau, unten Layoutbearbeitung
- Schnellumschaltung Desktop/Mobil bleibt erhalten

### 2) Kategorien/Fragen jederzeit löschbar
- Kategorien können jetzt **auch mit enthaltenen Fragen** gelöscht werden
- Fragen können weiterhin direkt gelöscht werden
- **Rechtsklick-Kontextmenü** für Kategorien und Fragen ergänzt
- Kontextmenü enthält Öffnen / Neu / Umbenennen / Löschen je nach Eintrag

### 3) Buzzer-Flow stärker auf das gewünschte Spielprinzip angepasst
- Buzzer standardmäßig **aktiviert**
- bei **falscher Bewertung** des aktuellen Buzzers:
  - halbe Fragepunkte werden abgezogen
  - Buzzer wird wieder freigegeben
  - betroffene Person wird für die laufende Runde gesperrt
- Host kann gesperrte Personen **manuell wieder freigeben**
- Host kann auch **alle Sperren der Runde** aufheben
- Gäste können nicht erneut buzzern, solange sie für die Runde gesperrt sind

### 4) Hostansicht vereinfacht
- neue Karte **„Zuschauerzustand“** zeigt klar:
  - was Zuschauer gerade sehen
  - ob Quizbrett / Frage / Antwortübersicht / Lösung sichtbar ist
  - aktuellen Buzzerstatus
  - Anzahl gesperrter Spieler
- Punktepanel markiert gesperrte Spieler klarer
- Buzzer-Freigabe direkt in der Punkteverwaltung möglich

## Technisch angepasst
- `docs/studio-editor.mjs`
- `docs/editor-31.css`
- `docs/app.mjs`
- `docs/session-ui.css`
- `docs/peer-client.mjs`
