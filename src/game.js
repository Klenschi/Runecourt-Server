// Eine Partie mit sechs Plätzen. Der Server rechnet alles selbst (Markt, Vorrat, Kämpfe),
// die Spieler schicken nur Wünsche ("kaufen", "verkaufen", ...). So kann niemand schummeln.
import { createRules } from '../shared/rules.js';

export const RP_DELTA = [40, 25, 10, -5, -20, -35];          // Platz 1 bis 6
export const RANKS = [[1700, 'Meister'], [1450, 'Rubin'], [1250, 'Gold'], [1100, 'Silber'], [0, 'Bronze']];
export const rankOf = rp => RANKS.find(([min]) => rp >= min)[1];
const BOT_NAMES = ['Moorweberin Ilka', 'Brannok vom Grat', 'Die Graue Ylva', 'Tamsin Funkelhand', 'Odo Nebelbart', 'Kalla Rabenstein'];
const WHERE = new Set(['board', 'hand']);

export class Game {
  // seats: [{account, send(msg)}] (echte Spieler); Rest wird mit Computer-Gegnern aufgefüllt
  constructor({ seats, ranked, timers, onEnd, code = null }) {
    this.R = createRules();
    this.ranked = ranked; this.timers = timers; this.onEnd = onEnd; this.code = code;
    const R = this.R;
    R.S = { round: 1, day: true, phase: 'pick', players: [], shop: [], held: [], log: [], omen: R.pick(Object.keys(R.OMENS)) };
    this.S = R.S;
    const bots = BOT_NAMES.slice();
    for (let i = 0; i < 6; i++) {
      const seat = seats[i];
      const p = R.newPlayer(seat ? seat.account.name : bots.shift(), false);
      p.hand = [null, null, null, null];
      p.seat = i; p.bot = !seat; p.accountId = seat ? seat.account.id : null; p.send = seat ? seat.send : null;
      p.shop = []; p.held = []; p.spell = null; p.spellHeld = false; p.ready = false;
      this.S.players.push(p);
    }
    this.over = false; this.timer = null;
    this.startPick();
  }
  get players() { return this.S.players; }
  humans() { return this.players.filter(p => !p.bot); }
  player(accountId) { return this.players.find(p => p.accountId === accountId); }

  // ---------- Hüter wählen ----------
  startPick() {
    const keys = Object.keys(this.R.HUETER);
    for (const p of this.players) {
      p.options = this.R.shuffle(keys).slice(0, 3);
      if (p.bot) this.setHueter(p, this.R.pick(p.options));
    }
    this.deadline = Date.now() + this.timers.pickMs;
    for (const p of this.humans()) this.sendTo(p, { t: 'pick', options: p.options, ms: this.timers.pickMs, omen: this.S.omen });
    this.timer = setTimeout(() => this.endPick(), this.timers.pickMs);
  }
  setHueter(p, k) { p.hueter = k; p.hp = this.R.wardenHp(k); }
  endPick() {
    for (const p of this.players) if (!p.hueter) this.setHueter(p, p.options[0]);
    this.startRound();
  }

