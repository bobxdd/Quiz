# BrainQuiz Studio 3.0 – Editor-Recherche (kleine Studios und Indie-Entwicklung)

Stand: 15.11.2026. Die folgenden Produktdokumentationen und Gestaltungsprinzipien wurden auf den bestehenden Frageneditor angewendet; es handelt sich nicht um eine Kopie ihrer Benutzeroberflächen.

## Verglichene Werkzeuge

- **GDevelop** (https://wiki.gdevelop.io/gdevelop5/interface/): Projekt-Manager als klare Strukturübersicht; Szenen und Events sind eigene Bereiche. Übertragen: Kategorien und Fragen als Bibliotheksstruktur, separater Bearbeitungsbereich.
- **Godot** (https://docs.godotengine.org/en/stable/getting_started/introduction/first_look_at_the_editor.html, https://docs.godotengine.org/en/latest/tutorials/editor/inspector_dock.html): Szene links, eigentliche Ansicht zentral, Eigenschaften kontextbezogen. Übertragen: Kategorieauswahl links, Fragenfläche im Zentrum, ausgewählte Felder rechts.
- **Construct 3** (https://www.construct.net/en/make-games/manuals/construct-3/overview/the-interface, https://www.construct.net/en/make-games/manuals/construct-3/interface/bars/project-bar): Projektleiste mit Such- und Anlegeaktionen; Eigenschaften abhängig von der Auswahl. Übertragen: sichtbare Hinzufügen-Buttons pro Kategorie, Rechtsklick-/Eigenschaftsaktionen nur beim passenden Kontext.
- **Twine** (https://www.twinery.org/): ein niedrigschwelliger Start und unkompliziertes Erstellen von Inhalten. Übertragen: erst Kategorie, dann Frage, ohne fünf Pflichtdialoge.
- **Nielsen Norman Group** (https://www.nngroup.com/articles/recognition-and-recall/): Auswahlmöglichkeiten erkennbar machen statt Namen/Schritte auswendig lernen lassen. Übertragen: vordefinierte Kategorie-Vorschläge, klar beschriftete Hinzufügen-Aktionen und sichtbare Fragenanzahl.

## Verbindliches Konzept

1. **Projektübersicht**: echte Kategorien als Kacheln; leere Kategorien sind erlaubt und bleiben in Quizdateien gespeichert. Vorschläge sind Hilfen, keine Pflichtliste.
2. **Kategorieauswahl**: Fragenliste zeigt nur die gewählte Kategorie; Titel, Punkte und Frageauswahl sind schnell erreichbar. Eine einzelne Frage wird mit einem Klick angelegt.
3. **Editor**: Fragenfläche und die wenigen benötigten Aktionen stehen zentral. Eigenschaften gehören rechts zu der ausgewählten Frage/zu einem Element. Erweitertes wird aufgeklappt.
4. **Ergonomie**: Rechtsklick/Shift+F10/Longpress bleiben erhalten; Kontextaktionen sind auch über normale Schaltflächen zugänglich.
5. **Daten**: Kategorie und Fragetyp sind verschiedene Eigenschaften. Frühere Quizdateien werden ohne Kategorienliste eingelesen und automatisch anhand der Fragen ergänzt. Ein Kategorie-Löschvorgang mit Fragen wird verweigert.
6. **Grenzen**: Der Frageneditor darf auf kleinen Geräten vertikal scrollen, damit kein Bedienelement abgeschnitten wird. Die in Version 2.9 eingeführten zwei bildschirmfüllenden Spielszenen bleiben unangetastet.
