// Vercel serverless function: send a "someone joined your table" push
// notification to the other players seated at a Spades table.
// Called by the joining player's client right after they take a seat.
// The Firebase service account JSON lives in the FIREBASE_SERVICE_ACCOUNT
// environment variable (set in the Vercel dashboard). It is never committed
// to the repo, and the key value never appears in logs or responses.
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

// players node shape: rooms/{code}/players/{seat} = {uid, name, ...}
// Be tolerant: also accept a uid-keyed map.
function seatedUids(roomData) {
  const players = roomData.players || {};
  const uids = [];
  for (const key of Object.keys(players)) {
    const p = players[key];
    if (p && typeof p === 'object' && typeof p.uid === 'string') uids.push(p.uid);
    else if (p && typeof p === 'object' && typeof p.name === 'string') uids.push(key);
    else if (typeof p === 'string') uids.push(p);
  }
  return uids;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = req.body || {};
    const room = body.room;
    const joinerUid = body.joinerUid;
    const joinerName = body.joinerName;
    if (!room || !joinerUid) return res.status(400).json({ error: 'room and joinerUid required' });

    const db = getApp().database();
    const roomSnap = await db.ref('rooms/' + room).get();
    if (!roomSnap.exists()) return res.status(404).json({ error: 'no such room' });
    const roomData = roomSnap.val();

    // The caller must actually be seated at this table, or nobody can spam
    // notifications at strangers by guessing room codes.
    const uids = seatedUids(roomData);
    if (!uids.includes(joinerUid)) return res.status(403).json({ error: 'joiner is not seated at this table' });

    const code = (roomData.meta && roomData.meta.code) || room;
    const url = 'https://spades-kappa.vercel.app/?room=' + code;
    const name = String(joinerName || 'Someone').slice(0, 40);

    const tokens = [];
    for (const uid of uids) {
      if (uid === joinerUid) continue;
      const tokSnap = await db.ref('pushTokens/' + uid).get();
      if (!tokSnap.exists()) continue;
      const val = tokSnap.val();
      if (typeof val === 'string') tokens.push(val);
      else if (val && typeof val === 'object') {
        for (const k of Object.keys(val)) {
          const t = val[k];
          if (typeof t === 'string') tokens.push(t);
          else if (t && typeof t.token === 'string') tokens.push(t.token);
        }
      }
    }
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no tokens for other players' });

    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: name + ' joined your table', body: 'Tap to jump in.' },
      data: { room: code, url },
      webpush: { fcm_options: { link: url } },
    });
    return res.status(200).json({ sent: result.successCount, failed: result.failureCount });
  } catch (e) {
    console.error('notify error', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'notify failed' });
  }
};
