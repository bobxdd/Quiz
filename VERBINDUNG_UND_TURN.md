# BrainQuiz – Verbindungen, TURN und Fehlerdiagnose

Stand: November 2026 · Hosting: statische GitHub Pages + PeerJS Cloud + WebRTC-Datenkanäle.

## Was funktioniert – und was ein Relay benötigt

Der PeerJS-Cloud-Dienst übernimmt **Signalisierung**, aber weder die Verbindung der Spielnachrichten noch TURN. Die eigentlichen Daten (Quizbrett, Buzzer, Antworten und Teamchat) laufen zwischen Host-Browser und Gästen über WebRTC DataChannels. GitHub Pages kann keinen TURN- oder WebSocket-Spielserver bereitstellen.

**Stand der Korrektur vom 19. November 2026:** BrainQuiz verwendet für normale Host- und Gastverbindungen wieder die **unveränderte PeerJS-Standard-ICE-Konfiguration**, wie es auch `D0minatxr/strassenbingo` macht. Damit überschreiben wir nicht mehr unabsichtlich die Standardliste mit STUN-only-Einträgen. Wer einen Raumcode erhält, braucht dadurch keine eigene TURN-Konfiguration mehr, um den normalen Verbindungsversuch zu starten.

**Wichtig zur tatsächlichen Verfügbarkeit:** Die PeerJS-Bibliothek enthält zwar die historischen Adressen `turn:eu-0.turn.peerjs.com:3478` und `turn:us-0.turn.peerjs.com:3478`, das PeerJS-Projekt hat seinen kostenlosen TURN-Dienst jedoch am **5. Dezember 2023 offiziell eingestellt**. Daher sind diese eingebauten Server **keine nachgewiesen funktionierende Relay-Infrastruktur**. Die Korrektur beseitigt eine Konfigurationsabweichung zum Straßenbingo, garantiert aber keine erfolgreichen ICE-Verbindungen aus allen Netzen. Für verlässliche Erreichbarkeit auch bei restriktiven NATs wird weiterhin ein tatsächlich betriebsbereiter TURN-Dienst benötigt; ein Live-Test auf verschiedenen Internetanschlüssen ist unabdingbar.

Quellen: [PeerJS-Freie-TURN-Einstellung](https://github.com/orgs/peers/discussions/1172), [PeerJS-Standardkonfiguration](https://github.com/peers/peerjs/blob/master/lib/util.ts), [Straßenbingo-Netzwerkcode](https://github.com/D0minatxr/strassenbingo/blob/main/index.html).

Offizielle Grundlagen: [PeerJS FAQ](https://peerjs.com/client/faq/), [PeerJS Server](https://peerjs.com/server/getting-started), [MDN WebRTC-Protokolle](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols), [Cloudflare STUN](https://developers.cloudflare.com/realtime/turn/faq/).

## TURN einrichten

1. Richte bei einem vertrauenswürdigen TURN-Anbieter einen Dienst ein, der WebRTC-Clients, TURN/UDP und möglichst TURN/TLS auf Port 443 anbietet. Es sind vollständige `urls`, `username` und `credential` erforderlich. Nutze nach Möglichkeit kurzlebige Zugangsdaten.
2. Öffne vor dem Verbinden auf **Host und jedem Gast** BrainQuiz → **Verbindung & Datenschutz → Eigenen TURN-Relay einrichten**. Trage z. B. eine vom Anbieter bereitgestellte Adresse `turns:relay.example:443?transport=tcp` und die dazugehörigen echten Anmeldedaten ein. Diese Beispieladresse ist kein funktionsfähiger Server.
3. Drücke **TURN-Daten übernehmen**, dann **TURN-Verbindung prüfen**. Der Test wartet auf einen TURN-Relay-ICE-Kandidaten. Er sendet weder Antworten noch Netzwerkadressen an andere Quizteilnehmer.
4. Wenn der Host bereits einen Live-Raum geöffnet hat: Einstellungen → **Host-Verbindung neu starten**. Der Quizstand und die Punkte bleiben erhalten; zugelassene Gäste verbinden sich automatisch erneut. Gäste müssen ihre TURN-Einstellung ebenfalls im eigenen Browser setzen und neu verbinden.
5. Teste mit zwei getrennten Anschlüssen, z. B. Host im WLAN und Gast über mobile Daten. Das ist der wichtige End-to-End-Nachweis.

TURN-Zugangsdaten werden nur im **sessionStorage des jeweiligen Browser-Tabs** gespeichert, nicht in den GitHub-Dateien, nicht in Einladungslinks und nicht an andere Spieler gesendet. Geteilte Geräte sollten das Tab nach der Runde schließen. **Nicht in ein öffentliches Repository committen.**

Der TURN-Test beweist nur, dass ein Browser einen Relay-Kandidaten erhalten hat, **nicht** die erfolgreiche Verbindung zu einem bestimmten Host. Bei einem Verbindungsfehler sind immer beide Seiten zu prüfen.

## Wiederverbinden und Fehleranalyse

- **Host nicht erreichbar:** Raumcode, geöffneten Host-Tab, Internet und PeerJS Cloud prüfen. Ein nicht gefundener Host ist nicht dasselbe wie ein bereits vergebener Host-Raumcode.
- **WebRTC/ICE fehlgeschlagen:** TURN aktivieren bzw. Adresse, Transport, Port und Zugangsdaten **auf beiden Seiten** prüfen. Der automatische zweite Gast-Verbindungsversuch ersetzt keinen TURN-Server.
- **Verbindung nach Beginn unterbrochen:** Die Gäste versuchen sich automatisch wieder zu verbinden. Zusätzlich ist **Erneut verbinden** verfügbar. Diese Funktion behält die bereits zugewiesene Gastidentität bei und vergibt keine neuen Punkte.
- **Host wechselt den Anschluss oder TURN-Dienst:** Über **Host-Verbindung neu starten** den aktuellen Spielstand behalten und die Netzwerkverbindung neu anmelden.
- **Fehlerbericht kopieren:** Einstellungen beim Host bzw. beim Gast in der Wiederverbindungsanzeige. Der Bericht enthält Browser-Typ, Rolle, ICE-Status, Fehlercode und TURN-Status – **keine IP-Adressen, Raumgeheimnisse, Antworten oder Relay-Passwörter**.
- In Chrome hilft `chrome://webrtc-internals` bei einem echten fehlgeschlagenen Verbindungsversuch. Die dort angezeigten Rohdaten können private Netzwerkadressen enthalten; teile nur redigierte Ausschnitte.

## Konkreter Status und offene Voraussetzungen

Verbessert werden die Fehlerkategorien, automatische Verbindungswiederholung, manuelle Wiederverbindung, hostseitige Neuinitialisierung, STUN-Auswahl, TURN-Prüfung und die Aufräumlogik für nie angemeldete Gastkanäle.

**Keine zuverlässig verfügbare TURN-Infrastruktur ist mit dem Repository verbunden.** Die von PeerJS historisch voreingestellten kostenlosen Relays sind eingestellt. Deshalb bleiben echte Verbindungen durch restriktives NAT ohne einen aktuell betriebenen Relay-Dienst ein externer Konfigurationspunkt. Es wäre irreführend, allein nach einem erfolgreichen GitHub-Build oder lokalen Browser-Test zu behaupten, dass der Fernzugriff für alle Netzwerke funktioniert. Vor einer öffentlichen Multiplayer-Runde sollte mindestens ein erfolgreicher Test über zwei unterschiedliche Internetanschlüsse stattfinden.
