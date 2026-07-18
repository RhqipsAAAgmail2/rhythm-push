// Rhythm push backend.
//
// This is the always-on piece: it stores each device's push subscription and
// reminder settings, and — when pinged by an external cron job — checks who's
// due for a nudge and sends a real push notification through the browser's
// push service, which delivers it even if the app/browser is fully closed.
//
// Storage is a single JSON file. That's plenty for one person's reminders;
// swap in a real database only if you outgrow it.

const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { subscribers: [] };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:you@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set — push sending will fail until you set them.');
}

// The app fetches this on load so the public key never has to be hardcoded into the frontend.
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY || '' });
});

// Called whenever the app enables push, or changes reminder settings / logs water or steps.
app.post('/api/subscribe', (req, res) => {
  const { subscription, water, steps } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'missing subscription' });
  }
  const data = loadData();
  let entry = data.subscribers.find(s => s.subscription.endpoint === subscription.endpoint);
  if (!entry) {
    entry = {
      subscription,
      water: { on: false, hours: 2, lastAt: null, lastNotifiedAt: null },
      steps: { on: false, hours: 3, lastAt: null, lastNotifiedAt: null }
    };
    data.subscribers.push(entry);
  }
  entry.subscription = subscription;
  if (water) Object.assign(entry.water, water);
  if (steps) Object.assign(entry.steps, steps);
  saveData(data);
  res.json({ ok: true });
});

// Hit this from an external cron (see README) every 10-15 minutes.
// It checks every subscriber and sends a push to anyone who's due.
app.get('/api/tick', async (req, res) => {
  const data = loadData();
  const now = Date.now();
  let sent = 0;
  const stillValid = [];

  for (const sub of data.subscribers) {
    let keep = true;
    for (const type of ['water', 'steps']) {
      const cfg = sub[type];
      if (!cfg || !cfg.on) continue;

      const hoursSinceLog = cfg.lastAt ? (now - cfg.lastAt) / 3600000 : cfg.hours + 1;
      if (hoursSinceLog < cfg.hours) continue;

      const hoursSinceNotify = cfg.lastNotifiedAt ? (now - cfg.lastNotifiedAt) / 3600000 : Infinity;
      if (hoursSinceNotify < cfg.hours * 0.9) continue;

      const payload = JSON.stringify({
        title: type === 'water' ? 'Water check-in' : 'Movement check-in',
        body: type === 'water'
          ? "It's been a while since your last water — take a sip 💧"
          : "Haven't logged steps in a while — short walk? 🚶",
        tag: 'rhythm-' + type
      });

      try {
        await webpush.sendNotification(sub.subscription, payload);
        cfg.lastNotifiedAt = now;
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          keep = false; // subscription expired or was revoked — drop it
        } else {
          console.error('push send failed:', err.statusCode, err.body);
        }
      }
    }
    if (keep) stillValid.push(sub);
  }

  data.subscribers = stillValid;
  saveData(data);
  res.json({ ok: true, sent, subscribers: data.subscribers.length });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rhythm push server running on port ${PORT}`));
