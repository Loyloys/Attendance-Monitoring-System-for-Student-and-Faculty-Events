importScripts('https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js');

const config = new URL(self.location.href).searchParams.get('config');
if (config) {
  firebase.initializeApp(JSON.parse(config));
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const title = payload.notification?.title || 'University Attendance';
    const options = {
      body: payload.notification?.body || 'You have a new announcement.',
      icon: '/favicon.ico',
      data: { url: payload.data?.url || '/portal?view=announcements' },
    };
    self.registration.showNotification(title, options);
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/portal?view=announcements', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const matching = clients.find(client => client.url === target);
    if (matching) return matching.focus();
    return self.clients.openWindow(target);
  }));
});
