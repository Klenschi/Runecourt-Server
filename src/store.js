// Konten und Ranglistenpunkte in einer JSON-Datei. Reicht für einige tausend Spieler;
// danach lohnt sich eine echte Datenbank (siehe README).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'accounts.json');
    fs.mkdirSync(dir, { recursive: true });
    try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.db = { accounts: {} }; }
    this.byToken = new Map(Object.values(this.db.accounts).map(a => [a.tokenHash, a]));
    this.timer = null;
  }
  // Gastkonto: wer kein gültiges Token mitbringt, bekommt ein neues
  login(token, name) {
    if (token) {
      const a = this.byToken.get(hash(token));
      if (a) { if (name) a.name = name; this.save(); return { account: a, token }; }
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
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
}
