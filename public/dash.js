{
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { up: 'Up', slow: 'Slow', down: 'Down', maintenance: 'Maintenance', unknown: 'Checking' };
const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const COL = { up: 'var(--up)', slow: 'var(--slow)', down: 'var(--down)', maintenance: 'var(--down)' };

async function refresh() {
  try {
    const s = await (await fetch('/api/status')).json();
    const down = s.portals.filter((p) => p.state === 'down');
    $('headline').textContent = down.length ? `${down.map((p) => p.name).join(', ')} ${down.length > 1 ? 'are' : 'is'} down. You'll get an alert when ${down.length > 1 ? 'they come' : 'it comes'} back.` : s.portals.every((p) => p.state === 'unknown') ? (s.portals.some((p) => p.last) ? 'First checks done. Confirming with a second check before any alert…' : 'Checking portals…') : 'All portals are reachable right now.';
    $('cards').innerHTML = s.portals.map((p) => {
      const cur = p.last ? p.last.result : 'unknown';
      return `<div class="card"><div class="st"><span class="name">${esc(p.name)}</span><span class="dot ${cur}">${LABEL[cur]}</span></div>
      <div class="big">${p.last ? (p.last.ms / 1000).toFixed(1) + 's' : '—'}</div><div class="k">${p.last ? esc(p.last.reason) + ' · checked ' + ago(p.last.t) : 'first check pending'}</div>
      <div class="strip" title="last checks, oldest left">${p.history.map(([, r, ms]) => `<i style="background:${COL[r]};height:${r === 'up' || r === 'slow' ? Math.max(30, Math.min(100, ms / 150)) : 100}%"></i>`).join('')}</div>
      <div class="k">${p.uptime24h == null ? '' : `Reachable ${p.uptime24h}% of checks in the last 24 h`}${p.state === 'down' && p.since ? ' · down since ' + ago(p.since) : ''}</div>
      ${p.pending.length ? `<ul class="pend">${p.pending.slice(0, 6).map((x) => `<li><span>${esc(x.client)}: ${esc(x.ret)} ${esc(x.period)} <span class="k">${esc(x.status)}</span></span><span class="d ${x.daysLeft <= 0 ? 'down' : x.daysLeft <= 3 ? 'slow' : ''}">${x.daysLeft < 0 ? 'overdue' : x.daysLeft === 0 ? 'today' : x.daysLeft + 'd'}</span></li>`).join('')}</ul>` : ''}</div>`;
    }).join('');
    if (s.events.length) $('events').innerHTML = s.events.map((e) => `<pre>${esc(new Date(e.t).toLocaleString('en-IN'))}\n${esc(e.text)}</pre>`).join('');
    $('foot').textContent = `Each portal is checked about every ${Math.round(s.intervalSec / 60)} min with one ordinary page request. No logins, no credentials.${s.pendingIsSample ? ' Pending filings shown are a fictional sample; add config/pending.csv for your clients.' : ''}`;
  } catch (e) { $('headline').textContent = 'Lost connection to the watcher. Retrying…'; }
}
refresh(); setInterval(refresh, 15000);
}
