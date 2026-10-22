# Runecourt-Server

Der Server macht echte Online-Partien möglich: sechs Spieler, jeder gegen jeden, live.
Er rechnet alles selbst (Markt, gemeinsamer Vorrat, Kämpfe). Die Browser schicken nur Wünsche
wie „kaufen“ oder „bereit“. So kann niemand schummeln.

## Was er kann

- **Gastkonten:** Wer sich zum ersten Mal verbindet, bekommt ein Konto mit geheimem Schlüssel. Kein Passwort, keine E-Mail.
- **Warteschlange:** Öffentliche Partien für sechs Spieler, mit Rangpunkten (Bronze, Silber, Gold, Rubin, Meister).
  Sind nach 30 Sekunden mindestens zwei Menschen da, füllen Computer-Gegner die freien Plätze. Wer allein wartet, bekommt eine Übungspartie ohne Rangpunkte.
- **Private Lobbys mit Code:** Einer erstellt eine Lobby, bekommt einen Code aus 5 Zeichen, Freunde treten mit dem Code bei, der Gastgeber startet. Freie Plätze übernehmen Computer-Gegner. Keine Rangpunkte.
- **Zeitlimits:** 20 Sekunden für die Hüter-Wahl, 45 Sekunden Markt, danach Kampf. Sind alle früher bereit, geht es früher weiter.
- **Rangliste** unter `/leaderboard`, Zustand unter `/health`.
- **Verbindung weg:** Der Platz spielt als Computer weiter, wer zurückkommt, steigt wieder ein.

Die Spielregeln werden nicht abgeschrieben. `tools/extract-rules.mjs` baut sie aus denselben Dateien,
die auch das Spiel im Browser benutzt (data.js, creatures.js, lang.js, wardens.js, logic.js, spells.js).
Nach jeder Regeländerung im Spiel: `npm run rules`.

## Auf dem eigenen Rechner ausprobieren

Du brauchst Node.js 20 oder neuer (kostenlos von nodejs.org).

```
npm install
npm run rules      # Regeln aus den Spielquellen bauen (Pfad zu src als Zusatz möglich)
npm start          # Server läuft auf Port 8080
npm run bots       # in einem zweiten Fenster: sechs Test-Spieler spielen eine Partie
npm test           # automatische Prüfung: ganze Partien über das Netz
```

Einstellungen über Umgebungsvariablen:

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | Port des Servers | 8080 |
| `DATA_DIR` | Ordner für die Konten-Datei | ./data |
| `RC_SAVE_EMAIL` | E-Mail eines eigenen Firebase-Kontos für den Server (wird beim ersten Start angelegt). Damit überleben Konten, Rangliste und Tagesrangliste jeden Neustart. | leer = nur lokal |
| `RC_SAVE_PASSWORD` | Passwort dazu (mindestens 6 Zeichen, nirgends sonst benutzen) | leer |
| `PICK_MS`, `MARKET_MS`, `FIGHT_MS` | Zeiten für Hüter-Wahl, Markt, Kampf-Anschauen (Millisekunden) | 20000, 45000, 9000 |
| `QUEUE_FILL_MS` | Wartezeit, bis Computer-Gegner auffüllen | 30000 |
| `MIN_HUMANS` | Menschen, die für eine Partie mit Rangpunkten nötig sind | 2 |
| `ALLOW_ORIGIN` | Welche Webseite die Rangliste abrufen darf | * |

## Kostenlos ins Internet stellen

Es gibt Anbieter mit kostenlosen Stufen, die für den Anfang reichen. Die Angebote ändern sich oft,
bitte vor dem Anmelden die aktuellen Bedingungen prüfen. Zwei Wege, die zu diesem Server passen:

1. **Render.com (am einfachsten zum Testen):** kostenloser „Web Service“ aus diesem Ordner (Dockerfile liegt bei).
   Haken: Der kostenlose Dienst schläft nach einer Weile ohne Besucher ein und braucht dann einige Sekunden zum Aufwachen,
   und die Konten-Datei überlebt einen Neustart nicht. Gut für Testrunden mit Freunden.
2. **Oracle Cloud „Always Free“ (dauerhaft):** ein kleiner kostenloser Server, auf dem die Daten bleiben.
   Mehr Einrichtung: Node installieren, Ordner hochladen, `npm ci`, `npm start` als Dienst laufen lassen.
   Für eine sichere Verbindung (wss://) braucht es eine Adresse und ein Zertifikat, zum Beispiel über Caddy, das das kostenlos erledigt.

**Was du selbst tun musst:** beim Anbieter ein Konto anlegen (dafür verlangen manche eine Kreditkarte zur Prüfung, auch wenn nichts abgebucht wird),
den Ordner verbinden oder hochladen und mir die Adresse des Servers sagen. Den Rest (Einbau ins Spiel, Anpassungen) übernehme ich.

## Wie das Spiel mit dem Server spricht

Nachrichten sind JSON über WebSocket. Der Browser schickt:

| Nachricht | Bedeutung |
| --- | --- |
| `{t:"hello", name, token?}` | anmelden; ohne Token gibt es ein neues Gastkonto |
| `{t:"queue"}` / `{t:"unqueue"}` | Warteschlange betreten oder verlassen |
| `{t:"createLobby"}`, `{t:"joinLobby", code}`, `{t:"startLobby"}`, `{t:"leaveLobby"}` | private Lobby |
| `{t:"act", a:"pick", hueter}` | Hüter wählen |
| `{t:"act", a:"buy", i}`, `"sell"`, `"move"`, `"reroll"`, `"level"`, `"hold"`, `"holdSpell"`, `"spell"`, `"power"`, `"ready"` | Wünsche im Markt |
| `{t:"me"}` | eigene Rangpunkte |

Der Server antwortet mit `welcome`, `queued`, `lobby`, `matchStart`, `pick`, `state` (eigener Markt und alle Spieler),
`fight` (Kampf-Ereignisse zum Abspielen), `eliminated`, `gameOver` (Plätze und Rangpunkte) und `error`.
Ein Entwurf für den Einbau ins Spiel liegt in `client/net-live.js`.

## Grenzen dieser ersten Fassung

- Belohnungen beim Verschmelzen wählt der Server zufällig (im Browser darf man aus drei wählen).
- Die Konten liegen in einer JSON-Datei. Ab einigen tausend Spielern lohnt sich eine echte Datenbank.
- Keine Anmeldung mit E-Mail oder Passwort; wer seinen Schlüssel verliert (Browserdaten gelöscht), verliert das Konto.

Lizenz: GPL 2.0 oder neuer, wie das Spiel.
