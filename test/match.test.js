import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { runBot } from '../bot/bot.js';
import { createRules } from '../shared/rules.js';

const fast = dir => ({ port: 0, dataDir: dir, pickMs: 150, marketMs: 400, fightMs: 20, queueFillMs: 300, minHumans: 2 });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));

test('Regeln: jede Lobby hat ihre eigene Welt', () => {
  const a = createRules(), b = createRules();
  a.S = { round: 1, players: [], shop: [], omen: 'ruhe' };
  assert.equal(b.S, null);
  assert.ok(a.CREATURES.length >= 30);
  assert.ok(Object.keys(a.HUETER).length >= 5);
});

test('sechs Spieler über das Netz spielen eine ganze Partie mit Rangpunkten', async () => {
  const dir = tmp(); const s = await startServer(fast(dir));
  try {
    const url = `ws://localhost:${s.port}`;
    const logs = await Promise.all(Array.from({ length: 6 }, (_, i) => runBot(url, 'Bot ' + (i + 1))));
    const places = logs.map(l => l.place).sort();
    assert.deepEqual(places, [1, 2, 3, 4, 5, 6]);
    assert.ok(logs.every(l => l.fights >= 2), 'jeder hat gekämpft');
    assert.ok(logs.every(l => l.results.length === 6));
    await s.close();
    const acc = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'))).accounts);
    assert.equal(acc.length, 6);
    assert.ok(acc.every(a => a.games === 1));
    const winner = acc.find(a => a.wins === 1); assert.equal(winner.rp, 1040);
  } finally { await s.close().catch(() => {}); }
});

test('private Lobby mit Code, Rest füllen Computer-Gegner auf, ohne Rangpunkte', async () => {
  const dir = tmp(); const s = await startServer(fast(dir));
  try {
    const url = `ws://localhost:${s.port}`;
    let code; const joined = new Promise(r => { globalThis.__join = r; });
    const host = runBot(url, 'Gastgeber', { mode: 'lobby', host: true, onLobby: (m, send) => {
      if (!code) { code = m.code; globalThis.__join(code); }
      if (m.players.length === 2) send({ t: 'startLobby' });
    } });
    const guest = joined.then(c => runBot(url, 'Freundin', { mode: 'lobby', code: c }));
    const [h, g] = await Promise.all([host, guest]);
    assert.match(code, /^[A-Z2-9]{5}$/);
    assert.ok(h.place >= 1 && g.place >= 1 && h.place !== g.place);
    assert.equal(h.results.filter(r => r.bot).length, 4);
    assert.ok(h.results.every(r => r.rpDelta === 0));
  } finally { await s.close(); }
});

test('allein in der Warteschlange: Übungspartie gegen Computer', async () => {
  const dir = tmp(); const s = await startServer(fast(dir));
  try {
    const l = await runBot(`ws://localhost:${s.port}`, 'Solo');
    assert.ok(l.place >= 1 && l.place <= 6);
    assert.equal(l.results.filter(r => r.bot).length, 5);
  } finally { await s.close(); }
});