  // ---------- Markt ----------
  // Der gemeinsame Vorrat zählt alle Wesen auf Brettern, Händen und in allen Märkten
  syncPool(except) {
    this.S.shop = this.players.filter(p => p.alive).flatMap(p => p === except ? p.shop.filter((x, i) => x && p.held[i]) : p.shop.filter(Boolean));
  }
  refreshShop(p) {
    const R = this.R;
    this.syncPool(p);
    const fresh = R.rollShop(p, true);
    const size = fresh.length;
    const keep = Array.from({ length: size }, (_, i) => (p.held[i] && p.shop[i]) || null);
    let k = 0;
    p.shop = keep.map(x => x || fresh[k++] || null);
    p.held = keep.map(Boolean);
    this.syncPool(null);
  }
  startRound() {
    const R = this.R, S = this.S;
    S.phase = 'market'; S.day = R.omenDay(S.round);
    for (const p of this.players) {
      if (!p.alive) continue;
      p.tmpA = 0; p.tmpH = 0; p.ready = p.bot;
      p.gold = Math.min(10, 2 + S.round);
      if (S.round > 1 && p.level < R.MAX_LEVEL) p.lvlCost = Math.max(0, p.lvlCost - 1);
      p.free = p.bonusFree || 0; if (p.hueter === 'hexe') p.gold++; p.bonusFree = 0;
      if (p.bonusGold) { p.gold += p.bonusGold; p.bonusGold = 0; }
      if (S.omen === 'goldregen' && S.round <= 3) p.gold++;
      if (!p.bot) { if (!p.spellHeld || !p.spell) p.spell = R.rollSpell(p); this.refreshShop(p); }
    }
    this.deadline = Date.now() + this.timers.marketMs;
    this.broadcastState();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.combat(), this.timers.marketMs);
  }
  // Ein Wunsch eines Spielers. Gibt eine Fehlermeldung zurück oder null
  act(accountId, m) {
    const R = this.R, S = this.S, p = this.player(accountId);
    if (!p) return 'Du spielst hier nicht mit.';
    if (S.phase === 'pick' && m.a === 'pick') {
      if (!p.options.includes(m.hueter)) return 'Diesen Hüter kannst du nicht wählen.';
      this.setHueter(p, m.hueter); p.picked = true;
      if (this.humans().every(h => h.picked)) { clearTimeout(this.timer); this.endPick(); }
      return null;
    }
    if (S.phase !== 'market' || !p.alive) return 'Gerade ist kein Markt.';
    const slot = (w, i) => (WHERE.has(w) && Number.isInteger(i) && i >= 0 && i < p[w].length) ? p[w][i] : undefined;
    switch (m.a) {
      case 'buy': {
        const id = p.shop[m.i]; if (!id) return 'Dort liegt kein Wesen.';
        const cost = R.costOf(p, id); if (p.gold < cost) return 'Nicht genug Gold.';
        let where = 'board', idx = R.firstFree(p.board);
        if (idx < 0) { where = 'hand'; idx = R.firstFree(p.hand); }
        if (idx < 0) return 'Kein Platz frei.';
        p.gold -= cost; const u = R.mkUnit(id); p[where][idx] = u; p.shop[m.i] = null; p.held[m.i] = false;
        this.syncPool(null); R.onBuy(p, u); R.checkMerge(p); break;
      }
      case 'sell': {
        const u = slot(m.where, m.i); if (!u) return 'Dort steht kein Wesen.';
        p[m.where][m.i] = null; p.gold += 1; break;
      }
      case 'move': {
        const a = slot(m.from?.where, m.from?.i), b = slot(m.to?.where, m.to?.i);
        if (a === undefined || b === undefined || !a) return 'Ungültiger Zug.';
        p[m.from.where][m.from.i] = b; p[m.to.where][m.to.i] = a; R.checkMerge(p); break;
      }
      case 'reroll': {
        if (p.free > 0) p.free--; else { if (p.gold < 1) return 'Nicht genug Gold.'; p.gold--; }
        if (!p.spellHeld) p.spell = R.rollSpell(p);
        this.refreshShop(p); break;
      }
      case 'level': {
        if (p.level >= R.MAX_LEVEL) return 'Die Lichtung ist schon voll.';
        if (p.gold < p.lvlCost) return 'Nicht genug Gold.';
        p.gold -= p.lvlCost; p.level++; p.lvlCost = R.LEVEL_COST[p.level] || 0; break;
      }
      case 'hold': {
        if (!p.shop[m.i]) return 'Dort liegt kein Wesen.';
        p.held[m.i] = !p.held[m.i]; break;
      }
      case 'holdSpell': p.spellHeld = !p.spellHeld; break;
      case 'spell': {
        const id = p.spell; if (!id) return 'Kein Zauber im Markt.';
        const cost = R.spellCost(id); if (p.gold < cost) return 'Nicht genug Gold.';
        const sp = R.SPELLS[id]; let u = null;
        if (sp.kind === 'target') {
          u = slot(m.where, m.i); if (!u) return 'Wähle ein Ziel.';
          if (sp.only && R.C[u.id].s !== sp.only) return 'Dieses Wesen passt nicht.';
        }
        p.gold -= cost; R.applySpell(p, id, u); p.spell = null; p.spellHeld = false; break;
      }
      case 'power': {
        const st = R.powerState(p); if (!st) return 'Dein Hüter hat keine Kraft.';
        const u = slot(m.where, m.i); if (u) p._mirror = u;
        const ok = R.usePower(p); p._mirror = null;
        if (!ok) return 'Die Kraft geht gerade nicht.';
        if (p.topRoll) this.refreshShop(p);
        R.checkMerge(p); break;
      }
      case 'ready': p.ready = true; break;
      default: return 'Unbekannter Wunsch.';
    }
    if (this.humans().filter(h => h.alive && h.send).every(h => h.ready)) { clearTimeout(this.timer); this.combat(); return null; }
    this.sendState(p);
    return null;
  }

  // ---------- Kampf ----------
  combat() {
    if (this.over || this.S.phase !== 'market') return;
    const R = this.R, S = this.S;
    S.phase = 'combat';
    for (const p of this.players) if (p.alive && !p.bot) { p.shop = p.shop.map((x, i) => p.held[i] ? x : null); }
    this.syncPool(null);
    for (const p of this.players) { if (!p.alive) continue; if (p.bot || !p.send) R.aiTurn(p); R.eulenhexen(p); }
    const alive = R.shuffle(this.players.filter(p => p.alive)), pairs = [];
    while (alive.length > 1) pairs.push([alive.pop(), alive.pop()]);
    if (alive.length) { const lone = alive[0], g = R.pick(this.players.filter(p => p !== lone && p.alive)); pairs.push([lone, { ...g, name: g.name + ' (Geist)', ghost: true, send: null }]); }
    const fights = pairs.map(([a, b]) => ({ a, b, r: R.simulate(a, b, S.day) }));
    for (const f of fights) R.applyResult(f.a, f.b, f.r);
    for (const f of fights) for (const [me, opp, meIsA] of [[f.a, f.b, true], [f.b, f.a, false]]) {
      if (me.ghost || !me.send) continue;
      this.sendTo(me, { t: 'fight', round: S.round, day: S.day, opp: this.pub(opp), meIsA, ev: f.r.ev, winner: f.r.winner, dmg: f.r.dmg });
    }
    // Ausgeschiedene und Plätze, wie im Spiel im Browser
    const living = this.players.filter(p => p.alive);
    const out = living.filter(p => p.hp <= 0).sort((x, y) => x.hp - y.hp);
    out.forEach((p, i) => { p.alive = false; p.place = living.length - i; });
    const left = this.players.filter(p => p.alive);
    if (left.length <= 1) { if (left[0]) left[0].place = 1; return this.finish(); }
    for (const p of out) this.sendTo(p, { t: 'eliminated', place: p.place });
    S.round++;
    this.timer = setTimeout(() => this.startRound(), this.timers.fightMs);
  }
  finish() {
    this.over = true; this.S.phase = 'over'; clearTimeout(this.timer);
    const places = this.players.map(p => ({ seat: p.seat, name: p.name, hueter: p.hueter, place: p.place || 1, bot: p.bot, accountId: p.accountId }));
    const results = places.map(x => ({ ...x, rpDelta: this.ranked && !x.bot ? RP_DELTA[x.place - 1] : 0 }));
    for (const p of this.humans()) this.sendTo(p, { t: 'gameOver', place: p.place || 1, ranked: this.ranked, results: results.map(({ accountId, ...r }) => r) });
    this.onEnd?.(this, results);
  }

  // ---------- Nachrichten ----------
  pub(p) { return { seat: p.seat, name: p.name, hp: p.hp, level: p.level, hueter: p.hueter, alive: p.alive, place: p.place || 0, bot: !!p.bot, ghost: !!p.ghost }; }
  view(p) {
    const R = this.R, st = R.powerState(p);
    return {
      t: 'state', round: this.S.round, day: this.S.day, omen: this.S.omen, phase: this.S.phase,
      ms: Math.max(0, this.deadline - Date.now()),
      you: { seat: p.seat, gold: p.gold, hp: p.hp, level: p.level, lvlCost: p.lvlCost, free: p.free, hueter: p.hueter,
        board: p.board, hand: p.hand, shop: p.shop, held: p.held, spell: p.spell, spellHeld: p.spellHeld, ready: p.ready,
        power: st ? { cost: st.pw.cost, used: st.used, can: st.can } : null },
      players: this.players.map(x => this.pub(x))
    };
  }
  sendTo(p, msg) { try { p.send?.(msg); } catch {} }
  sendState(p) { if (p.send) this.sendTo(p, this.view(p)); }
  broadcastState() { for (const p of this.humans()) this.sendState(p); }
  // Verbindung weg: der Platz spielt als Computer weiter
  leave(accountId) {
    const p = this.player(accountId); if (!p) return;
    p.send = null;
    if (this.humans().every(h => !h.send) && !this.over) { this.over = true; clearTimeout(this.timer); this.onEnd?.(this, null); }
  }
  rejoin(accountId, send) { const p = this.player(accountId); if (!p) return false; p.send = send; this.sendState(p); return true; }
}
