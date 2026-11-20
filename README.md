# FileSignal Watch

On deadline days the GST, income tax and TRACES portals slow down or go offline, and someone sits refreshing them. PortalWatch checks each portal every ~3 minutes and sends **one Telegram or Slack message the moment a portal is back**, listing which clients' filings are due and ready.

It **never logs in, never stores credentials, never solves captchas**. It only loads the public login page, the same as opening it in a browser. The actual filing stays with the accountant.

## How it decides

- **Up / slow / down / maintenance.** Each check is one ordinary page request. A 5xx or 429 response, no answer in 20 s, or a maintenance page counts as down. An answer slower than 8 s counts as slow, which is still worth trying.
- **No false alarms.** It takes 2 checks in a row to declare a portal down, and 2 good checks to declare it back. One blip sends nothing.
- **Polite.** At most one request per portal per minute (default about every 3 min, with random spacing).
- **Alerts retry.** If Telegram or Slack fails, it retries 3 times with growing waits, then gives up and records the failure without the token.

## Run

```bash
npm test          # 5 tests against a fake portal; no dependencies to install
npm run once      # check all portals once and print the result
npm start         # watch continuously; dashboard on http://localhost:3100
```

## Set up alerts (environment variables)

| Variable | What |
|---|---|
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | **Email** (easiest; everyone has it). Free Resend account, verify a sender, comma-separate several recipients |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TO`, `WHATSAPP_TEMPLATE` | **WhatsApp** via Meta's WhatsApp Cloud API. Needs a Meta business app and one approved message template with a single text variable; alerts sent by a business need a template |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram bot (free, 2 minutes to set up) |
| `WEBHOOK_URL` | Slack / Google Chat / Discord incoming webhook |

Any combination works; every configured channel gets each alert.
| `DASH_PASSWORD` | Puts the dashboard behind a password |
| `INTERVAL_SEC` | Seconds between checks (minimum 60, default 180) |
| `PENDING_FILE` | CSV of pending filings: `client,return,period,due_date,status` (see `config/pending.sample.csv`) |

Portal URLs are in `config/portals.json`, so you can edit them if a portal moves.

## Keeping it awake

Render's free plan sleeps after about 15 minutes without visitors, and a sleeping watcher checks nothing. Three fixes, cheapest first:

1. **Free pinger:** create a free job on cron-job.org (or UptimeRobot) that opens `https://<your-app>.onrender.com/health` every 10 minutes. Visits keep the service awake, and one service running all month fits inside Render's free monthly hours.
2. **An always-on machine:** office PC, Raspberry Pi, or a free-tier cloud VM. Run `npm start` there.
3. **Paid Render Starter:** never sleeps, no pinger needed.

After a restart, it needs two checks (about 6 min) before it trusts a portal's state again, so a restart never causes a false alert.

## Roadmap

Read the pending list straight from FileReady; send WhatsApp alerts; record outage history to show which hours are safest to file.
