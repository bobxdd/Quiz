# BrainQuiz 3.6.8 – Recherche und Umsetzung

## 1. Antworten und Emoji-Hinweise automatisch übernehmen

`change` kommt bei Textfeldern häufig erst beim Verlassen des Felds. Bei einer Ratephase mit Timer kann dieser Zeitpunkt zu spät sein. `input` reagiert auch auf Einfügen, Löschen und Änderungen über die Bildschirmtastatur. Eingabemethoden können dabei vorläufige Zeichen erzeugen. BrainQuiz wartet bei einer laufenden Zeichenkomposition auf `compositionend` und hält das Eingabefeld währenddessen stabil. Emoji-Hinweise werden nach wahrnehmbaren Zeichen segmentiert, damit etwa eine Flagge oder eine Person mit Hautton und einem verbundenen Symbol jeweils als ein Emoji zählt.

Reines Debouncing nach längerer Tipp-Pause hängt davon ab, dass jemand überhaupt aufhört zu tippen. Eine Nachricht pro Zeichen erhöht dagegen bei schnellem Tippen die Last auf der Host-Verbindung und der Speicherung. Die App sendet die erste Eingabe sofort, fasst weitere Änderungen kurz zusammen und überträgt vor der Deadline häufiger. Die Meldung „gespeichert“ folgt auf die Host-Bestätigung. Eine Versionsnummer stellt sicher, dass der Host bei Wiederholungen die neueste Eingabe behält. Wenn der Host die Runde bereits geschlossen hat, gelten die bis dahin eingegangenen Änderungen.

Bei freiem Text, Schätzfragen und Teamantworten zählt die letzte übernommene Eingabe. Leeren entfernt die Antwort. Die Emoji-Hinweise werden bei Einfügen, Auswahl aus der Tastatur und Entfernen direkt übernommen. Eine Teamrunde wird durch ein frühes Zeichen nicht automatisch beendet. Sobald alle berechtigten Teams einen Rateversuch gespeichert haben, kann der Host die gemeinsame Auflösung starten. Mit Timer startet die Auflösung nach Ablauf weiterhin per Host-Klick. Schriftliche Fragen ohne Timer gehen auf Host-Klick in die Auswertung. Sortieren behält die bewusste Abgabe einer Reihenfolge, Karten-Pins ihre bisherige Direktübernahme.

[MDN input](https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event), [MDN compositionend](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event), [Unicode UAX #29](https://unicode.org/reports/tr29/), [MDN WebRTC-Datenkanäle](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)

## 2. Ton und verlässliche Bestätigung beim Zeichnen

Die vorhandene Soundlogik reagierte auf Buzzer- und schriftliche Einzelwertungen. Eine Teamwertung beim Zeichnen lief über einen eigenen Pfad. Außerdem konnte der automatische Lösungstreffer schon dieselben Punkte anzeigen wie die erste manuelle Bestätigung. Dadurch sah ein erfolgreicher Klick aus wie ein Klick ohne Wirkung.

Die Wertung speichert jetzt die Bestätigung am Teamergebnis. Der ausgewählte Button bleibt hervorgehoben und der Host sieht „Bestätigt“. Der Klick aktiviert den vorhandenen Audiokontext im Rahmen der Browserregeln. Nach einer erfolgreichen Bestätigung oder Korrektur spielt der Host den passenden Richtig- oder Falschton mit den bestehenden Lautstärkeeinstellungen. Ein erneuter Klick auf dieselbe bestätigte Wertung behält die gespeicherte Wertung und bleibt still. Eine Korrektur berechnet die Punktedifferenz zur bereits gespeicherten Wertung.

[MDN Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), [Chrome Autoplay-Regeln](https://developer.chrome.com/blog/autoplay/), [W3C WCAG Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)

## 3. Jokeransicht für Teilnehmer

Eine dauerhaft geöffnete Gesamtübersicht kostet Platz und vermischt eigene Aktionen mit fremden Aufladungen. Eine überlagernde Schublade spart im geschlossenen Zustand Platz, kann aber im geöffneten Zustand Frage oder Eingabefeld überdecken. BrainQuiz zeigt das eigene Inventar direkt, darunter klappt „Andere Teams“ die Aufladungen der übrigen Teams auf. Die Spielaktion bleibt beim eigenen Team und erscheint, wenn sie in der jeweiligen Phase verfügbar ist. Der eingeklappte Zustand ist die Voreinstellung für andere Teams.

Das native `details`-Element bindet die Zustandsanzeige und Tastaturbedienung an dasselbe Element. Der Öffnungszustand bleibt bei Spielstandsänderungen erhalten. Auf kleinen Displays wird die Seitenleiste zu einem begrenzten Bereich unter der Hauptansicht. Wenn die Bildschirmtastatur Platz braucht, greift die vorhandene Kompaktansicht.

[W3C APG Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/), [MDN details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details), [GOV.UK Details](https://design-system.service.gov.uk/components/details/)

## 4. Host-Antwortgalerie und Auflösung

Die bisherige Galerie bekam in der Desktopansicht eine kleine untere Rasterzeile. Dadurch wuchs die Frage in den freien Platz, während Antwortkarten und Bewertung übereinander zusammengedrängt wurden. Eine höhere Mindesthöhe alleine hätte bei kurzen Fenstern die Frage und die Steuerung verdrängt. Auf ausreichend breiten Fenstern nutzt BrainQuiz zwei nebeneinanderliegende Spalten. In der rechten Spalte haben Antworten und Wertung ihre eigene Fläche. Die Wertungskorrektur ist dort im normalen Layout eingebunden und erhält dort ihren eigenen Platz. Bei kleinen Fenstern ordnen sich die Bereiche untereinander an. Lange Inhalte bleiben scrollbar.

Frage, Auflösung, private Notizen und Antwortkarten folgen weiterhin ihren Freigaberegeln. Die Kartenansicht behält ihre Koordinatenlogik und ihr Seitenverhältnis. Bei umfangreichen Bild- oder Textfragen behalten die Steuerung und der Punktestand ihren eigenen Platz.

[CSS Grid](https://www.w3.org/TR/css-grid-2/#min-size-auto), [W3C WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [W3C WCAG Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

## 5. Host-Ansicht vor dem Aufdecken

Vorher stand die Bedienung in einer großen, zentrierten Karte. Darunter folgten die Frage, der Spickzettel und die Joker. Das führte auch bei breiten Fenstern zu unnötigen Scrollwegen. Die neue Kopfleiste bündelt Titel, Antwortzeit, Rücksprung und Aufdecken. Eine Reroll-Anfrage erscheint dort zusammen mit den beiden Entscheidungen. Die private Lösung ist direkt unter der Kopfleiste erreichbar. Darunter bekommt die Vorschau den verbleibenden Platz. Die ausklappbaren Teamjoker liegen auf der rechten Seite in einer eigenen Spalte.

Die Abmessungen der Vorschau richten sich nach der tatsächlich verfügbaren Fläche. Medien behalten ihre Proportionen. Bei kurzem Fenster oder langen Inhalten kann der Vorschauinhalt scrollen, während die primären Host-Aktionen früh in der Ansicht stehen. Teilnehmer erhalten vor dem Aufdecken weiter die verdeckte Ansicht.

[W3C Grid-Reflow-Technik](https://www.w3.org/WAI/WCAG21/Techniques/css/C32), [MDN minmax](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/minmax), [MDN object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit)
