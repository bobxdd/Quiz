# BrainQuiz Studio 2.8 – unveränderte Originalfiguren, animierte Gesten

- Nutzerseitig bereitgestellte **vier exakte Charakterdesigns** als Bildquellen (Originale unter `artwork/originals/`). Reihenfolge: violett/Dolch, rot/Doppelklingen, violett-blau/Magie, grün/Natur.
- Keine neu generierten Ersatzfiguren. `docs/characters/` enthält nur technisch freigestellte, für Browser optimierte Ausschnitte dieser Bilddateien.
- Alle vier Figuren als kompakte, responsive Reihe auf Startseite und im Spiel, statt der fehlerhaften Bildschirmrand-Dekoration.
- Animationsgesten für neue Frage, gemeinsame Antwortübersicht, einzelne Antwortaufdeckung, Musterlösung, Buzzer und Punktezuteilung. Animationen bewegen die Original-Sprites per CSS, ohne Charakterdesign zu ändern.
- `prefers-reduced-motion` unterdrückt Effekte; Inhalte und Buttons bleiben uneingeschränkt bedienbar.
- Cache-Version 2.8.0 und Regressionstests für Spritepfade, Assets und Aktionen.

**Hinweis:** Die vier Bilder sind Standillustrationen. Körperteile werden nicht gesondert geriggt; die Animationen sind sichtbare Gesten, Bewegungen und Effektpartikel der unveränderten Figuren.
