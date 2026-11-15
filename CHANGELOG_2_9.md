# BrainQuiz Studio 2.9 — Zwei Szenen, einfacherer Editor

- Zuschauer- und Host-Spieloberfläche vereinheitlicht auf genau zwei szenische Zustände: Fragenübersicht und laufende Frage inkl. Antwortauflösung.
- Das Quizbrett verschwindet während Frage, Antwortabgabe und Review vollständig aus dem DOM.
- Gespielte, aktuell ausgewählte und öffentlich synchronisiert als benutzt gekennzeichnete Fragen werden deaktiviert und ausgegraut; nach Rückkehr bleibt der Status erhalten.
- Große Bretter: dynamische Pager pro Kategorie- und Zeilenblock. Kleine Bretter: keine riesigen Einzelkacheln.
- Spielfeld nimmt auf typischen Desktop-/Mobilgrößen den sichtbaren Browserbereich (`100dvh`) ein, Punktestand ist unten fixiert. Auch mehr als acht Punktestände sind durch einen Footer-Pager erreichbar.
- Antwortgalerie kompakter, keine auf Bildschirmhöhe gestreckte Einzelantwort.
- Vereinfachter WYSIWYG-Editor: Fragenliste, Hauptfläche, selektierte Eigenschaften; Dateifunktionen/fortgeschrittene Felder werden bei Bedarf aufgeklappt.
- Kontextmenü mit Rechtsklick, sichtbarem `⋯ Menü`-Knopf, Shift+F10, Keyboard-Pfeilen, Escape sowie Touch-Longpress. Aktionen: Bearbeiten, Duplizieren, horizontal/vertikal zentrieren, Ebenen verschieben, löschen; freie Fläche: Text/Bild/Form einfügen.
- Ursprüngliche vier Figuren und Gameplay-Motion bleiben erhalten.
- Service-Worker-Cache auf 2.9.0 erhöht, neue UI-Datei im Offline-Shell-Cache.
- Automatisierte Tests + Chrome-Host-/Gast-Durchlauf mit Peer-Mock; kein behaupteter Test echter NAT-übergreifender WebRTC-Verbindungen.
