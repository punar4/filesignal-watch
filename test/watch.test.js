'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const W = require('../src/watch.js');
const { notify, withRetry } = require('../src/notify.js');

// fake portal: mode decides how it answers
let mode = 'up';
const fake = http.createServer((req, res) => {
  if (mode === 'up') { res.writeHead(200); res.end('<html>Login</html>'); }
  else if (mode === 'slow') setTimeout(() => { res.writeHead(200); res.end('ok'); }, 400);
  else if (mode === 'maint') { res.writeHead(200); res.end('<h1>Portal is under maintenance</h1>'); }
  else if (mode === '503') { res.writeHead(503); res.end(); }
  else if (mode === 'hang') { /* never answer */ }
});
let url;
test.before(async () => { await new Promise((r) => fake.listen(0, r)); url = `http://127.0.0.1:${fake.address().port}/`; });
test.after(() => { fake.closeAllConnections(); fake.close(); });
const P = () => ({ id: 'gst', name: 'GST portal', url, returns: ['GSTR-3B', 'GSTR-1'] });

test('classifies up, slow, maintenance, server error and timeout', async () => {
  const o = { slowMs: 200, timeoutMs: 800 };
  mode = 'up'; assert.equal((await W.checkOnce(P(), o)).result, 'up');
  mode = 'slow'; assert.equal((await W.checkOnce(P(), o)).result, 'slow');
  mode = 'maint'; assert.equal((await W.checkOnce(P(), o)).result, 'maintenance');
  mode = '503'; const r = await W.checkOnce(P(), o); assert.equal(r.result, 'down'); assert.equal(r.http, 503);
  mode = 'hang'; const h = await W.checkOnce(P(), o); assert.equal(h.result, 'down'); assert.match(h.reason, /No response/);
  mode = 'up';
});

test('one alert per real change: no flapping, no alert at startup', () => {
  const s = new W.PortalState(P());
  const c = (result) => ({ result, ms: 900, reason: result });
  let t = 0; const feed = (r) => s.feed(c(r), (t += 60000));
  assert.equal(feed('up'), null); assert.equal(feed('up'), null);          // startup: silent
  assert.equal(s.state, 'up');
  assert.equal(feed('down'), null);                                        // one blip: ignored
  assert.equal(feed('up'), null);
  assert.equal(feed('down'), null);
  const d = feed('maintenance'); assert.equal(d.type, 'went_down');        // two bad in a row
  assert.equal(feed('down'), null);                                        // already down: silent
  assert.equal(feed('slow'), null);
  const u = feed('up'); assert.equal(u.type, 'recovered'); assert.ok(u.downForMs > 0);
});

test('recovery alert lists due filings for that portal, soonest first', () => {
  const pending = W.parsePending('client,return,period,due_date,status\nA Ltd,GSTR-3B,Oct 2026,2026-11-20,ready\nB Ltd,GSTR-1,Nov 2026,2026-12-11,not started\nC Ltd,TDS,Nov,2026-12-07,ready\nD Ltd,GSTR-3B,Oct 2026,2026-11-20,filed\n');
  const msg = W.message({ type: 'recovered', portal: P(), check: { ms: 2100, result: 'up' }, downForMs: 95 * 60000 }, pending, '2026-11-20');
  assert.match(msg, /back up after 1 h 35 min/);
  assert.match(msg, /A Ltd: GSTR-3B Oct 2026 \(due today, ready\)/);
  assert.ok(!msg.includes('C Ltd'));   // TDS is not filed on the GST portal
  assert.ok(!msg.includes('D Ltd'));   // already filed
  assert.ok(!msg.includes('B Ltd'));   // more than 7 days away
});

test('alerts retry on failure, and secrets never appear in logs', async () => {
  let calls = 0; const logs = [];
  const fakeFetch = async (u) => { calls++; if (calls < 2) throw new Error('net'); return { ok: true }; };
  const env = { TELEGRAM_BOT_TOKEN: 'SECRET123', TELEGRAM_CHAT_ID: '42' };
  const log = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  const res = await notify('hello', { env, fetchImpl: fakeFetch, log });
  assert.deepEqual(res, [{ channel: 'telegram', ok: true }]);
  assert.equal(calls, 2);
  const failing = async () => { throw new Error('https://api.telegram.org/botSECRET123 failed'); };
  const r2 = await notify('x', { env, fetchImpl: failing, log });
  assert.equal(r2[0].ok, false);
  assert.ok(!logs.join(' ').includes('SECRET123'));
  let n = 0; await assert.rejects(withRetry(async () => { n++; throw new Error('no'); }, 3, 1)); assert.equal(n, 3);
});

test('dashboard: security headers, optional password, read-only', async () => {
  process.env.DASH_PASSWORD = 'pw-123';
  delete require.cache[require.resolve('../src/server.js')];
  const { createServer } = require('../src/server.js');
  const srv = createServer(); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const h = await fetch(base + '/health'); assert.equal(h.status, 200);
    assert.equal((await fetch(base + '/api/status')).status, 401);
    const auth = { authorization: 'Basic ' + Buffer.from('x:pw-123').toString('base64') };
    const s = await fetch(base + '/api/status', { headers: auth });
    assert.equal(s.status, 200);
    assert.match(s.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(base + '/api/status', { method: 'POST', headers: auth })).status, 405);
    assert.equal((await fetch(base + '/../config/portals.json', { headers: auth })).status, 404);
    const body = await s.json(); assert.equal(body.portals.length, 4);
  } finally { srv.close(); delete process.env.DASH_PASSWORD; }
});

test('email and WhatsApp channels send the right requests, without leaking keys', async () => {
  const { channels } = require('../src/notify.js');
  const sent = [];
  const f = async (url, o) => { sent.push({ url, auth: o.headers.authorization, body: JSON.parse(o.body) }); return { ok: true }; };
  const env = { RESEND_API_KEY: 'rk', ALERT_EMAIL_TO: 'a@x.in, b@x.in', ALERT_EMAIL_FROM: 'alerts@x.in', WHATSAPP_TOKEN: 'wt', WHATSAPP_PHONE_ID: '123', WHATSAPP_TO: '919800000000', WHATSAPP_TEMPLATE: 'portal_alert' };
  const chs = channels(env);
  assert.deepEqual(chs.map((c) => c.name), ['email', 'whatsapp']);
  for (const c of chs) await c.send('🟢 GST portal is back up\nline 2', f);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['a@x.in', 'b@x.in']);
  assert.equal(sent[0].body.subject, '🟢 GST portal is back up');
  assert.match(sent[1].url, /graph\.facebook\.com\/v[\d.]+\/123\/messages/);
  assert.equal(sent[1].body.template.name, 'portal_alert');
  assert.equal(sent[1].body.template.components[0].parameters[0].text, '🟢 GST portal is back up | line 2');
});
