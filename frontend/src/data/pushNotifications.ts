import { deleteApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { eventApi, type FirebaseWebConfig } from './eventApi';

const defaultWebConfig: FirebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || '',
};

let activeFirebaseApp: FirebaseApp | null = null;

async function loadWebConfig(webConfig?: FirebaseWebConfig | null) {
  const savedConfig = webConfig === undefined
    ? (await eventApi.pushNotificationStatus()).firebaseWebConfig
    : webConfig;
  const resolved = { ...defaultWebConfig, ...savedConfig };
  const firebaseOptions: FirebaseOptions = {
    apiKey: resolved.apiKey,
    projectId: resolved.projectId,
    messagingSenderId: resolved.messagingSenderId,
    appId: resolved.appId,
    ...(resolved.authDomain ? { authDomain: resolved.authDomain } : {}),
    ...(resolved.storageBucket ? { storageBucket: resolved.storageBucket } : {}),
  };
  return { firebaseOptions, vapidKey: resolved.vapidKey, webConfig: resolved };
}

function isComplete({ firebaseOptions, vapidKey }: Awaited<ReturnType<typeof loadWebConfig>>) {
  return Boolean(
    firebaseOptions.apiKey
    && firebaseOptions.projectId
    && firebaseOptions.messagingSenderId
    && firebaseOptions.appId
    && vapidKey,
  );
}

export async function pushNotificationsConfigured(webConfig?: FirebaseWebConfig | null) {
  return isComplete(await loadWebConfig(webConfig));
}

export async function pushNotificationsSupported(webConfig?: FirebaseWebConfig | null) {
  const config = await loadWebConfig(webConfig);
  return Boolean(
    isComplete(config)
    && typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && await isSupported(),
  );
}

async function firebaseApp(config: FirebaseOptions) {
  const existing = getApps().find(app => app.name === 'attendance-push');
  if (existing
    && existing.options.apiKey === config.apiKey
    && existing.options.authDomain === config.authDomain
    && existing.options.projectId === config.projectId
    && existing.options.storageBucket === config.storageBucket
    && existing.options.messagingSenderId === config.messagingSenderId
    && existing.options.appId === config.appId) {
    activeFirebaseApp = existing;
    return existing;
  }
  if (existing) await deleteApp(existing);
  activeFirebaseApp = initializeApp(config, 'attendance-push');
  return activeFirebaseApp;
}

export async function getPushToken(webConfig?: FirebaseWebConfig | null) {
  const config = await loadWebConfig(webConfig);
  if (!isComplete(config) || !await pushNotificationsSupported(config.webConfig)) {
    throw new Error('Firebase web configuration is incomplete. Ask an administrator to configure Cloud Messaging in Admin Settings.');
  }
  const { firebaseOptions, vapidKey } = config;
  const serializedConfig = encodeURIComponent(JSON.stringify(firebaseOptions));
  const serviceWorker = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?config=${serializedConfig}`);
  const messaging = getMessaging(await firebaseApp(firebaseOptions));
  return getToken(messaging, { vapidKey, serviceWorkerRegistration: serviceWorker });
}

export async function deletePushToken() {
  if (!activeFirebaseApp) {
    const config = await loadWebConfig();
    if (!isComplete(config)) throw new Error('Firebase web configuration is incomplete.');
    await firebaseApp(config.firebaseOptions);
  }
  const app = activeFirebaseApp;
  if (!app) throw new Error('Firebase Messaging has not been initialized in this browser.');
  return deleteToken(getMessaging(app));
}

export function listenForPushMessages(onNotification: (payload: MessagePayload) => void) {
  if (!activeFirebaseApp) throw new Error('Firebase Messaging has not been initialized in this browser.');
  return onMessage(getMessaging(activeFirebaseApp), onNotification);
}
