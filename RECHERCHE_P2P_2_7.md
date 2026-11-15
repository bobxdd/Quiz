# Architekturvergleich — GitHub Pages ohne Firebase

## Fragestellung

Wie kann BrainQuiz Studio kostenlos als GitHub-Pages-Website mit bis zu acht echten Gästen gleichzeitig gespielt werden, ohne Firebase, ohne installierte App und ohne eigenen Server? Was wurde beim öffentlichen Projekt Straßenbingo tatsächlich umgesetzt?

## Nachweise und Quellen

1. **GitHub Pages**, offizielle GitHub Docs: statisches Hosting, kein langlebiger Applikationsserver. https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
2. **PeerJS**, offizielle Website und Dokumentation: WebRTC Data Connections; öffentliches Cloud-Peerserver-Angebot zum Signalisieren. https://peerjs.com/ und https://peerjs.com/docs/
3. **WebRTC.org**, Connectivity/ICE: direkte Datenkanäle benötigen ICE; STUN ermittelt öffentliche Adressen, TURN kann schwer erreichbare Netzwerke überbrücken. https://webrtc.org/getting-started/peer-connections
4. **MDN**, RTCPeerConnection / RTCDataChannel: Eigenschaften und Lebenszyklus der Datenkanäle. https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
5. **Straßenbingo** von D0minatxr, öffentlicher Quellcode: https://github.com/D0minatxr/strassenbingo/blob/main/index.html. Dort steht ausdrücklich, dass PeerJS/WebRTC für den Spielbetrieb benutzt wird und der Host-Browser der Spielserver ist; `new Peer(...)` sowie DataChannel-Handler liegen im `index.html`-Code, etwa im Bereich um Zeile 2505. Supabase wird zusätzlich für Wortlisten/Accounts/Bestenlisten benutzt, nicht zwingend für den laufenden Spielraum.
6. **GitHub Actions / Pages Deployment**, offizielle GitHub-Dokumentation: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## Vergleich

| Variante | Vorteile | Nachteile | Entscheidung |
|---|---|---|---|
| Nur GitHub Pages | Keine externen Konten, null Server | Kein zentraler Live-Spielstand, kein hostübergreifendes Live-P2P | Reicht allein nicht |
| Pages + Firebase | Gute Cloud-Persistenz, serverseitige Regeln, Reconnect | Externes Firebase-Projekt, Datenbankkonfiguration | Auf Nutzerwunsch entfernt |
| Pages + WebRTC / PeerJS | Keine eigene Echtzeitdatenbank, Host kontrolliert Antworten, einfache Einladungen | Host muss online sein, PeerJS Cloud, NAT-/Firewall-Probleme | **Version 2.7** |
| Pages + Cloudflare Workers | 24/7 Räume und dauerhafter Host-Server | Separater Cloud-Service, eigener Backendbetrieb | Für später denkbar |
| Pages + GitHub API | Kein eigener Hostingservice neben GitHub | Ratenlimits, öffentliches Repo, kein latenzarmer Chat/Buzzer, Token-Probleme | Ungeeignet |

## Implementierungsentscheidungen

**Host-authoritativ, nicht Broadcast-all.** Das Hostquiz bleibt nur beim Host. Der Host sendet an jeden Gast jeweils eine separate Momentaufnahme; die Antworten der anderen Gäste bleiben bis zu einer bewussten Aufdeckung aus dieser Momentaufnahme entfernt.

**Runden/Fragen strikt separiert.** Alle Fragen tragen IDs. Der Host prüft jede Frage vor der Öffnung gegen das veröffentlichte Brett, markiert sie verbraucht und erhöht die Rundennummer atomar innerhalb seines JavaScript-Event-Loops. Gastaktionen müssen zur aktuellen Runde gehören. Einzelantworten dürfen nur einmal geschrieben werden.

**Verbindungswiederherstellung.** Gäste behalten ihren zufälligen Teilnehmernachweis in `sessionStorage`; Host kennt den Nachweis aus der jeweiligen Anmeldung. Eine neue Verbindung für dieselbe UID ersetzt die alte. Dadurch funktionieren Netzunterbrechungen, ohne private Antworten zu veröffentlichen.

**Anpassung der Hostrolle.** Der Host darf nicht gleichzeitig zwei konkurrierende Sitzungen unter demselben Raumcode betreiben. Der PeerJS-Server lehnt eine doppelte Peer-ID ab. Ein LocalStorage-Backup erlaubt das explizite Wiederaufnehmen beim erneuten Aufruf.

**Mögliches Scheitern.** Der PeerJS-Cloud-Signalisierungsserver ist extern und kostenlos ohne SLA. Ohne TURN kann ein direkter WebRTC-Kanal scheitern. Dies ist keine 100%-Garantie für beliebige Internetanbieter. Echtes geräteübergreifendes ICE/NAT muss im Alltag getestet werden.

## Datenschutz-/Safety-Notes

- Keine Admin- oder Service-Account-Schlüssel im Repository
- Hostlösungen und private Antworten nicht in den öffentlichen GitHub-Pages-Build
- PeerJS-Library wird per fest gepinnter CDN-Version 1.5.5 geladen; bei CDN-Ausfall kann der Verbindungsaufbau scheitern
- WebRTC Data Channels verschlüsseln Spieldaten während der Übertragung, aber Peer-to-Peer-Verbindungen können Netzwerkmetadaten offenlegen
- Eigener Teamchat wird an Teammitglieder und Host gesendet, nicht an andere Teams
