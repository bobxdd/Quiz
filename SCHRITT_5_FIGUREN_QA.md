# Schritt 5 – Seltene Pixelart-Randfiguren (16.11.2026)

## Verbindliche Vorgaben
- Ausschließlich die GitHub-Pages-Webversion; Host und Gäste benutzen dieselbe Website.
- Originalgrafiken `rogue.webp`, `blades.webp`, `mage.webp`, `druid.webp` bleiben unverändert.
- Figuren sind ein sehr kleines, möglichst seltenes Detail des dunklen, aufgeräumten Quiz-Designs. Keine Emotions-Popups oder automatisch aufpoppenden Buzzer-/Antwort-/Punkte-Reaktionsfiguren.
- Ein kleiner unveränderlicher Zuschauer am Desktop-Rand ist erlaubt; weitere Cameos nur selten hinter Brettkanten. Keine Klickflächen, Frageinhalte, Pins, Hinweise oder Chats verdecken.
- Schritt 6 (Animationen) wird getrennt bearbeitet. Die bisherige Frage-Coverbewegung bleibt vorläufig ohne mitbewegte Figur.

## Umsetzung
1. `docs/app.mjs`: Emotions-Auslöser und temporäre Figuren-Overlays entfernt. Startseite, Frage- und Antwortübersicht enthalten keine regelmäßig neu erzeugten Figuren.
2. Desktop-Spielansichten: eine ruhige, kleine, unbewegliche Figur am äußeren Bildschirmrand (`bq-screen-watcher`); auf schmalen und niedrigen Viewports verborgen.
3. Nur auf dem Quizbrett: zweiter Cameo, wenn eine abgeschlossene Runde `round >= 3 && round % 7 === 3` erfüllt. Höchstens ein Cameo zugleich, hinter dem Brett-Panel mit kleinen Händen am Panelrand; keine zufällig laufenden Timer.
4. `docs/characters.css` und `docs/actor-motion.css`: reaktive Animationen und doppelte historische Regelsätze entfernt, vier Original-WebP-Dateien unverändert.
5. `docs/pixel-theme.css`: tote frühere Figuren-Dock- und Reaktionsstile entfernt. `docs/sw.js`: Cacheversion aktualisiert, damit Browser keine alten Figureneffekte nachladen.
6. Tests aktualisiert und erweitert: statische Regresstests + Chromium-Geometrie-/Screenshotprüfung in `qa-artifacts`, mobile Ansichten, Rückkehr zum Editor.

## Recherche und technische Entscheidungen
- **CSS-Stapelkontexte (MDN):** `z-index`, `isolation`, `transform` und `clip-path` können eigene Stapelkontexte schaffen; deshalb sind Figur (z=2) und reales Panel (z=3) bewusst Geschwister unter derselben Szenenwurzel statt einer überlagernden Pseudokulisse. https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Positioned_layout/Stacking_context
- **Reduzierte Bewegung (MDN):** keine neue Dekorationsanimation. Bestehende Coverbewegung unter `prefers-reduced-motion: reduce` deaktiviert. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion
- **Playwright:** `boundingBox`, auto-retrying assertions und Screenshots mit deaktivierten Animationen überprüfen tatsächliche UI-Geometrie, nicht nur Quelltext. https://playwright.dev/docs/api/class-locator und https://playwright.dev/docs/test-assertions
- **GitHub Actions:** Pull-Request-Checks getrennt von Produktion, Deployment nur bei erfolgreichem `main`-Push. https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow

## Abnahme- und offene Tests
- Vollständige `npm test`-Suite; statische Integritätsprüfung.
- Chromium: Start/Editor ohne Cameo, Desktop-Spiel mit genau einem Zuschauer, seltener zweiter Akteur hinter Panelkante, korrekte Schichten, mobile Ansicht ohne störende Figuren und horizontales Überlaufen.
- Regressionen: bestehende Lobby-, Karten-, Fragen-, Editor- und Mehrspieler-Browsertests.
- **Noch nicht nachgewiesen:** reale mobile Safari-/Firefox-Ansichten; PeerJS/WebRTC über verschiedene echte Netzwerke; subjektive visuelle Qualität auf allen Geräten. Kein Test hier darf diese Lücken als bestanden ausgeben.

## Veröffentlichung
Änderungen zuerst auf `feat/step5-quiet-pixel-cameos` bündeln, per Pull Request auf dem Branch prüfen und erst bei grünem Check nach `main` übernehmen. Keine ungeprüften Zwischenstände auf GitHub Pages.
