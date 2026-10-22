// Startpunkt. Einstellungen über Umgebungsvariablen (siehe README).
import { startServer } from './server.js';
const n = (k, d) => process.env[k] ? Number(process.env[k]) : d;
const s = await startServer({
  port: n('PORT', 8080),
  dataDir: process.env.DATA_DIR || './data',
  pickMs: n('PICK_MS', 20000), marketMs: n('MARKET_MS', 45000), fightMs: n('FIGHT_MS', 9000),
  queueFillMs: n('QUEUE_FILL_MS', 30000), minHumans: n('MIN_HUMANS', 2),
  allowOrigin: process.env.ALLOW_ORIGIN || '*'
});
console.log(`Runecourt-Server läuft auf Port ${s.port}`);
const stop = async () => { await s.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
