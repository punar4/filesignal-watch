// Portal watcher core: check a portal, classify the result, and decide when its state
// has really changed (hysteresis), so the team gets one alert per real change, not flaps.
// It only loads public pages. It never logs in, never stores credentials, never solves captchas.
'use strict';

const DEFAULTS = {
  timeoutMs: 20000,   // a portal that takes longer than this is treated as down
  slowMs: 8000,       // up but slow (typical on deadline days)
  confirmUp: 2,       // consecutive good checks before we announce "back up"
  confirmDown: 2,     // consecutive bad checks before we announce "down"
  maxBodyBytes: 200000,
};
const MAINTENANCE = /under maintenance|scheduled maintenance|temporarily unavailable|downtime|service unavailable|site is down/i;

// One check. Returns {result: 'up'|'slow'|'down'|'maintenance', http, ms, reason}.
async function checkOnce(portal, opts = {}, fetchImpl = fetch) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);
  try {
    const res = await fetchImpl(portal.url, {
      method: 'GET', redirect: 'follow', signal: ctrl.signal,
      headers: { 'user-agent': 'FileSignalWatch/1.0 (uptime check; one request every few minutes)', accept: 'text/html' },
    });
    // read at most maxBodyBytes, only to spot maintenance pages
    let body = '';
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let n = 0;
      while (n < o.maxBodyBytes) { const { done, value } = await reader.read(); if (done) break; n += value.length; body += dec.decode(value, { stream: true }); }
      try { await reader.cancel(); } catch (e) { /* already closed */ }
    } else if (res.text) body = (await res.text()).slice(0, o.maxBodyBytes);
    const ms = Date.now() - t0;
    if (res.status >= 500) return { result: 'down', http: res.status, ms, reason: `Server error ${res.status}` };
    if (res.status === 429) return { result: 'down', http: 429, ms, reason: 'Too many requests (portal overloaded)' };
    if (res.status >= 400) return { result: 'down', http: res.status, ms, reason: `HTTP ${res.status}` };
    if (MAINTENANCE.test(body)) return { result: 'maintenance', http: res.status, ms, reason: 'Maintenance page shown' };
    if (ms > o.slowMs) return { result: 'slow', http: res.status, ms, reason: `Responding slowly (${(ms / 1000).toFixed(1)}s)` };
    return { result: 'up', http: res.status, ms, reason: 'Responding normally' };
  } catch (e) {
    const ms = Date.now() - t0;
    const reason = e.name === 'AbortError' ? `No response in ${o.timeoutMs / 1000}s` : 'Could not connect';
    return { result: 'down', http: 0, ms, reason };
  } finally { clearTimeout(timer); }
}

// Usable = a filing can be attempted now. Slow still counts as usable (worth trying).
const usable = (r) => r === 'up' || r === 'slow';

// Tracks one portal. feed() returns an event when the confirmed state changes.
class PortalState {
  constructor(portal, opts = {}) {
    this.portal = portal; this.o = { ...DEFAULTS, ...opts };
    this.state = 'unknown'; this.since = null; this.streak = 0; this.lastKind = null;
    this.last = null; this.history = []; // ring buffer of {t, result, ms}
  }
  feed(check, now = Date.now()) {
    this.last = { ...check, t: now };
    this.history.push({ t: now, result: check.result, ms: check.ms });
    const dayAgo = now - 24 * 3600 * 1000;
    while (this.history.length && this.history[0].t < dayAgo) this.history.shift();
    if (this.history.length > 2000) this.history.shift();

    const kind = usable(check.result) ? 'usable' : 'unusable';
    this.streak = kind === this.lastKind ? this.streak + 1 : 1;
    this.lastKind = kind;
    const need = kind === 'usable' ? this.o.confirmUp : this.o.confirmDown;
    const target = kind === 'usable' ? 'up' : 'down';
    if (this.state === target || this.streak < need) return null;
    const prev = this.state; const downFor = this.since ? now - this.since : null;
    this.state = target; this.since = now;
    if (prev === 'unknown' && target === 'up') return null; // startup: nothing to announce
    return { type: target === 'up' ? 'recovered' : 'went_down', portal: this.portal, prev, check, downForMs: prev === 'down' ? downFor : null };
  }
  uptime() {
    if (!this.history.length) return null;
    return Math.round((this.history.filter((h) => usable(h.result)).length / this.history.length) * 1000) / 10;
  }
}

// Pending filings (no credentials, just names and dates)
function parsePending(csv) {
  const lines = String(csv).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => {
    const c = l.split(',').map((x) => x.trim());
    const r = Object.fromEntries(head.map((h, i) => [h, (c[i] || '').slice(0, 120)]));
    return { client: r.client, ret: r.return, period: r.period, due: r.due_date, status: (r.status || '').toLowerCase() };
  }).filter((r) => r.client && r.ret);
}
function pendingFor(portal, pending, today) {
  const rets = (portal.returns || []).map((x) => x.toLowerCase());
  return pending
    .filter((p) => p.status !== 'filed' && rets.some((r) => p.ret.toLowerCase().startsWith(r.toLowerCase())))
    .map((p) => ({ ...p, daysLeft: Math.round((Date.parse(p.due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

function fmtDuration(ms) {
  if (ms == null) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// Alert text: short enough for a phone notification, specific enough to act on.
function message(ev, pending, today) {
  const p = ev.portal;
  if (ev.type === 'went_down') return `🔴 ${p.name} is down: ${ev.check.reason}. I'll message the moment it's back.`;
  const list = pendingFor(p, pending, today).filter((x) => x.daysLeft <= 7);
  const ready = list.filter((x) => x.status === 'ready');
  const lines = list.slice(0, 10).map((x) => `• ${x.client}: ${x.ret} ${x.period} (${x.daysLeft < 0 ? 'overdue' : x.daysLeft === 0 ? 'due today' : `due in ${x.daysLeft}d`}${x.status ? ', ' + x.status : ''})`);
  return [
    `🟢 ${p.name} is back up${ev.downForMs ? ` after ${fmtDuration(ev.downForMs)}` : ''} (${(ev.check.ms / 1000).toFixed(1)}s response${ev.check.result === 'slow' ? ', still slow' : ''}). File now.`,
    list.length ? `${ready.length} ready to file, ${list.length} due within 7 days:` : 'No filings due within 7 days.',
    ...lines,
    list.length > 10 ? `…and ${list.length - 10} more` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { DEFAULTS, checkOnce, PortalState, parsePending, pendingFor, message, usable, fmtDuration };
