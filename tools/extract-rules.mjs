// Baut shared/rules.js aus den Spielquellen (src von Runecourt).
// Die Regeln werden nicht abgeschrieben, sondern aus denselben Dateien erzeugt, die auch das Spiel im Browser nutzt.
// Aufruf: node tools/extract-rules.mjs [Pfad zu src]   (Standard: ../../v12/src bzw. RC_SRC)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2] || process.env.RC_SRC || path.join(here, '../../../v12/src'));
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

// Reihenfolge wie im Browser-Build (build.py), aber ohne Oberfläche (view, title, motion, sound, net, scout)
let data = read('data.js');
const cre = read('creatures.js') + '\n' + read('creatures2.js') + '\n' + read('creatures3.js') + '\nconst C=Object.fromEntries(CREATURES.map(c=>[c.id,c]));\n';
if (!data.includes('/*CREATURES*/')) throw new Error('data.js: Platzhalter /*CREATURES*/ fehlt');
data = data.replace('/*IMG*/{}', '{}').replace('/*CREATURES*/', () => cre);
const parts = [
  ['data.js', data],
  ['lang.js', read('lang.js')],
  ['wardens.js', read('wardens.js')],
  ['logic.js', read('logic.js')],
  ['spells.js', read('spells.js')],
  ['ai.js', read('ai.js')],
  ['depth.js', read('depth.js')],
  ['moor.js', read('moor.js')]
];

// Oberflächen-Funktionen, die die Regeln aufrufen, werden zu leeren Hüllen
const PRELUDE = `
const __any = new Proxy(function(){}, {get:(t,k)=>k===Symbol.toPrimitive?(()=>''):(k==='length'?0:__any), apply:()=>__any, construct:()=>__any, set:()=>true, has:()=>true});
var document = __any, navigator = {language:'de'}, localStorage = {getItem:()=>null, setItem(){}};
var window = globalThis; globalThis.window = globalThis;
function addEventListener(){}; function requestAnimationFrame(){return 0};
var setTimeout = () => 0, clearTimeout = () => {};
function render(){} function toast(){} function banner(){} function overlay(){return __any} function closeOverlay(){}
function showInfo(){} function cardEl(){return __any} function showTitle(){} var STAGE = __any; function tsPanel(){return __any} function newGame(){} function showReward(){} function nextTreasure(){} function showHueterPick(){} function gameOver(){}
async function animateFight(){} async function vsIntro(){} function pname(p){return p&&p.name} function clickSlot(){} function hydrate(){} function msg(){}
`;

const API = `
globalThis.RULES = {
  get S(){return S}, set S(v){S=v},
  get UID(){return UID}, set UID(v){UID=v},
  C, CREATURES, HUETER, SIPPEN, MAX_LEVEL, LEVEL_COST, POOL_SIZE, OMENS, SPELLS, WARDEN_HP,
  newPlayer, autoRise, autoLevel, rollShop, costOf, onBuy, checkMerge, allUnits, firstFree, aiTurn, eulenhexen,
  simulate, applyResult, mkUnit, wardenHp, usePower, powerState, powerPossible, aiPower,
  applySpell, spellCost, rollSpell, omenDay, rewardTier, aiReward, poolLeft, poolOut, unitPower,
  shuffle, pick, setLang: typeof setLang==='function'?setLang:()=>{}
};`;

const body = parts.map(([n, s]) => `/* ===== ${n} ===== */\n${s}`).join('\n');
const SOURCE = PRELUDE + '\n' + body + '\n' + API;

// Probe: Quelltext muss ohne Browser laufen und einen Kampf rechnen können
const ctx = vm.createContext({ Math, JSON, Object, Array, Number, String, Boolean, Date, Promise, Proxy, Symbol, Set, Map, Error, console });
vm.runInContext(SOURCE, ctx, { filename: 'rules-src.js' });
const R = ctx.RULES;
R.S = { round: 1, day: true, phase: 'market', players: [], shop: [], held: [], omen: 'ruhe', log: [] };
const a = R.newPlayer('A', false), b = R.newPlayer('B', false);
a.hueter = 'eiche'; b.hueter = 'glut';
a.board[0] = R.mkUnit('moosgnom'); b.board[0] = R.mkUnit('funkensalamander');
R.S.players.push(a, b);
const res = R.simulate(a, b, true);
if (!res || !Array.isArray(res.ev)) throw new Error('Probe-Kampf lieferte kein Ergebnis');

const out = `// ERZEUGT von tools/extract-rules.mjs aus ${path.relative(path.join(here, '..'), SRC) || SRC} am ${new Date().toISOString()}
// Nicht von Hand bearbeiten: Änderungen gehören in die Spielquellen, danach "npm run rules".
import vm from 'node:vm';
export const SOURCE = ${JSON.stringify(SOURCE)};
const script = new vm.Script(SOURCE, { filename: 'rules-src.js' });
// Jede Lobby bekommt eine eigene, abgeschottete Regel-Welt (eigener Spielzustand S, eigene Zähler)
export function createRules(seedLang = 'de') {
  const ctx = vm.createContext({ Math, JSON, Object, Array, Number, String, Boolean, Date, Promise, Proxy, Symbol, Set, Map, Error, console });
  script.runInContext(ctx);
  const R = ctx.RULES;
  try { R.setLang(seedLang); } catch {}
  return R;
}
`;
fs.mkdirSync(path.join(here, '../shared'), { recursive: true });
fs.writeFileSync(path.join(here, '../shared/rules.js'), out);
console.log('shared/rules.js gebaut:', Math.round(out.length / 1024), 'KB,', R.CREATURES.length, 'Wesen,', Object.keys(R.HUETER).length, 'Hüter, Probe-Kampf mit', res.ev.length, 'Ereignissen');
