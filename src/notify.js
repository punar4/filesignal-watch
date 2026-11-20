// Sends alerts. Secrets come only from environment variables and are never logged.
'use strict';

async function post(url, body, fetchImpl, headers = {}) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Retries a failed alert a few times with growing waits (the AR3 idea: retry what can recover, then stop).
async function withRetry(fn, tries = 3, baseMs = 2000) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i)); }
  }
  throw last;
}

function channels(env = process.env) {
  const out = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    out.push({ name: 'telegram', send: (text, f) => post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }, f) });
  }
  if (env.WEBHOOK_URL) {
    // Slack / Google Chat / Discord-compatible: send both common keys
    out.push({ name: 'webhook', send: (text, f) => post(env.WEBHOOK_URL, { text, content: text }, f) });
  }
  if (env.RESEND_API_KEY && env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM) {
    // Email via Resend's HTTP API (free tier). ALERT_EMAIL_TO can be a comma-separated list.
    out.push({ name: 'email', send: (text, f) => post('https://api.resend.com/emails', {
      from: env.ALERT_EMAIL_FROM, to: env.ALERT_EMAIL_TO.split(',').map((x) => x.trim()).filter(Boolean),
      subject: text.split('\n')[0].slice(0, 120), text,
    }, f, { authorization: `Bearer ${env.RESEND_API_KEY}` }) });
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TO) {
    // WhatsApp Cloud API (Meta). Business-initiated alerts must use an approved template with
    // one body variable; set WHATSAPP_TEMPLATE to its name. Recipients: comma-separated numbers.
    const ver = env.WHATSAPP_API_VERSION || 'v21.0';
    const url = `https://graph.facebook.com/${ver}/${env.WHATSAPP_PHONE_ID}/messages`;
    out.push({ name: 'whatsapp', send: async (text, f) => {
      for (const to of env.WHATSAPP_TO.split(',').map((x) => x.trim()).filter(Boolean)) {
        const body = env.WHATSAPP_TEMPLATE
          ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: env.WHATSAPP_TEMPLATE, language: { code: env.WHATSAPP_LANG || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\n+/g, ' | ').slice(0, 1000) }] }] } }
          : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000) } };
        await post(url, body, f, { authorization: `Bearer ${env.WHATSAPP_TOKEN}` });
      }
    } });
  }
  return out;
}

async function notify(text, { env = process.env, fetchImpl = fetch, log = console } = {}) {
  const chs = channels(env);
  if (!chs.length) { log.log('[alert, no channel configured]\n' + text); return []; }
  const results = [];
  for (const ch of chs) {
    try { await withRetry(() => ch.send(text, fetchImpl)); results.push({ channel: ch.name, ok: true }); }
    catch (e) { results.push({ channel: ch.name, ok: false }); log.error(`alert via ${ch.name} failed`); }
  }
  return results;
}

module.exports = { notify, channels, withRetry };
