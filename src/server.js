// HTTP + WebSocket. Gastkonten, Warteschlange für öffentliche Partien (mit Rangpunkten)
// und private Lobbys mit Code (ohne Rangpunkte).
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { Cloud } from './cloud.js';
import { Game, rankOf } from './game.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const today = (d = 0) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

export async function startServer(opts = {}) {
  const cfg = {
    port: opts.port ?? 8080,
    dataDir: opts.dataDir ?? './data',
    pickMs: opts.pickMs ?? 20000,
    marketMs: opts.marketMs ?? 45000,
    fightMs: opts.fightMs ?? 9000,       // Zeit zum Ansehen des Kampfes im Browser
    queueFillMs: opts.queueFillMs ?? 30000, // danach füllen Computer-Gegner die Warteschlange auf
    minHumans: opts.minHumans ?? 2,
    allowOrigin: opts.allowOrigin ?? '*'
  };
  const store = new Store(cfg.dataDir, opts.cloud ?? new Cloud(process.env.RC_SAVE_EMAIL, process.env.RC_SAVE_PASSWORD));
  const saved = await store.init(); console.log('Spielstände:', saved);
  const clients = new Map();   // accountId -> {ws, account}
  const games = new Set();
  const inGame = new Map();    // accountId -> Game
  const watching = new Map();  // accountId -> Game (nur Zuschauer)
  const lobbies = new Map();   // code -> {code, host, members:[accountId]}
  let queue = [];              // accountIds
  let queueTimer = null;

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const sender = id => msg => { const c = clients.get(id); if (c) send(c.ws, msg); };
  const timers = { pickMs: cfg.pickMs, marketMs: cfg.marketMs, fightMs: cfg.fightMs };

  function startGame(ids, ranked, code = null) {
    const seats = ids.map(id => ({ account: store.get(id), send: sender(id) }));
    const g = new Game({ seats, ranked, timers, code, onEnd: (game, results) => {
      games.delete(game);
      for (const [w, g] of watching) if (g === game) watching.delete(w);
      for (const id of ids) if (inGame.get(id) === game) inGame.delete(id);
      if (results) for (const r of results) if (r.accountId) store.result(r.accountId, r.place, r.rpDelta);
    } });
    games.add(g);
    for (const id of ids) inGame.set(id, g);
    for (const id of ids) sender(id)({ t: 'matchStart', ranked, code, seats: g.players.map(p => g.pub(p)) });
    return g;
  }
  function checkQueue() {
    queue = queue.filter(id => clients.has(id) && !inGame.has(id));
    while (queue.length >= 6) startGame(queue.splice(0, 6), true);
    for (const id of queue) sender(id)({ t: 'queued', waiting: queue.length });
    clearTimeout(queueTimer);
    if (queue.length) queueTimer = setTimeout(() => {
      queue = queue.filter(id => clients.has(id) && !inGame.has(id));
      if (queue.length >= cfg.minHumans) startGame(queue.splice(0, 6), true);
      else if (queue.length) { startGame(queue.splice(0, 6), false); } // allein: Übungspartie ohne Rangpunkte
    }, cfg.queueFillMs);
  }
  function newCode() { let c; do { c = Array.from(crypto.randomBytes(5), b => CODE_CHARS[b % CODE_CHARS.length]).join(''); } while (lobbies.has(c)); return c; }
  function lobbyMsg(l) { return { t: 'lobby', code: l.code, host: store.get(l.host)?.name, players: l.members.map(id => store.get(id)?.name) }; }
  function leaveLobby(id) {
    for (const l of lobbies.values()) {
      const i = l.members.indexOf(id); if (i < 0) continue;
      l.members.splice(i, 1);
      if (!l.members.length) lobbies.delete(l.code);
      else { if (l.host === id) l.host = l.members[0]; for (const m of l.members) sender(m)(lobbyMsg(l)); }
    }
  }

  function handle(ws, state, m) {
    if (m.t === 'hello') {
      const { account, token } = store.login(m.token, cleanName(m.name));
      const old = clients.get(account.id); if (old && old.ws !== ws) try { old.ws.close(4000, 'anderswo angemeldet'); } catch {}
      state.id = account.id; clients.set(account.id, { ws, account });
      const g = inGame.get(account.id), back = !!(g && !g.over);
      send(ws, { t: 'welcome', id: account.id, token, name: account.name, rp: account.rp, rank: rankOf(account.rp), inGame: back });
      if (back) g.rejoin(account.id, sender(account.id));
      return;
    }
    if (!state.id) return send(ws, { t: 'error', msg: 'Erst anmelden (hello).' });
    const id = state.id;
    switch (m.t) {
      case 'queue': if (inGame.has(id)) return send(ws, { t: 'error', msg: 'Du bist schon in einer Partie.' });
        leaveLobby(id); if (!queue.includes(id)) queue.push(id); return checkQueue();
      case 'unqueue': queue = queue.filter(x => x !== id); return send(ws, { t: 'unqueued' });
      case 'createLobby': { leaveLobby(id); const l = { code: newCode(), host: id, members: [id] }; lobbies.set(l.code, l); return send(ws, lobbyMsg(l)); }
      case 'joinLobby': { const l = lobbies.get(String(m.code || '').toUpperCase()); if (!l) return send(ws, { t: 'error', msg: 'Diesen Code gibt es nicht.' });
        if (l.members.length >= 6) return send(ws, { t: 'error', msg: 'Die Lobby ist voll.' });
        leaveLobby(id); l.members.push(id); for (const x of l.members) sender(x)(lobbyMsg(l)); return; }
      case 'leaveLobby': return leaveLobby(id);
      case 'startLobby': { const l = [...lobbies.values()].find(x => x.host === id); if (!l) return send(ws, { t: 'error', msg: 'Nur der Gastgeber kann starten.' });
        lobbies.delete(l.code); startGame(l.members, false, l.code); return; }
      case 'act': { const g = inGame.get(id); if (!g) return send(ws, { t: 'error', msg: 'Keine laufende Partie.' });
        const err = g.act(id, m); if (err) send(ws, { t: 'error', msg: err }); return; }
      case 'say': { // feste Zurufe, kein freier Text; höchstens einer alle 2 Sekunden
        const i = Math.floor(+m.i); if (!(i >= 0 && i < 8)) return;
        if (Date.now() - (state.said || 0) < 2000) return; state.said = Date.now();
        const g = inGame.get(id) || watching.get(id); if (g && !g.over) g.say(id, i, store.get(id)?.name);
        return; }
      case 'watch': { const g = inGame.get(id) || watching.get(id); if (!g) return send(ws, { t: 'error', msg: 'Keine laufende Partie.' });
        const err = g.watch(id, sender(id), store.get(id)?.name, m.seat); if (err) return send(ws, { t: 'error', msg: err });
        if (!inGame.has(id)) watching.set(id, g); return; }
      case 'spectate': { const code = String(m.code || '').toUpperCase();
        const g = [...games].find(x => x.code === code && !x.over);
        if (!g) return send(ws, { t: 'error', msg: lobbies.has(code) ? 'Die Partie hat noch nicht begonnen.' : 'Unter diesem Code läuft gerade keine Partie.' });
        if (inGame.has(id)) return send(ws, { t: 'error', msg: 'Du bist schon in einer Partie.' });
        leaveLobby(id); queue = queue.filter(x => x !== id);
        const err = g.watch(id, sender(id), store.get(id)?.name, m.seat); if (err) return send(ws, { t: 'error', msg: err });
        watching.set(id, g); return; }
      case 'unwatch': { watching.get(id)?.unwatch(id); watching.delete(id); return; }
      case 'me': { const a = store.get(id); return send(ws, { t: 'me', name: a.name, rp: a.rp, rank: rankOf(a.rp), games: a.games, wins: a.wins }); }
      default: return send(ws, { t: 'error', msg: 'Unbekannte Nachricht.' });
    }
  }

  const server = http.createServer((req, res) => {
    const h = { 'Access-Control-Allow-Origin': cfg.allowOrigin, 'Content-Type': 'application/json; charset=utf-8' };
    if (req.url === '/health') { res.writeHead(200, h); return res.end(JSON.stringify({ ok: true, games: games.size, online: clients.size, queue: queue.length })); }
    if (req.url === '/leaderboard') { res.writeHead(200, h); return res.end(JSON.stringify(store.leaderboard().map(r => ({ ...r, tier: rankOf(r.rp) })))); }
    // Tägliche Herausforderung: Ergebnis melden und Tagesrangliste
    const dm = /^\/daily(?:\?date=(\d{4}-\d{2}-\d{2}))?$/.exec(req.url);
    if (dm && req.method === 'GET') { res.writeHead(200, h); return res.end(JSON.stringify(store.dailyBoard(dm[1] || today()).slice(0, 50))); }
    if (req.url === '/daily' && req.method === 'OPTIONS') { res.writeHead(204, { ...h, 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'content-type' }); return res.end(); }
    if (req.url === '/daily' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
      req.on('end', () => {
        let m; try { m = JSON.parse(body); } catch { res.writeHead(400, h); return res.end('{"error":"json"}'); }
        const ok = [today(), today(-1)].includes(m.date);
        const place = Math.round(+m.place), round = Math.round(+m.round), hp = Math.round(+m.hp);
        if (!ok || !(place >= 1 && place <= 6) || !(round >= 1 && round <= 60) || !(hp >= -99 && hp <= 99)) { res.writeHead(400, h); return res.end('{"error":"werte"}'); }
        const { account, token } = store.login(m.token, cleanName(m.name));
        const r = store.daily(m.date, account, { place, round, hp, hueter: String(m.hueter || '').slice(0, 20) });
        res.writeHead(200, h); res.end(JSON.stringify({ token, name: account.name, ...r }));
      });
      return;
    }
    res.writeHead(404, h); res.end('{"error":"not found"}');
  });
  const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });
  wss.on('connection', ws => {
    const state = { id: null, n: 0, t0: Date.now() };
    ws.on('message', raw => {
      // einfache Bremse gegen Überflutung: höchstens 40 Nachrichten pro Sekunde
      const now = Date.now(); if (now - state.t0 > 1000) { state.t0 = now; state.n = 0; }
      if (++state.n > 40) return;
      let m; try { m = JSON.parse(raw); } catch { return send(ws, { t: 'error', msg: 'Kein JSON.' }); }
      if (!m || typeof m.t !== 'string') return;
      try { handle(ws, state, m); } catch (e) { console.error(e); send(ws, { t: 'error', msg: 'Serverfehler.' }); }
    });
    ws.on('close', () => {
      const id = state.id; if (!id || clients.get(id)?.ws !== ws) return;
      clients.delete(id); queue = queue.filter(x => x !== id); leaveLobby(id);
      inGame.get(id)?.leave(id);
      watching.get(id)?.unwatch(id); watching.delete(id);
    });
  });
  return new Promise(resolve => server.listen(cfg.port, () => {
    const port = server.address().port;
    resolve({ port, store, games, close: () => new Promise(r => { clearTimeout(queueTimer); for (const g of games) { g.over = true; clearTimeout(g.timer); clearTimeout(g.abandon); } wss.clients.forEach(c => c.terminate()); wss.close(); server.close(() => { store.close().then(r, r); }); }) });
  }));
}
