# BrainQuiz – veröffentlichen, Lobby beenden, Weltkarten-Atlas

Stand: 16. November 2026. Web/GitHub Pages only; keine Desktop-App.

## Abnahmeregeln
1. Online-Veröffentlichung ist die Grenze zwischen **Entwurf** und **laufendem Quiz**. Nach `publish` darf der Host keine Fragen mehr anlegen, löschen, umstellen oder neu veröffentlichen. Das gilt auch bei erneuten Renderings, direkter Aktionen-Auslösung, Ansichtwechseln und Wiederaufnahme der Host-Sitzung.
2. `public.published` ist im Host-Spielzustand persistiert, nicht nur ein versteckter Editor-Button. Bereits angelegte Teams, Punkte und Fragen dürfen durch Navigation nicht zurückgesetzt werden. Quiz-Präsentation bleibt Spielansicht; `Zurück zum Quizbrett` statt `Zurück zum Editor`.
3. Eine versehentlich erstellte Lobby lässt sich vor dem Start mit dem deutlich sichtbaren `Lobby schließen`-Knopf beenden. Der Host bestätigt die wirkliche Wirkung, Gäste erhalten den Verbindungsabbruch. Ein Quizentwurf mit Fragen wird als **lokales Quizbrett** gesichert; ein leeres Zufallszimmer legt keinen unnötigen Entwurf an. Danach wird die Startseite geöffnet und ein neuer Raum kann erstellt werden.
4. Bei veröffentlichten Spielen heißt der Knopf `Spielraum schließen`. Er beendet die gesamte Sitzung mit Bestätigung; ein geschlossenes Spiel darf nicht als aktive Lobby fortgesetzt werden.
5. Die Weltkarte bleibt geografisch unverzerrt: Natural-Earth-Quelle (equirektangulär, `viewBox=1000 500`, also **2:1**), Weltkoordinaten und Pins bleiben im selben Prozentsystem. Kein `preserveAspectRatio=none` und kein breitgezogenes `object-fit:fill`.
6. Stil: dunkle Ozeanfarbe, gedämpfte Länderflächen, klare Küsten/Grenzen, dezente Längen-/Breitenraster, dunkle integrierte Buttons, keine riesige weiße rechteckige Fläche. Karte und Steuerung nutzen ein gemeinsames max. Seitenformat; auf Mobilgeräten proportional verkleinert mit Pinch/Wheel/Plus-Minus-Zoom.

## Technische Quellen und Begründung
- MDN `preserveAspectRatio`: `xMidYMid meet` erhält die Proportionen des SVG-`viewBox`. https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/preserveAspectRatio
- MDN `object-fit`: `fill` ist streckbar, `contain` verzerrt nicht. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit
- NN/g – Confirmation Dialogs: Bestätigung vor irreversiblen Sitzungsabbrüchen soll Folgen konkret nennen; keine Bestätigung bei normalem Navigieren. https://www.nngroup.com/articles/confirmation-dialog/
- Bereits im Repository: `docs/map-tools.mjs` rechnet Kamera, Welt- und Bildschirmpositionen in Prozente um. Der Geodatensatz `docs/world-map.svg` ist Natural Earth 1:110m (public domain); weder Geometrie noch politische Grenzen wurden verändert.

## Tests und bewusst offene Grenzen
- Gesamte Node-Testsuite inklusive zuvor vorhandener Quiz/Live/P2P/Ansichtregressionen.
- Neuer Playwright-Fall `tests/publish-lock-lobby-exit-browser.py`: versehentliche Lobby schließen, Host kann erneut starten, Quiz veröffentlichen, Editor verschwindet, erzwungene ungültige DOM-Editoraktionen blockiert, Präsentationsrückweg richtig, Spielraum beenden.
- Erweiterter `tests/map-step3-browser.py`: 2:1-Ratio Desktop und Mobil, dunkle Kartenoptik, korrektes Speichern der Pins, Zoom/Pan ohne Antwortverschiebung, keine horizontale Überbreite.
- Vorhandene `team-lobby-step4-browser.py` aktualisiert: kein zweiter Publish; Teams bleiben erhalten.
- Grenzen: Simulierte PeerJS-Browserprüfung ist kein echter Browsernetzwerk-ICE/TURN-Test. Nicht durch Chromium nachgewiesen: Firefox/Safari und reale 10 Personen auf heterogenen Netzen.
