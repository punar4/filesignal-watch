# FileSignal Watch: setup (Windows, about 25 minutes)

Do this after FileSignal Ready is live. The steps are the same pattern.

## A. Run it on your laptop

1. Unzip `filesignal-watch.zip` into `Documents\projects\`.
2. VS Code → **File → Open Folder** → `filesignal-watch`.
3. In the terminal, run these one at a time:

   | Command | You should see |
   |---|---|
   | `npm test` | `# pass 6` and `# fail 0` (nothing to install, there are no dependencies) |
   | `npm run once` | One line per portal: UP / SLOW / DOWN with the response time. This is a real check from your laptop |
   | `npm start` | `PortalWatch dashboard on http://localhost:3100` |

4. Open **http://localhost:3100**. Within a minute, each portal card shows its status. Press `Ctrl + C` to stop.

## B. Set up email alerts (Resend, free)

5. Go to **resend.com** → sign up → **API Keys → Create API key** → copy it. It starts with `re_`.
6. For testing, the sender can be `onboarding@resend.dev`, which only delivers to the email you signed up with. To send to others later, verify your own domain in Resend.

## C. GitHub + Render

7. GitHub → new **private** repo `filesignal-watch`, with no README.
8. In the terminal:

   ```
   git init; git add .; git commit -m "FileSignal Watch v1"; git branch -M main; git remote add origin https://github.com/punar4/filesignal-watch.git; git push -u origin main
   ```

9. Render → **New + → Blueprint** → `filesignal-watch` → it asks for these values:

   | Key | Value |
   |---|---|
   | `DASH_PASSWORD` | any password; the dashboard asks for it (username can be anything) |
   | `RESEND_API_KEY` | the `re_...` key from step 5 |
   | `ALERT_EMAIL_FROM` | `onboarding@resend.dev` |
   | `ALERT_EMAIL_TO` | your email (comma-separate to add more) |

   Click **Apply** and wait for **Live**.

10. Add a **cron-job.org** job for `https://<watch-link>/health` every **10 minutes**, so it never sleeps.

## D. Check that alerts work

11. Open the dashboard link and log in with `DASH_PASSWORD`.
12. Alerts only go out when a portal changes state (down → back up), so you won't get an email right away. That's normal. The **Recent alerts** box shows every alert exactly as sent.

## Optional channels

Telegram, Slack and WhatsApp are also supported. See the README for the keys. WhatsApp needs a Meta business account and an approved template, so add it once Arthaveda is interested.
