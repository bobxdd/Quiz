# BrainQuiz Studio 2.7 — GitHub Pages + PeerJS (ohne Firebase)

**Ein Website-Link für Host und bis zu acht Gäste.** Host und Teilnehmer benutzen dieselbe GitHub-Pages-Seite. Die Quizrunde ist Peer-to-Peer: Der Browser des Hosts hält den maßgeblichen Raumzustand und tauscht per WebRTC Data Channels gezielte Nachrichten mit den Gästen aus. Der kostenlose öffentliche PeerJS-Cloud-Dienst vermittelt die Verbindung. Weder Firebase noch Supabase, eigene Login-Konten, ein Rechner als dauerhafter Server oder ein kostenpflichtiger Cloud-Plan sind zur Einrichtung erforderlich.

**Wichtig:** Das Spiel ist online verfügbar, selbst wenn dein PC ausgeschaltet ist, **solange du keinen eigenen Raum hostest**. Während einer laufenden Runde muss das Browserfenster des Hosts verbunden bleiben. Der kostenlose PeerJS-Verbindungsdienst bietet keine Verfügbarkeitsgarantie; restriktive NAT-/Firewall-Konstellationen können mangels eigenem TURN-Server scheitern. WebRTC teilt für die direkte Verbindung technische Netzwerkmetadaten zwischen den Browsern.

## In deinem GitHub-Konto veröffentlichen

1. Öffne das vorhandene öffentliche Repository **https://github.com/bobxdd/Quiz**.
2. Lade den **entpackten** Inhalt dieses ZIPs in das **Repository-Root** hoch, nicht die ZIP-Datei selbst. Insbesondere gehören `.github/workflows/pages.yml`, `docs/` (mit `index.html`, `peer-client.mjs` und Grafiken), `scripts/`, `package.json` sowie `tests/` ins Repository. GitHub-Webupload per **Add file → Upload files** kann versteckte Ordner übersehen; prüfe danach ausdrücklich `.github/workflows/pages.yml`.
3. Gehe zu **Settings → Pages → Build and deployment → Source = GitHub Actions**.
4. Unter **Actions → BrainQuiz Studio — Test & Publish GitHub Pages** sollte der Workflow nach dem Push anlaufen. Du kannst ihn dort auch über **Run workflow** manuell starten.
5. Wenn **Deploy** grün ist, wird die Seite voraussichtlich unter **https://bobxdd.github.io/Quiz/** erreichbar sein. Das ist keine bestätigte Live-Adresse, bevor ein erfolgreicher Deploy stattgefunden hat.
6. **Keine Firebase-Variablen, keine Datenbank-Regeln, kein Firebase-Projekt, keine Admin-Keys oder Cloudflare-Konfiguration** erforderlich.

## Quizabend

1. Website als **Host** öffnen → **Online-Raum erstellen**.
2. Fragen im Editor anlegen/importieren und **Quiz live veröffentlichen**.
3. Über **Einladung kopieren** den Link mit Raumcode an Freunde senden. Sie öffnen denselben GitHub-Pages-Link, wählen einen Anzeigenamen und warten auf die Hostfreigabe.
4. Host ordnet die Anfragen Teams zu. Dann Frage auf dem Quizbrett auswählen, Antworten sammeln, einzeln aufdecken, bewerten.
5. Buzzer und private Teamchats werden vom Host kontrolliert; jeder Gast erhält nur seine eigenen Antworten und Teamnachrichten. Das vollständige Lösungsquiz und private Rundendaten werden **nicht** an andere Browser verteilt.
6. Host-Fenster offen lassen. Ein Host kann seinen Raum bei Seiten-Neuladen über **Raum fortsetzen** anhand einer lokalen Sicherung wiederaufnehmen; die Gäste können sich danach erneut verbinden. Für kritische Quizsets zusätzlich den Datei-Export benutzen.

## Was bleibt gespeichert?

- **Host-Browser**: vollständiges Quiz inklusive Lösungen und ein lokales Raum-Backup im `localStorage`. Das Backup liegt *nicht* im GitHub-Repository, und es gibt **keinen** 24/7-Cloud-Speicher für offene Räume.
- **Gast-Browser**: temporäre P2P-Spieleridentität im `sessionStorage`; beim Neuladen wird derselbe Browser wiedererkannt, sofern die Sitzung erhalten blieb.
- **GitHub Pages**: ausschließlich öffentliches Programm, Pixelgrafiken und Skripte, **keine** Quizantworten oder Spielerdaten.
- **PeerJS Cloud**: Signalisierung zum Verbindungsaufbau; eigentliche Spielnachrichten laufen über WebRTC-Kanäle. PeerJS Cloud ist ein externer kostenloser Dienst und kein Bestandteil von GitHub.

## Grenzen

- Ohne laufenden Host-Browser **kein aktiver Raum**, obwohl die Website jederzeit geladen werden kann.
- Manche Netze mit symmetrischem NAT oder Unternehmensfirewalls benötigen TURN. Die Version stellt keinen eigenen TURN-Server und garantiert daher keine Verbindung zwischen beliebigen Netzen.
- Bei Verbindungsunterbrechungen kann der Gast erneut verbinden; ein kompletter Host-Tab-Verlust unterbricht laufende Spielrunden bis zur Rückkehr des Hosts.
- **Peer-to-Peer-Sicherheit:** Das Quiz wird nur vom Host bewertet. Nicht freigegebene Daten werden vor dem Versand gefiltert. WebRTC verschlüsselt den Transport. Das verhindert nicht, dass ein technisch versierter Gast öffentliche Daten untersucht oder seinen eigenen Browser manipuliert; sicherheitskritische Entscheidungen bleiben beim Host.
- Die Funktionalität wurde mit simuliertem PeerJS in Node.js und mehreren Browserfenstern getestet. Ein externer PeerJS-Cloud-, ICE-, TURN- oder echter 9-Geräte-Test steht noch aus.

## Entwicklerprüfung

```sh
npm run check:syntax
npm test
python3 tests/peer-2_7-browser.py
npm run build:pages
```

Der Python-Browsercheck benötigt Chromium und Playwright. Der GitHub-Actions-Workflow selbst führt Syntax- und JavaScript-Tests sowie die statische Seitenprüfung aus. Die Browserchecks sind nicht Teil des Deploys.

## Dateien

- `docs/app.mjs`: Host-, Gast-, Quiz- und Editoroberflächen
- `docs/peer-client.mjs`: Host-authoritative PeerJS/WebRTC-Nachrichten, Raumzustand, Datenschutzfilter, Wiederverbindung
- `docs/question-flow.mjs`: atomare Fragenöffnung und Runde-ID-Prüfung
- `docs/sw.js`: Offline-Cache **nur für öffentliche UI-Dateien**; keine Live-Daten
- `.github/workflows/pages.yml`: Test + Veröffentlichung auf GitHub Pages
- `tests/peer-2_7.test.mjs`: Isolations-, Sicherheit-, Team-, Buzzer- und Doppelaufruf-Tests
- `tests/peer-2_7-browser.py`: tatsächliche Host-/Gast-Browserdarstellung mit simuliertem PeerJS

**Repository-Hinweis:** Diese Version enthält bewusst **keine `README.md`**, weil du die Datei im GitHub-Repository zuvor entfernt haben wolltest. Nutze `START_HIER.md` für die Einrichtung.
