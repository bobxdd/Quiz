# BrainQuiz Studio 3.0 – Kategorieorientierter Frageneditor

- Der Frageneditor startet mit einer visuell gegliederten Kategorienübersicht statt einer ungeordneten Fragenliste.
- Kategorien können jetzt unabhängig von Fragen erstellt, umbenannt und – nur wenn leer – gelöscht werden. Kategorienamen werden normalisiert, auf Dubletten geprüft und im Quiz mitgespeichert.
- Vorschläge direkt auf der Startseite: Champions, Lorefragen, Schätzen, Splash-Art, Fähigkeiten, Items, Zitate und Sounds. Eigene Kategorien bleiben frei erstellbar.
- Jede Kategorie zeigt ihre Fragenanzahl und einen direkten „+ Frage“-Button. In einer leeren Kategorie gibt es klar benannte Fragetyp-Einstiege.
- Fragenliste, Suche, schneller Vorlagenwechsel, Haupt-Fragenfläche und Element-Inspector nach Godot/GDevelop/Construct-Prinzip neu angeordnet.
- Fragen können über die Kategorieauswahl im Inspector umsortiert werden, ohne Inhalte oder die Zuordnung des öffentlichen Quizbretts zu verlieren.
- Datenformat weiterhin `version:1`, erweitert um optionales `categories`-Feld; bestehende Quizdateien bleiben importierbar.
- `docs/editor-categories.css` für den fokussierten und responsiven Editor, `docs/category-model.mjs` für die testbare Kategorie-Logik.
- Cache-Version und UI auf 3.0.0 aktualisiert. Alle vier Originalfiguren, Szenenwechsel, Buzzer und PeerJS-Mehrspieler-Logik unverändert übernommen.
