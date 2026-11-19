# Gameplay- und Fairness-Audit – BrainQuiz vs. Vlesks „Brainlag“

Stand: 19. November 2026. Fokus: **Spielregeln, Rundenablauf, Host-Autorität und Fairness**, nicht kosmetische UI-Kleinigkeiten.

## Referenz: tatsächlich gespieltes Brainlag

**Primärbezug:** Vlesk / Brainlag, League of Legends. Die konkreten Sonderregeln variieren zwischen Ausgaben. Deshalb darf man sie nicht unbemerkt als Standard in BrainQuiz einführen.

- [Brainlag mit Tolkin, Autophil, Noway, Broeki & Karni (19.06.2025)](https://legends.army/video/vle9savx): Jeopardy-ähnlicher Fragenaufbau; Buzzer- und Texteingabefragen; 50 % Punktabzug bei falschen Antworten, zweite Fragerunde. Die Regelvorstellung beginnt laut Videozusammenfassung bei ca. **00:28:04**.
- [Brainlag League Classic mit Kutcher, Sola, Kevin & Broeki (28.07.2026)](https://legends.army/video/vlecrncw): laut Sendungszusammenfassung **zwei Boards mit je fünf Kategorien und fünf Fragen**, Buzzer-, Text- und Kartenfragen; bei dieser Ausgabe **ein Joker und Bonuspunkte für bestimmte Fragen**. Regelvorstellung bei ca. **00:23:10**.
- [Vlesk – offizieller Brainlag League-of-Legends-Upload (17.03.2026)](https://www.youtube.com/watch?v=wqmXA3BuYkU): bestätigt, dass Brainlag als moderiertes Mehrspieler-LoL-Quiz mit wechselnden Gästen gespielt wird.

Einzelne Videozusammenfassungen/Transkripte können ungenau sein. Deshalb ist die **konkret implementierte BrainQuiz-Regel** verbindlich und wird in der Lobby erklärt; Sonderregeln aus einzelnen Brainlag-Ausgaben werden nicht ungefragt aktiviert.

## Behobene erhebliche Fehler

| Prüffall | Bisherige Folge | Korrektur |
| --- | --- | --- |
| Buzzer ist offen, Host zeigt Lösung | Bewertung wird umgangen | Client **und Host-Spielserver** verhindern Auflösung ohne Urteil. Gilt auch während **Pause** |
| Host kehrt mitten in der Frage zurück | Frage zählt als gespielt, ohne klare Warnung | Schaltfläche „Frage als gespielt beenden“ mit ausdrücklicher Bestätigung. Separate Option „Ungespielt zurücklegen“, nur ohne Antworten/Buzzerurteil/Punkte |
| Nach einer falschen Antwort wieder auf „ungespielt“ zurücksetzen | Verlust bereits abgezogener Punkte / unfairer Neustart | Host verbietet rückwirkendes Zurücklegen, auch wenn der aktuelle Buzzer wieder frei ist |
| Abwesendes auswählendes Team | Board bleibt auf Team stehen | Host kann **Auswahlrecht weitergeben**, ohne Punkte oder Frage zu verändern |
| Spieler wählen versehentlich ein Feld | Andere Hostkacheln wirken offen, sind serverseitig aber blockiert | Reserviertes Feld markiert; nur dieses Hostfeld erreichbar; Host kann Vormerkung aufheben |
| Host startet trotz unbereiter Spieler | Teilnehmer haben keine bewusste gemeinsame Startentscheidung | Namentliche Warnung und ausdrückliche Bestätigung, offene Anfragen eingeschlossen |
| Punkteliste sortiert Teams | Teamfarben können mit Platzwechsel rotieren | Teamfarbe durch **stabile Team-ID** statt aktuelle Platzierung bestimmt |
| Alle Teams/Spieler durch falsches Buzzern gesperrt | Der Host glaubt, dass ein Buzzer noch erwartet wird | Sichtbarer Hinweis: keine Buzzerrechte mehr, Lösung zeigen |
| Regeln für neue Gäste unklar | Streit über wer buzzern darf, Minuswertung und Antwortrechte | Öffentlich sichtbarer Regelabschnitt im Lobby-/Host-Setup |
| Finale vor leerem Board | Spiel kann mit vielen ungespielten Fragen enden | Warnung mit verbleibender Zahl vor abschließender Bestätigung |

## Bereits vorhandene und verifizierte wichtige Regeln

- **An einem Fragefeld ist das auswählende Team nicht der einzige Buzzerberechtigte.** Alle zugelassenen Teams sind grundsätzlich gleichberechtigt.
- **Host bestätigt korrekt oder falsch**, bevor Punkte entstehen. Falsch = −50 % des Fragewertes. Richtig = voller Fragewert und gemeinsame Auflösung. Eine falsche Antwort sperrt im Teammodus das betreffende Team nur für die laufende Frage.
- Eine Frage wird **verdeckt ausgewählt**, dann erst durch den Host für alle aufgedeckt.
- Bei Schreibfragen bleiben Antworten vor der gemeinsamen Auflösung privat; eine volle/halbe Wertung erfolgt durch den Host.
- Teamreihenfolge rotiert beim Abschluss einer Frage; nicht allein anhand der erspielten Punkte.
- Score-Audit und Korrektur-Funktionen sind vorhanden. Die Live-Quizdatei mit Lösungen ist nicht Teil der Gast-Snapshots.
- Das Schlussranking behandelt Gleichstände als gleiche Platzierung.

## Wichtig für echte Spielabende – verbleibende bewusste Entscheidungen

1. **Joker und 50-%-Bonus-Finalfragen** kommen in einzelnen Brainlag-Ausgaben vor, sind aber **nicht die derzeit vereinbarte BrainQuiz-Standardwertung**. Man sollte sie nur als *vor Spielstart angekündigte optionale Spielmodusregeln* einbauen, nicht heimlich auf alle Boards anwenden.
2. **Inter-Netzwerk-Buzzer-Latenz:** Der Host entscheidet nach Empfang der Signalpakete, nicht anhand unüberprüfbarer Client-Zeitstempel. Teilnehmer mit schlechterer Verbindung können damit benachteiligt sein. Die vorhandene Host-Freigabe des Buzzers ist für ernsthafte Wettbewerbe sinnvoll; ein vollkommen latenzneutraler Echtzeitwettbewerb ist mit P2P-WebRTC nicht garantierbar.
3. **Verbindungswiederherstellung:** Wenn Spieler disconnected sind, kann der Host deren Auswahlrecht ausdrücklich weitergeben. Für hohe Verlässlichkeit in CGNAT-/Firewall-Netzen ist weiterhin ein konfigurierter TURN-Dienst nötig.
4. **Regelabweichungen und Punktestreit:** Vor Beginn die Lobbyregeln zeigen. Bei Streit die vorhandene Punktehistorie/Korrektur nutzen, nicht per manuellem Live-Neustart gespielte Antworten zurücksetzen.

Die automatisierten Browser- und Node-Tests prüfen die implementierten Schutzmechanismen. **Ein Live-Buzzervergleich über verschiedene echte Internetanschlüsse** bleibt eine gesonderte Validierung und darf nicht als bereits bestanden dargestellt werden.
