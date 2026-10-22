// Konten und Ranglistenpunkte in einer JSON-Datei. Reicht für einige tausend Spieler;
// danach lohnt sich eine echte Datenbank (siehe README).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

export class Store {
  constructor(dir, cloud = null) {
    this.file = path.join(dir, 'accounts.json');
    fs.mkdirSync(dir, { recursive: true });
    try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.db = { accounts: {} }; }
    this.cloud = cloud?.on ? cloud : null;
    this.index(); this.timer = null; this.cloudTimer = null;
  }
  index() {
    this.db.accounts ||= {}; this.db.daily ||= {};
    this.byToken = new Map(Object.values(this.db.accounts).map(a => [a.tokenHash, a]));
  }
  // Beim Start den Stand aus Firebase holen (überlebt Neustarts des Gratis-Servers)
  async init() {
    if (!this.cloud) return 'nur lokal';
    try {
      const c = await this.cloud.load();
      if (c && (c.savedAt || 0) >= (this.db.savedAt || 0)) { this.db = c; this.index(); }
      return 'Firebase: ' + Object.keys(this.db.accounts).length + ' Konten';
    } catch (e) { console.error('Firebase laden fehlgeschlagen:', e.message); return 'Firebase nicht erreichbar, lokal'; }
  }
  // Gastkonto: wer kein gültiges Token mitbringt, bekommt ein neues
  login(token, name) {
    if (token) {
      const a = this.byToken.get(hash(token));
      if (a) { if (name) a.name = name; a.seen = Date.now(); this.save(); return { account: a, token }; }
    }
    const id = 'p_' + crypto.randomBytes(6).toString('hex');
    const fresh = crypto.randomBytes(24).toString('hex');
    const a = { id, name: name || 'Gast ' + id.slice(-4), tokenHash: hash(fresh), rp: 1000, games: 0, wins: 0, sumPlace: 0, created: Date.now() };
    this.db.accounts[id] = a; this.byToken.set(a.tokenHash, a); this.save();
    return { account: a, token: fresh };
  }
  get(id) { return this.db.accounts[id]; }
  result(id, place, rpDelta) {
    const a = this.db.accounts[id]; if (!a) return;
    a.games++; a.sumPlace += place; if (place === 1) a.wins++;
    a.rp = Math.max(0, a.rp + rpDelta); this.save();
  }
  leaderboard(n = 50) {
    return Object.values(this.db.accounts).filter(a => a.games > 0)
      .sort((x, y) => y.rp - x.rp).slice(0, n)
      .map((a, i) => ({ rank: i + 1, name: a.name, rp: a.rp, games: a.games, wins: a.wins, avgPlace: +(a.sumPlace / a.games).toFixed(2) }));
  }
  // Tägliche Herausforderung: nur der erste Versuch des Tages zählt
  daily(date, a, rec) {
    const d = this.db.daily[date] ||= {};
    const first = !d[a.id];
    if (first) { d[a.id] = { ...rec, t: Date.now() }; this.save(); }
    const rows = this.dailyBoard(date);
    return { first, rank: rows.findIndex(r => r.id === a.id.slice(-6)) + 1, total: rows.length };
  }
  dailyBoard(date) {
    const d = this.db.daily[date] || {};
    return Object.entries(d).map(([id, r]) => ({ id: id.slice(-6), name: this.db.accounts[id]?.name || 'Gast', ...r }))
      .sort((x, y) => x.place - y.place || y.hp - x.hp || x.round - y.round || x.t - y.t)
      .map(({ t, ...r }, i) => ({ rank: i + 1, ...r }));
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    this.db.savedAt = Date.now();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
    if (this.cloud && !this.cloudTimer) this.cloudTimer = setTimeout(() => this.push(), 15000);
  }
  // Höchstens alle 15 Sekunden nach Firebase schreiben
  async push() {
    clearTimeout(this.cloudTimer); this.cloudTimer = null;
    if (!this.cloud) return;
    this.prune();
    try { await this.cloud.save(this.db); } catch (e) { console.error('Firebase speichern fehlgeschlagen:', e.message); }
  }
  // Platz sparen: alte Tage und lange unbenutzte Gastkonten ohne Partien fallen weg
  prune() {
    const days = Object.keys(this.db.daily).sort();
    for (const d of days.slice(0, -3)) delete this.db.daily[d];
    const old = Date.now() - 14 * 864e5;
    let size = JSON.stringify(this.db).length;
    if (size < 150000) return;
    for (const a of Object.values(this.db.accounts).sort((x, y) => (x.seen || x.created) - (y.seen || y.created))) {
      if (size < 150000) break;
      if (a.games > 0 || (a.seen || a.created) > old) continue;
      delete this.db.accounts[a.id]; size -= 220;
    }
    this.index();
  }
  async close() { this.flush(); await this.push(); }
}
