import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Game } from '../src/game.js';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';

const timers = { pickMs: 50, marketMs: 60, fightMs: 10 };
const inbox = () => { const box = []; const send = m => box.push(m); send.box = box; return send; };

test('Zuschauen: ausgeschiedene Spieler und Freunde sehen Zustand und Kämpfe', async () => {
  const a = inbox(), b = inbox(), w = inbox();
  const g = new Game({ seats: [{ account: { id: 'a', name: 'Anna' }, send: a }, { account: { id: 'b', name: 'Ben' }, send: b }], ranked: false, timers, code: 'ABCDE', onEnd() {} });
  assert.equal(g.watch('a', a, 'Anna'), 'Du spielst noch mit.');
  assert.equal(g.watch('x', w, 'Zoe', 1), null);
  assert.equal(w.box[0].t, 'watchStart'); assert.equal(w.box[0].code, 'ABCDE');
  assert.equal(w.box[1].t, 'state'); assert.equal(w.box[1].watch, true); assert.equal(w.box[1].you.seat, 1);
  await new Promise(r => setTimeout(r, 400));
  assert.ok(w.box.some(m => m.t === 'fight'), 'Zuschauer sieht Kämpfe');
  g.say('x', 0, 'Zoe');
  assert.ok(a.box.some(m => m.t === 'said' && m.watcher && m.name === 'Zoe'));
  g.say('a', 2);
  assert.ok(w.box.some(m => m.t === 'said' && m.seat === 0 && m.i === 2));
  g.over = true; clearTimeout(g.timer);
});

test('Tägliche Herausforderung: erster Versuch zählt, Rangfolge nach Platz', () => {
  const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')));
  const x = s.login(null, 'Anna').account, y = s.login(null, 'Ben').account;
  s.daily('2026-10-22', x, { place: 3, round: 8, hp: 0, hueter: 'stein' });
  s.daily('2026-10-22', x, { place: 1, round: 12, hp: 9, hueter: 'stein' });
  const r = s.daily('2026-10-22', y, { place: 1, round: 11, hp: 4, hueter: 'glut' });
  assert.equal(r.rank, 1); assert.equal(r.total, 2);
  const rows = s.dailyBoard('2026-10-22');
  assert.deepEqual(rows.map(q => [q.name, q.place]), [['Ben', 1], ['Anna', 3]]);
  clearTimeout(s.timer);
});

test('Tägliche Herausforderung über HTTP', async () => {
  const s = await startServer({ port: 0, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')) });
  try {
    const u = `http://localhost:${s.port}/daily`, date = new Date().toISOString().slice(0, 10);
    const j = await (await fetch(u, { method: 'POST', body: JSON.stringify({ date, place: 2, round: 9, hp: 0, hueter: 'stein', name: 'Anna' }) })).json();
    assert.ok(j.token); assert.equal(j.rank, 1);
    const bad = await fetch(u, { method: 'POST', body: JSON.stringify({ date: '2020-01-01', place: 2, round: 9, hp: 0 }) });
    assert.equal(bad.status, 400);
    const rows = await (await fetch(u)).json(); assert.equal(rows[0].name, 'Anna');
  } finally { await s.close(); }
});
