// Deletes multiplayer rooms nobody has been in for a while.
// Runs on Vercel Cron (daily, 09:00 UTC). Triggered only by Vercel Cron:
// it checks the CRON_SECRET bearer token Vercel sends with cron requests.
const admin = require('firebase-admin');

const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours with no human presence
const DB_URL = 'https://spades-multiplayer-65d6c-default-rtdb.firebaseio.com';

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: DB_URL,
  });
}

module.exports = async (req, res) => {
  // Only Vercel Cron may trigger this.
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  if (req.headers.authorization !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const db = getApp().database();
    const snap = await db.ref('rooms').get();
    const rooms = snap.val() || {};
    const now = Date.now();
    const deleted = [];
    const kept = [];
    for (const code of Object.keys(rooms)) {
      const room = rooms[code] || {};
      const meta = room.meta || {};
      // Newest sign of human life: any presence heartbeat, else room creation.
      let lastSeen = typeof meta.createdAt === 'number' ? meta.createdAt : 0;
      const presence = room.presence || {};
      for (const seat of Object.keys(presence)) {
        const ls = presence[seat] && presence[seat].lastSeen;
        if (typeof ls === 'number' && ls > lastSeen) lastSeen = ls;
      }
      // No usable timestamp at all (room mid-creation): leave it alone.
      if (!lastSeen) { kept.push(code); continue; }
      if (now - lastSeen > STALE_MS) {
        await db.ref('rooms/' + code).remove();
        deleted.push(code);
        console.log('cleanup: deleted stale room ' + code);
      } else {
        kept.push(code);
      }
    }
    return res.status(200).json({ checked: Object.keys(rooms).length, deleted, kept });
  } catch (e) {
    console.error('cleanup failed', e);
    return res.status(500).json({ error: 'cleanup failed' });
  }
};
