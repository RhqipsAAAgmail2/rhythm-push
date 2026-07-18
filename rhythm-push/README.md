# Rhythm — with real push notifications

This is your de-bloat tracker, plus a small backend that sends real push
notifications — the kind that show up even with your phone locked and the
browser fully closed.

## How it works

- `public/index.html` — the app itself (same as before, now saving to your
  browser's local storage instead of Claude's artifact storage).
- `public/service-worker.js` — a tiny background script your browser installs;
  it's what receives push messages and shows the system notification.
- `public/manifest.json` — makes the app installable ("Add to Home Screen"),
  which iOS requires before it'll allow push notifications at all.
- `server.js` — the always-on backend. It stores your reminder settings and,
  when pinged, checks whether you're overdue for water/steps and sends a push
  if so.

The reason this needs a real server: browsers only deliver push notifications
that were sent through their own push service (Apple/Google's infrastructure),
and something has to tell that service *when* to send one. That "something"
has to be running permanently on the internet — it can't live inside a chat
session or on your phone.

## One-time setup (about 20–30 minutes)

### 1. Generate your VAPID keys

VAPID keys let your server prove to Apple/Google's push service that it's
allowed to send to your subscribed device. Run this once, locally or in any
terminal with Node installed:

```
npx web-push generate-vapid-keys
```

You'll get a **Public Key** and a **Private Key**. Save both — you'll paste
them in as environment variables in step 3.

### 2. Push this project to GitHub

Create a new GitHub repo and push these files to it (drag-and-drop upload
through GitHub's website works fine too if you don't use git normally).

### 3. Deploy the backend to Render (free tier)

1. Go to [render.com](https://render.com) and sign up / log in.
2. **New +** → **Web Service** → connect your GitHub repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment**, add these variables:
   - `VAPID_PUBLIC_KEY` = (the public key from step 1)
   - `VAPID_PRIVATE_KEY` = (the private key from step 1)
   - `VAPID_CONTACT_EMAIL` = `mailto:you@example.com` (any email, it's just
     required by the push spec so services can contact you if something's
     wrong with your server)
5. Deploy. Render will give you a URL like `https://rhythm-push.onrender.com`
   — that's your app's real address now.

### 4. Open the app and enable notifications

1. Visit your Render URL on your phone.
2. **Add it to your home screen** (Safari: Share → Add to Home Screen; Chrome
   on Android: menu → Add to Home Screen / Install app). On iOS this step
   isn't optional — Safari only allows push notifications for installed
   home-screen apps, not regular browser tabs.
3. Open the app from the home screen icon, tap the gear, turn on Water and/or
   Movement reminders, and tap **Enable notifications**. Allow the permission
   prompt.

### 5. Set up the cron job that actually triggers reminders

Render's free tier doesn't run background schedules on its own, so an outside
service needs to "ping" your server periodically to make it check for and
send due reminders.

1. Go to [cron-job.org](https://cron-job.org) (free) and create an account.
2. Create a new cron job:
   - **URL:** `https://YOUR-RENDER-URL.onrender.com/api/tick`
   - **Schedule:** every 15 minutes
3. Save it and enable it.

That's it — every 15 minutes, cron-job.org hits your server, your server
checks who's overdue, and sends a real push through Apple/Google's push
service straight to your phone, closed app and all.

## Testing it

- After enabling notifications, log some water, then in Settings set the
  water reminder interval to **1 hr** temporarily so you don't have to wait
  long, close the app fully, and wait for the next cron tick after an hour
  passes.
- You can also manually trigger a check any time by visiting
  `https://YOUR-RENDER-URL.onrender.com/api/tick` in a browser — it'll return
  something like `{"ok":true,"sent":1,"subscribers":1}` if it sent one.

## Limitations worth knowing

- **Render's free tier sleeps** after 15 minutes with no traffic and takes a
  few seconds to wake up on the next request — the cron ping itself is what
  wakes it, so this doesn't stop reminders from working, it just means the
  very first request after a sleep is a bit slower.
- **iOS requires the home-screen install step.** Push won't work in a regular
  Safari tab on iPhone — this is an Apple restriction, not something in this
  code.
- Reminder timing is checked in 15-minute windows (whatever your cron
  interval is), so a "2 hour" reminder might arrive a few minutes early or
  late — that's normal and fine for this use case.
