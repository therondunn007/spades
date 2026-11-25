// Firebase Cloud Messaging service worker for Spades.
// Registered automatically by Firebase Messaging as /firebase-messaging-sw.js.
// Shows the "someone joined your table" and "the host started the game"
// notifications when the app is closed; tapping one opens the game
// straight at that table.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({"apiKey": "AIzaSyDC0o2Q11GSJKxylTsyDQMBDDZRx0iVi1g", "authDomain": "spades-multiplayer-65d6c.firebaseapp.com", "databaseURL": "https://spades-multiplayer-65d6c-default-rtdb.firebaseio.com", "projectId": "spades-multiplayer-65d6c", "storageBucket": "spades-multiplayer-65d6c.firebasestorage.app", "messagingSenderId": "402065821930", "appId": "1:402065821930:web:0f5e76ba3c3ee9bc824793"});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var data = payload.data || {};
  var notif = payload.notification || {};
  var title = notif.title || 'Someone joined your table';
  var body = notif.body || 'Tap to jump in.';
  var url = data.url || 'https://spades-kappa.vercel.app/';
  self.registration.showNotification(title, {
    body: body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: url },
    tag: data.tag || 'spades-table-join'
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://spades-kappa.vercel.app/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) { list[i].navigate(url); return list[i].focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
