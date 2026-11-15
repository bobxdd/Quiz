# BrainQuiz Studio 2.7 — Firebase-freier P2P-Mehrspielerbetrieb

- Browser-Host als authoritative Spielinstanz statt zentraler Firebase Realtime Database
- PeerJS 1.5.5 WebRTC Data Channels zum Austausch mit bis zu 8 Gästen
- PeerJS Cloud als kostenloser externer Signalisierungsdienst; keine Server- oder Firebase-Einrichtung erforderlich
- Geheimes Host-Quiz bleibt ausschließlich im Host-Browser, inklusive lokaler Sicherung und Restore; keine Uploads in GitHub
- Strikt gefilterte persönliche Zustände: eigene Antwort, eigener Teamchat, öffentlich freigegebener Spielstand
- Host überprüft Anmeldung, Freigabe, 8-Spieler-Limit, Team, Buzzer, Runde und doppelte Antworten
- Fragenöffnung mit geprüfter Frage-ID, Kategorie, Punkten und Rundennummer; wiederholte/verspätete Fragenaufrufe werden abgewiesen
- Wiederverbindung für Gäste nach Netzwerkverlust; Host-Raum kann nach Browserneustart aus lokaler Sicherung neu geöffnet werden
- Website-Workflow `.github/workflows/pages.yml` benötigt keine Firebase-Variablen mehr
- Firebase-Client, Firebase-Konfiguration, Datenbankregeln und Firebase-Workflow vollständig aus dem Produkt entfernt
- Pixel-Glass-Design, vier Figuren, Fragen-Animationen, 5×5-Quizbrett, modularer Editor, Punkte und Antwortkarten beibehalten
- Alte Firebase-Testbrücken und 2.6-Dokumentation durch aktuelle P2P-Tests und Anleitungen ersetzt

Version: `2.7.0`.
