# Schritt 6 – ruhige Pixelart-Aufdeckung und einmaliger Kartendolch

Stand: 16. November 2026 · GitHub-Pages-Webversion

## Nutzerwunsch und konkrete Abgrenzung

- Keine Emotionen, Punkte-Jubel, Buzzer-Reaktionen oder zusätzlichen Figuren-Popups.
- Bei normalen Fragen deckt **eine** der vier vorhandenen Figuren die eigentliche Abdeckung einmal beim Öffnen auf. Vier Bewegungsrichtungen, keine hektischen Effekte: ca. 2,9 Sekunden.
- Bei Weltkartenfragen wirft **eine** der vier Figuren bei der Freigabe der **richtigen Lösung** **einmalig** einen Dolch: Die Figur erscheint, hebt erkennbar einen gezeichneten Arm mit sichtbarem Dolch, holt aus und wirft. Der Dolch fliegt deutlich erkennbar zum richtigen Punkt und wird erst beim Einschlag zum endgültigen Lösungsmarker.
- Der Anfangspunkt, die Animationsdauer und die Pose sind bei allen vier Figuren gleich. Die vorhandenen unveränderten Original-Pixelartbilder liefern nur unterschiedliche Charakteransichten; ihre Gesichtsausdrücke werden nicht manipuliert.
- Die Karte behält alle Pin-Daten im Weltkoordinatensystem. Auf Mobilansichten müssen Overlay und Karte weiterhin bedienbar sein.
- Nutzer bevorzugt ruhige, sauber lesbare, dezente und nicht hektische Bewegungen. Daher eine ca. 4,1-sekündige Wurfszene und ein ca. 1,15-sekündiger Dolchflug.

## Recherchierte Grundlagen und Abwägung

1. **Positionierung und CSS-Stacking-Contexts** – https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Positioned_layout/Stacking_context . Isolierte Stacking-Contexts, `transform`, `position: fixed` und `clip-path` ändern die tatsächlich sichtbaren Schichten. Die animierte Figur/Dolch werden daher in einer eigenständigen, klickdurchlässigen, top-level Ebene angezeigt; die tatsächlichen Pin- und Karten-Elemente bleiben DOM-seitig an ihrem Ort. Frageabdeckung ebenfalls separat, damit ein App-Render während einer Runde die laufende Animation nicht zerstört.
2. **Web Animation Timing / CSS Animations** – https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API und https://developer.mozilla.org/en-US/docs/Web/API/Element/animationend_event . Gleichmäßige kontrollierte Schlüsselmomente für Armheben, Flug und Einschlag, plus `animationend`-Bereinigung und zusätzlich ein Cleanup-Timeout. Animationen sollen nicht in einer Endlosschleife laufen oder die Spiellogik blockieren.
3. **Reduced motion / Zugänglichkeit** – https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion . Bei angeforderter Bewegungsreduktion wird die korrekte Lösung ohne ablenkende Bewegung eingeblendet.
4. **Playwright echte Browserprüfung** – https://playwright.dev/docs/actionability und https://playwright.dev/docs/test-assertions . Klick-Zugänglichkeit, sichtbare Originalsprite-Elemente, Laufzeit, tatsächliche Elementbegrenzungen und Marker-Positionen gehören in Chromium-Browserchecks, nicht nur in Text-/Regex-Tests. Für Zwischenschritt-Screenshots muss `animations='allow'` aktiv sein, weil Playwright endliche Animationen sonst vorspult: https://playwright.dev/docs/api/class-page .

## Koordinaten und Datensicherheit

Map-Weltkoordinaten sind Prozentwerte von 0–100. `mapScreenPosition` wandelt diese anhand von Zoom/Mittelpunkt in Positionen der aktuell sichtbaren Karten-Viewport um. Der fertige Lösungsmarker wird aus der Datenansicht aufgebaut. Die Wurfsteuerung liest seine **tatsächlich dargestellten** Prozente und den Viewport-`getBoundingClientRect()` und rechnet nur diesen Punkt in Pixelkoordinaten um. Während Zoom/Pan können Marker-Stiländerungen verfolgt und die Flug-Endpunkte neu berechnet werden; die Lösung wird dadurch nicht verändert.

Die Clients kennen die geheimen Koordinaten erst nach legitimer Host-Freigabe. Der Wurf selbst sendet keine zusätzlichen PeerJS-Daten. Die Einmaligkeit wird clientseitig über `room:round:questionID` begrenzt; sie ist keine Autorisierung und verändert den Host-Spielstand nicht.

## Getrennte Qualitätsprüfung

- `npm run check:syntax`: alle JS-Module und ihre Imports müssen existieren; neue Module und Stylesheets müssen im Offline-Shell-Cache liegen.
- `npm test`: alle bisherigen Node-Tests und neue Step-6-Tests zu Zeit, Koordinaten, Charakter-Skins, Einmaligkeit und Bewegungspräferenzen.
- `tests/map-step3-peer-browser.py`: echte Chromium-Fenster mit PeerJS-Simulation, Geheimhaltung vor der Lösung, anschließend sichtbarer Darsteller, Armbewegung, Dolchflug, Aufprall, präzise Position und keine verdeckten Klickflächen.
- `tests/step6-question-cover-browser.py`: echte DOM-Aufdeckung, einmal pro Frage, nicht erneut bei App-Redraw, neue Runde darf erneut animieren, reduzierte Bewegung deaktiviert den Effekt.
- Alle bisherigen Browserprüfungen: Lobby, Karteneditor, Antwortübersicht, Quizbrett, Mobilgrößen.
- **Keine Behauptung realer PeerJS/ICE/TURN-Tests, Safari/Firefox oder optischer Perfektion**, solange nicht ausdrücklich auf diesen Zielgeräten geprüft.

## Verhalten bei Testfehlern

- Mehrdeutige Button-Selektoren dürfen nicht einfach durch force-klicken ignoriert werden.
- Ein echter Trefferflächenfehler an Host-Bedienelementen wird im CSS-Layout korrigiert, nicht durch Deaktivierung der Klickprüfung. Die Karten- und Antwortübersicht müssen ihre reale Höhe im Scrollfluss einnehmen.
- Deployment erfolgt erst nach erfolgreicher PR-Prüfung. `main` und GitHub Pages bleiben vorerst auf Schritt 5, bis Schritt 6 sicher freigegeben ist.
