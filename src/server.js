// Runs the watch loop and serves a small status dashboard.
//   node src/server.js          -> watch continuously + dashboard on PORT
//   node src/server.js --once   -> check every portal once, print, exit
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const W = require('./watch.js');
const { notify } = require('./notify.js');

const ROOT = path.join(__dirname, '..');
const env = process.env;
const INTERVAL_SEC = Math.max(60, Number(env.INTERVAL_SEC || 180)); // never more often than once a minute
const PENDING_FILE = env.PENDING_FILE || path.join(ROOT, 'config', 'pending.csv');
const PORTALS_FILE = env.PORTALS_FILE || path.join(ROOT, 'config', 'portals.json');

const portals = JSON.parse(fs.readFileSync(PORTALS_FILE, 'utf8'));
for (const p of portals) if (!/^https:\/\//.test(p.url)) throw new Error(`Portal ${p.id} must use https`);
const states = new Map(portals.map((p) => [p.id, new W.PortalState(p, { slowMs: Number(env.SLOW_MS || W.DEFAULTS.slowMs) })]));
const events = []; // last 50 alerts, for the dashboard

function loadPending() {
  const f = fs.existsSync(PENDING_FILE) ? PENDING_FILE : path.join(ROOT, 'config', 'pending.sample.csv');
  try { return { rows: W.parsePending(fs.readFileSync(f, 'utf8')), sample: f.endsWith('sample.csv') }; } catch (e) { return { rows: [], sample: false }; }
}
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date

async function tick(portal) {
  const check = await W.checkOnce(portal, { slowMs: Number(env.SLOW_MS || W.DEFAULTS.slowMs) });
  const st = states.get(portal.id);
  const ev = st.feed(check);
  if (ev) {
    const text = W.message(ev, loadPending().rows, today());
    events.unshift({ t: Date.now(), portal: portal.name, type: ev.type, text });
    events.length = Math.min(events.length, 50);
    await notify(text);
  }
}

function schedule(portal, i) {
  const run = async () => {
    try { await tick(portal); } catch (e) { console.error('check failed:', portal.id); }
    const jitter = INTERVAL_SEC * 1000 * (0.85 + Math.random() * 0.3); // spread requests out
    setTimeout(run, jitter);
  };
  setTimeout(run, i * 4000); // stagger portals at startup
}

function status() {
  const pending = loadPending();
  return {
    now: new Date().toISOString(), intervalSec: INTERVAL_SEC, pendingIsSample: pending.sample,
    portals: portals.map((p) => {
      const s = states.get(p.id);
      return { id: p.id, name: p.name, url: p.url, state: s.state, since: s.since, last: s.last, uptime24h: s.uptime(), history: s.history.slice(-120).map((h) => [h.t, h.result, h.ms]), pending: W.pendingFor(p, pending.rows, today()) };
    }),
    events,
  };
}

// --- dashboard server ---
const SEC = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000', 'cache-control': 'no-store',
};
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/dash.js': ['dash.js', 'text/javascript; charset=utf-8'], '/dash.css': ['dash.css', 'text/css; charset=utf-8'] };

function authorised(req) {
  const pass = env.DASH_PASSWORD;
  if (!pass) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const got = Buffer.from(Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':'));
  const want = Buffer.from(pass);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function createServer() {
  return http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SEC)) res.setHeader(k, v);
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const url = req.url.split('?')[0];
    if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    if (!authorised(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="FileSignal Watch"' }); return res.end('Login required'); }
    if (url === '/api/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(status())); }
    const f = FILES[url];
    if (!f) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': f[1] });
    fs.createReadStream(path.join(ROOT, 'public', f[0])).pipe(res);
  });
}

async function once() {
  const rows = await Promise.all(portals.map(async (p) => ({ p, c: await W.checkOnce(p) })));
  for (const { p, c } of rows) console.log(`${c.result.toUpperCase().padEnd(11)} ${String(c.ms).padStart(6)}ms  ${p.name}  ${c.reason}`);
  process.exit(rows.every(({ c }) => W.usable(c.result)) ? 0 : 1);
}

if (require.main === module) {
  if (process.argv.includes('--once')) once();
  else {
    const port = Number(env.PORT || 3100);
    createServer().listen(port, () => console.log(`PortalWatch dashboard on http://localhost:${port}, checking every ~${INTERVAL_SEC}s`));
    portals.forEach(schedule);
  }
}
module.exports = { createServer, status, states, portals };
