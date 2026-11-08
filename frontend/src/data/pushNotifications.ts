import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export async function pushNotificationsSupported() {
  return Boolean(
    firebaseConfig.apiKey
    && firebaseConfig.projectId
    && firebaseConfig.messagingSenderId
    && firebaseConfig.appId
    && vapidKey
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && await isSupported(),
  );
}

function firebaseApp() {
  const existing = getApps().find(app => app.name === 'attendance-push');
  return existing || initializeApp(firebaseConfig, 'attendance-push');
}

export async function getPushToken() {
  if (!await pushNotificationsSupported()) throw new Error('This browser or deployment is not configured for push notifications.');
  const config = encodeURIComponent(JSON.stringify(firebaseConfig));
  const serviceWorker = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?config=${config}`);
  const messaging = getMessaging(firebaseApp());
  return getToken(messaging, { vapidKey, serviceWorkerRegistration: serviceWorker });
}

export function deletePushToken() {
  return deleteToken(getMessaging(firebaseApp()));
}

export function listenForPushMessages(onNotification: (payload: MessagePayload) => void) {
  return onMessage(getMessaging(firebaseApp()), onNotification);
}
