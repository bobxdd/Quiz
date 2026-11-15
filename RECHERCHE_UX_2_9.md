# BrainQuiz Studio 2.9 — Recherche, Abwägungen und konkrete Entscheidungen

Stand: 15.11.2026. Betrachtet wurde die reine GitHub-Pages-Version, nicht eine Desktop-Anwendung. Die Quellen wurden mit den tatsächlichen Funktionsanforderungen des Quiz verglichen; keine Quelle wurde 1:1 kopiert.

## 1. Hauptszenen: Frage vs. Übersicht
- **JeopardyLabs** dokumentiert ein Brett mit Frage/Antwort und Tastatur-Workflow (Auswahl, Aufdecken, Escape zum Brett): https://jeopardylabs.com/about/
- **Kahoot Live** verwendet klar getrennte Fragen-, Ergebnis- und Punktephasen, die den Gruppenfokus erhalten: https://support.kahoot.com/hc/en-us/articles/360039900153-Tips-for-hosting-a-live-game
- **Entscheidung:** BrainQuiz hat nur zwei synchrone Hauptszenen: `board` und `question`. Die Antwortaufdeckung ist ein *Zustand der Frage*, keine dritte Brett-Szene. Host/Gast lesen denselben öffentlichen Spielstatus.
- **Verworfen:** Brett und Antwortkarten gleichzeitig anzeigen, weil visuelle Konkurrenz und Verwechslungen entstehen.

## 2. Gespielte/ausgewählte Fragen
- **Nielsen Norman Group**, Sichtbarkeit des Systemzustands und Wiedererkennung: https://www.nngroup.com/articles/visibility-system-status/ und https://www.nngroup.com/articles/recognition-and-recall/
- **Entscheidung:** Deaktiviert + entsättigt + dunkler Kontrast + Häkchen + zugängliche Beschriftung. Quelle ist `used`, synchronisierter `used`-Index oder `current` — nicht bloß lokaler CSS-Zustand. Keine erneute Auswahl möglich.

## 3. Kein vertikales Seitenscrollen / viele Fragen
- **W3C WCAG 2.2 Reflow** verlangt bei Vergrößerung Funktionserhalt, erwähnt Spiele/Präsentationen und Tabellen als spezifische Ausnahmen: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- **MDN**, dynamische Viewport-Einheiten (`dvh`) passen sich Browser-Chrome an: https://developer.mozilla.org/de/docs/Web/CSS/Reference/Values/length
- **Entscheidung:** 100dvh-Spielfläche mit fixierter Kopf- und Punktzeile, breitenabhängigen Kategorie-Seiten und höhenabhängigen Zeilen-Seiten. Kein verstecktes Abschneiden von Brettzellen; bei großen Brettern explizit Vor/Zurück. Ausnahmsweise kann lange Frage/Antwort *innerhalb ihres eigenen Panels* scrollen, da 400%-Zoom und beliebig lange Texte sonst unmöglich lesbar bleiben.
- **Verworfen:** Schrift auf unlesbar winzige Größen schrumpfen, überlange Bretter clippen oder auf breiten Bildschirmen horizontale Scrollleisten erzwingen.

## 4. Zuschaueransicht
- **Kahoot**, Fragen und Optionen auf Teilnehmergeräten: https://support.kahoot.com/hc/en-us/articles/115003197928-How-to-enable-See-questions-on-participant-s-screen-in-Kahoot-live-games
- **Nielsen Norman Group**, visuelle Hierarchie und Kontrast: https://www.nngroup.com/articles/principles-visual-design/
- **Entscheidung:** Im Brett nur Auswahl/Kategorien/Spielstand; während der Frage Fokus auf Lesbarkeit, eigener Antwortbereich und ein relevanter Aktionsknopf. Teamchat in aufklappbarem Bereich. Originalvierer-Pixelfiguren verkleinert im Fußbereich.

## 5. Hostansicht
- **NN/g**, Progressive Disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- **Apple**, Menüs reduzieren sichtbare Kommandofülle: https://developer.apple.com/design/human-interface-guidelines/menus
- **Entscheidung:** Primäraktionen (Aufdecken, Lösung, zurück) direkt neben Frage, Timer/Buzzer/Punkte/Chat im sekundären Bereich. Keine doppelten Hauptansichten mit separater Logik.

## 6. Frageneditor
- **Figma**, Eigenschaften eines Elements gesammelt rechts: https://help.figma.com/hc/en-us/articles/8883757553943-Edit-instances-with-component-properties
- **Kahoot**, Fragenliste, Fragetyp und Antworten als separate logische Bereiche: https://support.kahoot.com/hc/en-us/articles/115002884788-How-to-make-a-kahoot
- **Entscheidung:** links Fragen, zentral editierbare Bühne, rechts ausgewähltes Element; häufige Funktionen direkt sichtbar, seltene unter Details (Element-Geometrie, Quizdateien). Vorhandene Vorlagen, Undo/Redo und lokale Speicherung bleiben.

## 7. Kontextmenü und Zugänglichkeit
- **Apple HIG**, kurz, kontextbezogen, Hauptfunktionen auch anders erreichbar: https://developer.apple.com/design/human-interface-guidelines/context-menus
- **Microsoft**, Rechtsklick/Long Press/Shift+F10 plus zugängliche Alternativen: https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/collection-commanding
- **W3C APG**, Menü-Button / Pfeiltasten / Escape / Fokus: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ und https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-links/
- **Entscheidung:** Rechtsklick auf gewähltes Element (Bearbeiten, Duplizieren, Zentrieren, Ebenen, Löschen) bzw. freie Fläche (Text/Bild/Form einfügen); sichtbare Menüschaltfläche; Shift+F10/ContextMenu; Pfeilnavigation; Escape; Longpress auf Touch. Die Menübefehle rufen denselben Editor-Aktionspfad auf.

## 8. Tests und Grenzen
- Automat: 179 Testfälle inkl. Zustands-, Seitierungs-, Freigabe-, Privacy- und Abwärtskompatibilitätsprüfungen.
- Browser: Chromium-Host und -Gast mit PeerJS-Mock, von Join bis private Antwortaufdeckung; responsive Mobil-Brett, Kontextmenü, Keyboard, kein Dokument-Scrollen im Normalfall.
- Einschränkung: der Mock ersetzt keinen ICE/TURN-Test über zwei reale Internetanbieter; diese reale Verbindung muss weiterhin separat überprüft werden. Extreme Anzahl von Teams/Punkten wird über lokale Pager statt Abschneiden bedient.
