// Sichert Konten, Rangliste und Tagesrangliste in Firebase, damit sie einen Neustart des
// kostenlosen Servers überleben. Der Server meldet sich dafür mit einem eigenen Firebase-Konto an
// (RC_SAVE_EMAIL / RC_SAVE_PASSWORD) und speichert alles in seinem eigenen Dokument users/<uid>.
// Die Firestore-Regeln müssen dafür nicht geändert werden.
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDZIEPL1c7MZLBb4eUHOVTpNnzGs4LZJxo';
const PROJECT = process.env.FIREBASE_PROJECT || 'runecourt-e9917';
const ID = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const LIMIT = 190000;

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status);
  return j;
}

export class Cloud {
  constructor(email, password) { this.email = email; this.password = password; this.tok = null; this.exp = 0; this.uid = null; }
  get on() { return !!(this.email && this.password); }
  async auth() {
    if (this.tok && Date.now() < this.exp - 60000) return this.tok;
    let j;
    try { j = await post(ID + 'signInWithPassword?key=' + API_KEY, { email: this.email, password: this.password, returnSecureToken: true }); }
    catch (e) {
      if (!/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS/.test(e.message)) throw e;
      // Erster Start: das Konto des Servers anlegen
      j = await post(ID + 'signUp?key=' + API_KEY, { email: this.email, password: this.password, returnSecureToken: true });
    }
    this.tok = j.idToken; this.uid = j.localId; this.exp = Date.now() + Number(j.expiresIn || 3600) * 1000;
    return this.tok;
  }
  url() { return `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${this.uid}`; }
  async load() {
    const tok = await this.auth();
    const r = await fetch(this.url(), { headers: { authorization: 'Bearer ' + tok } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Laden: HTTP ' + r.status);
    const j = await r.json();
    const s = j.fields?.data?.stringValue;
    return s ? JSON.parse(s) : null;
  }
  async save(db) {
    const tok = await this.auth();
    const data = JSON.stringify(db);
    if (data.length > LIMIT) throw new Error('zu groß: ' + data.length);
    const r = await fetch(this.url() + '?updateMask.fieldPaths=data&updateMask.fieldPaths=ts', {
      method: 'PATCH', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: data }, ts: { integerValue: String(Date.now()) } } })
    });
    if (!r.ok) throw new Error('Speichern: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  async remove() { const tok = await this.auth(); await fetch(this.url(), { method: 'DELETE', headers: { authorization: 'Bearer ' + tok } }); await post(ID + 'delete?key=' + API_KEY, { idToken: tok }); }
}
