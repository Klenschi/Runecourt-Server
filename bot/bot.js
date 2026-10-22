// Kleiner Test-Spieler über das Netz. Aufruf: node bot/bot.js ws://localhost:8080 6 [queue|lobby]
import WebSocket from 'ws';

export function runBot(url, name, { mode = 'queue', code = null, host = false, onLobby } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
    const log = { name, states: 0, fights: 0, errors: [], place: null, results: null, token: null, lobby: null };
    let lastRound = 0;
    ws.on('open', () => send({ t: 'hello', name }));
    ws.on('error', reject);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') {
        log.token = m.token;
        if (mode === 'queue') send({ t: 'queue' });
        else if (host) send({ t: 'createLobby' });
        else send({ t: 'joinLobby', code });
      } else if (m.t === 'lobby') { log.lobby = m; onLobby?.(m, send); }
      else if (m.t === 'pick') send({ t: 'act', a: 'pick', hueter: m.options[0] });
      else if (m.t === 'state' && m.phase === 'market' && !m.you.ready) {
        log.states++;
        const y = m.you;
        if (m.round !== lastRound) { lastRound = m.round; }
        const space = y.board.includes(null) || y.hand.includes(null);
        const buyAt = y.shop.findIndex(Boolean);
        if (y.level < 5 && m.round >= 3 && y.gold >= y.lvlCost && y.lvlCost <= 4) send({ t: 'act', a: 'level' });
        else if (buyAt >= 0 && space && y.gold >= 3) send({ t: 'act', a: 'buy', i: buyAt });
        else send({ t: 'act', a: 'ready' });
      } else if (m.t === 'fight') log.fights++;
      else if (m.t === 'error') { log.errors.push(m.msg); send({ t: 'act', a: 'ready' }); }
      else if (m.t === 'gameOver') { log.place = m.place; log.results = m.results; ws.close(); resolve(log); }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || 'ws://localhost:8080', n = Number(process.argv[3] || 6);
  const logs = await Promise.all(Array.from({ length: n }, (_, i) => runBot(url, 'Bot ' + (i + 1))));
  for (const l of logs) console.log(l.name, 'Platz', l.place, 'Kämpfe', l.fights);
}
