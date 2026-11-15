# Recherche und Implementierungsentscheidungen – 2.5

## 1. Zielkonflikt
Die Oberfläche soll stärker nach einem Pixel-RPG aussehen (ca. 40 % Pixel, 60 % clean/glass), ohne bei 4–8 Spielern die Übersicht über Fragen, Antwortfelder und Punkte zu verlieren. Gleichzeitig sollen Aufdeckungsanimationen Spaß machen, aber den Live-Spielstand nicht verändern oder die Synchronisierung gefährden.

## 2. Verglichene Quellen und Ansätze

### Godot Engine: Pixel-Präzision und Auflösung
https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html

Godot erklärt Integer-Skalierung und warum fraktionale Skalierungen bei Rastergrafiken zu unscharfen Kanten führen können. Konsequenz: Die Charaktere werden klein im nativen Pixelraster gezeichnet, mit Nearest-Neighbor hochskaliert und CSS-seitig `image-rendering:pixelated` gerendert. Keine Pixel-Schrift für die quizrelevanten Fließtexte.

### Godot Engine: Icongestaltung
https://docs.godotengine.org/en/stable/engine_details/editor/creating_icons.html

Konsistente kleine Icons brauchen einfache Formen, begrenzte Kontraste und pixelgenaue Kanten. Daraus leiten wir wiederholbare Eckdetails, Stufen und Sigils ab, statt überall unterschiedliche Ornamente zu verwenden.

### Indie: Jesse Eisenbart, Return Pixel-Art UI Devlog
https://itch.io/devlog/384935/return-devlog-01-creating-effective-pixel-art-uigui.amp

Der Devlog erklärt, wie stark reduzierte Pixelpaletten die Erkennbarkeit von UI-Zuständen beeinträchtigen können. Entscheidung: Mauve, Salbei, Elfenbein und Stahlgrau bilden eine kleine, zusammengehörige Palette, aber Richtig/Falsch, Aktiv/Inaktiv und wichtige Buttons behalten voneinander unterscheidbare Zustände und textuelle Beschriftungen.

### Indie/Asset-Entwickler: Pixel Game UI und Moonlit Menus
https://the-pixel-game.itch.io/pixel-art-user-interface-asset-pack-16x16/devlog/1596988/devlog-new-pixel-art-user-interface-asset-pack-released
https://itch.io/t/7237383/moonlit-menus-cozy-pixel-ui-kit-2-palettes-buttons-and-48-icons-9

Die Packs zeigen den Wert wiederverwendbarer Komponenten und vollständiger Zustandsfamilien (Normal, Hover, Aktiv, Deaktiviert). Daraus folgt: Pixelornamente treten vor allem als Bevels, kleine Ecken, Status-Lichtpunkte und klar definierte Kachelzustände auf – nicht als tapetenartiger Hintergrund hinter Texten. Es wurden keine fremden Asset-Packs in das Projekt übernommen.

### Kleinere Entwickler: Pixel UI Studio
https://davideciullo.itch.io/pixel-ui-studio/devlog/1772977/simplex-eight-simple-styles-for-any-game

Der Entwurf eines schlichten, einheitlichen Flat-Looks und die Unterscheidung der Komponentenfamilien helfen dabei, die Mischung aus Retro-Kanten und modernem Layout ruhig zu halten.

### MDN: Web Animations API und Reduced Motion
https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API
https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API

MDN empfiehlt, Animationen nicht unbegrenzt per Fill-Mode zu konservieren, und beschreibt Risiken für Nutzer mit Bewegungsempfindlichkeit. Umsetzung: zeitlich begrenzte CSS-Transform-Animationen, DOM-Entfernung nach dem Durchlauf und vollständige Abschaltung bei `prefers-reduced-motion`.

### Firebase: atomare Transaktionen
https://firebase.google.com/docs/reference/js/database
https://firebase.google.com/docs/database/security/rules-conditions

Die Firebase-SDK-Dokumentation grenzt normale `set/update`-Schreibvorgänge von `runTransaction` ab. Bei konkurrierenden Hostklicks muss ein letzter Schreibvorgang nicht gewinnen dürfen, sondern eine Konsistenzbedingung über den **aktuellen gespeicherten Zustand** geprüft werden. Dafür verwendet die neue Implementierung eine Transaktion auf dem kompletten öffentlichen Spielstand. Ergänzend wird `newData` in den Regeln gegen das Quizbrett geprüft.

## 3. Entscheidungen
- Vier eigenständige, vom Projekt selbst generierte Figuren statt einer Kopie mit bloß geänderter Robenfarbe.
- Figuren halten keinerlei Gegenstände; Grundkörper, Gesicht und Umriss unterscheiden sich.
- Mobile: verkleinerte Figuren in eigener Leiste, kein dauerhaftes Overlay.
- Pixelrahmen bevorzugt für Board/Host/Gast, Editor bleibt nüchterner.
- Öffnungsanimation als kosmetische Abdeckung, niemals als Datenfreigabe-Mechanismus.
- Eindeutige ID statt Kategorie/Frageposition und Transaktionen gegen gleichzeitige Klicks.

## 4. Grenzen
Eine echte Firebase-Emulator-Prüfung der Sicherheitsregeln und ein Live-Test über neun getrennte Geräte wurden in dieser Sitzung nicht durchgeführt. Die Node-Tests simulieren konkurrierende Entscheidungen, prüfen aber nicht das verteilte Firebase-SDK/Regel-Engine-Verhalten. Ein veröffentlichtes Repository war mit dem verbundenen Konto noch nicht auffindbar; dieses Paket ist deshalb uploadbereit, aber nicht bereits auf GitHub Pages live.
