/* ---------- Live-Online (net-live.js) – Entwurf für das Spiel im Browser ----------
   So würde die bestehende Oberfläche von Runecourt mit dem Server sprechen.
   Grundidee: Der Browser rechnet nichts mehr selbst. Er schickt Wünsche ("kaufen") und
   zeichnet, was der Server zurückschickt. Die Kampf-Animation (animateFight) bekommt
   dieselben Ereignisse (ev), die sie heute aus simulate() bekommt.

   Einbau später: als weitere Datei in build.py nach net.js laden und im Startbildschirm
   einen Knopf "Live spielen" anlegen, der LIVE.connect() und LIVE.queue() aufruft. */
const LIVE = {
  url: "wss://DEIN-SERVER.example/",        // Adresse des Servers (siehe server/README.md)
  ws: null, me: null, last: null,
  token() { try { return localStorage.getItem("rc_live_token") } catch (e) { return null } },
  connect(name) {
    return new Promise((ok, fail) => {
      const ws = this.ws = new WebSocket(this.url);
      ws.onopen = () => this.send({ t: "hello", token: this.token(), name });
      ws.onerror = fail;
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === "welcome") { try { localStorage.setItem("rc_live_token", m.token) } catch (e) {} this.me = m; ok(m); }
        this.on(m);
      };
      ws.onclose = () => toast(t("Verbindung zum Server getrennt."));
    });
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)) },
  queue() { this.send({ t: "queue" }) },
  createLobby() { this.send({ t: "createLobby" }) },
  joinLobby(code) { this.send({ t: "joinLobby", code }) },
  startLobby() { this.send({ t: "startLobby" }) },
  act(a, extra = {}) { this.send({ t: "act", a, ...extra }) },

  // Nachrichten des Servers in den bekannten Spielzustand S übersetzen und zeichnen
  async on(m) {
    if (m.t === "queued") toast(t("Suche Gegner … ({0} wartend)", m.waiting));
    if (m.t === "lobby") showLobby(m);                       // kleines Fenster mit Code und Spielerliste
    if (m.t === "pick") showHueterPickFrom(m.options);        // wie showHueterPick, aber nur diese drei
    if (m.t === "state") {
      this.last = m;
      S.round = m.round; S.day = m.day; S.omen = m.omen; S.phase = m.phase;
      const me = ME(); Object.assign(me, m.you);              // Gold, Leben, Brett, Hand
      S.shop = m.you.shop; S.held = m.you.held; S.spell = m.you.spell; S.spellHeld = m.you.spellHeld;
      m.players.forEach((p, i) => { if (p.seat !== m.you.seat) Object.assign(S.players[i] || {}, p) });
      startTimerBar(m.ms);                                    // Sanduhr für den Markt
      render();
    }
    if (m.t === "fight") {                                     // Kampf nur abspielen, gerechnet hat der Server
      S.phase = "combat"; S.opp = m.opp; render();
      await vsIntro(m.opp);
      await animateFight({ ev: m.ev, winner: m.winner, dmg: m.dmg }, m.meIsA);
    }
    if (m.t === "eliminated") toast(t("Ausgeschieden auf Platz {0}.", m.place));
    if (m.t === "gameOver") { ME().place = m.place; gameOver(m.place === 1); }
    if (m.t === "error") toast(t(m.msg));
  }
};
/* Die bestehenden Knöpfe würden im Live-Modus nur noch Wünsche schicken, zum Beispiel:
   buy(i)          -> LIVE.act("buy", { i })
   sellSel()       -> LIVE.act("sell", { where: S.sel.where, i: S.sel.i })
   reroll()        -> LIVE.act("reroll")
   levelUp()       -> LIVE.act("level")
   toggleHold(i)   -> LIVE.act("hold", { i })
   Ziehen/Tauschen -> LIVE.act("move", { from: { where, i }, to: { where, i } })
   Zauber          -> LIVE.act("spell", { where, i })  (bei Zielzaubern mit Ziel)
   Hüter-Kraft     -> LIVE.act("power", { where, i })  (Ziel optional)
   Kämpfen!        -> LIVE.act("ready")
*/
