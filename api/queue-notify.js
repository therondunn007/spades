// Vercel serverless function: send a "a seat opened up" push notification
// to the first person waiting in a Spades table's join queue.
// Called fire-and-forget by the driving host's client right after it writes
// a queueHold for that person. The Firebase service account JSON lives in
// the FIREBASE_SERVICE_ACCOUNT environment variable (set in the Vercel
// dashboard). It is never committed to the repo, and the key value never
// appears in logs or responses.
//
// Queue shape: rooms/{code}/queue/{uid} = {name, ts} (first in line = lowest
// ts, uid tiebreak). Hold shape: rooms/{code}/queueHold = {uid, seat, until}.
// Tokens shape: pushTokens/{uid}/{pushKey} = {token, at}.
// All responses are HTTP 200 JSON so the client never retries.
const admin = require('firebase-admin');

let app = null;
function getApp() {
  if (app) return app;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  app = admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: 'https://spades-multiplayer-65d6c-default-rtdb.firebaseio.com',
  });
  return app;
}

// Count human seats currently held. players node: rooms/{code}/players/{seat}
// = {uid, name, ...}; be tolerant of a uid-keyed map too.
function playersCount(roomData) {
  const players = roomData.players || {};
  return Object.keys(players).length;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = req.body || {};
    const room = body.room;
    const uid = body.uid;
    if (!room || !uid) return res.status(200).json({ sent: 0, reason: 'bad-request' });

    const db = getApp().database();
    const roomSnap = await db.ref('rooms/' + room).get();
    if (!roomSnap.exists()) return res.status(200).json({ sent: 0, reason: 'no-room' });
    const roomData = roomSnap.val();
    if (!roomData.meta) return res.status(200).json({ sent: 0, reason: 'no-room' });

    // The person being notified must actually be first in the queue.
    const queue = roomData.queue || {};
    const entries = Object.keys(queue)
      .map((k) => ({ uid: k, ts: (queue[k] && queue[k].ts) || 0 }))
      .sort((a, b) => (a.ts - b.ts) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    if (!entries.length || entries[0].uid !== uid) {
      return res.status(200).json({ sent: 0, reason: 'not-first' });
    }

    // And a seat must genuinely be open/held for them: either the hold names
    // them and is still live, or a seat is actually free.
    const hold = roomData.queueHold || null;
    const tableSize = Number(roomData.meta.count) || 0;
    const heldSeatFree = hold && hold.seat != null &&
      !(roomData.players && roomData.players[String(hold.seat)]);
    const holdLive = hold && hold.uid === uid && Number(hold.until) > Date.now();
    const seatOpen = tableSize > 0 && playersCount(roomData) < tableSize && heldSeatFree;
    if (!holdLive && !seatOpen) {
      return res.status(200).json({ sent: 0, reason: 'no-seat' });
    }

    const code = roomData.meta.code || room;
    const url = 'https://spades-kappa.vercel.app/?room=' + code;

    // Collect this person's tokens, keeping their push keys so dead tokens
    // can be removed afterwards.
    const tokSnap = await db.ref('pushTokens/' + uid).get();
    const tokenPairs = [];
    if (tokSnap.exists()) {
      const val = tokSnap.val();
      if (typeof val === 'string') tokenPairs.push({ key: null, token: val });
      else if (val && typeof val === 'object') {
        for (const k of Object.keys(val)) {
          const t = val[k];
          if (typeof t === 'string') tokenPairs.push({ key: k, token: t });
          else if (t && typeof t.token === 'string') tokenPairs.push({ key: k, token: t.token });
        }
      }
    }
    if (!tokenPairs.length) return res.status(200).json({ sent: 0, reason: 'no-tokens' });

    const tokens = tokenPairs.map((p) => p.token);
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: 'A seat opened at your table', body: 'Tap to take your seat.' },
      data: { room: code, url },
      webpush: { fcm_options: { link: url } },
    });

    // Drop tokens FCM says are dead so the next notify doesn't keep trying them.
    if (result.responses) {
      const dead = [];
      result.responses.forEach((r, i) => {
        if (!r.success && r.error && r.error.code &&
          (r.error.code === 'messaging/registration-token-not-registered' ||
           r.error.code === 'messaging/invalid-registration-token')) {
          dead.push(tokenPairs[i].key);
        }
      });
      for (const key of dead) {
        if (key) await db.ref('pushTokens/' + uid + '/' + key).remove().catch(() => {});
      }
    }
    return res.status(200).json({ sent: result.successCount, failed: result.failureCount });
  } catch (e) {
    console.error('queue-notify error', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'queue-notify failed' });
  }
};
