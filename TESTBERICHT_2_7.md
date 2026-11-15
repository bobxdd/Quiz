# Testbericht — BrainQuiz Studio 2.7 (PeerJS / WebRTC)

## Ausgeführt

- `npm run check:syntax` — PASS
- `npm test` — **174/174 PASS**, inkl. P2P-Netzwerkmodellen, Sicherheits-/Konkurrenztest und 8-Spieler-Limit-Test
- `python3 tests/peer-2_7-browser.py` — PASS, reale Chromium-Host- und -Gastansicht, Nachrichten durch eine simulierte PeerJS-Transportebene zwischen zwei Fenstern
- `npm run build:pages` — PASS; keine Firebase-Variablen benötigt

## P2P-Regressionsfälle

- Host erstellt den eindeutigen Raum mit 16-stelligem Code
- Gast meldet sich an, ist zunächst nur im Warteraum, wird vom Host freigegeben
- Fremde Teamnachrichten und private Antworten verlassen nicht den Host bzw. das eigene Team
- Host-Quiz mit Lösungen wird nie im vollständigen Gast-Snapshot übertragen
- Rechteumgehung durch RPC-Aufrufe (`score`, `reveal`, `hostAssign`) wird abgewiesen
- Buzzer: bei gleichzeitigem Zugriff akzeptiert der Host nur einen ersten Gast
- Nicht berechtigtes Buzzer-Team kann nicht antworten
- Antwort doppelt, falsche Runde, ungültige/alte Frage, Vererbungssondernamen `constructor`, `__proto__` werden abgewiesen
- Drei gleichzeitige Host-Frageöffnungen: genau eine kommt durch
- Host kann seinen lokalen privaten Quizstand wiederherstellen
- Gastantwort bleibt bis zur expliziten Host-Aufdeckung verborgen
- Vier Maskottchen-Dateien laden im Browser ohne Fehler

## Nicht durch reale Außennetze nachgewiesen

- Verbindung durch den echten öffentlichen PeerJS-Cloud-Signalisierungsserver
- direkter WebRTC-ICE-Prozess zwischen unterschiedlichen Netzwerken, besonders CGNAT/symmetrisches NAT
- Last- und Reconnect-Test mit **acht echten** Gästen plus Host
- Produzierte GitHub-Pages-Website und automatisierter Workflow nach einem echten Upload
- Schutz gegen absichtlich manipulierte/gefälschte Netzwerkpakete über die bislang simulierten adversarialen Fälle hinaus

Die Tests belegen eine integrierte und lokal nachvollziehbare Umsetzung, aber keine garantierte weltweite Konnektivität. Für einen öffentlichen Spielabend zuerst eine Testpartie mit getrennten Geräten durchführen.
