import type { FirebaseWebConfig } from './eventApi';

const firebaseWebConfigFields = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'vapidKey',
] as const satisfies readonly (keyof FirebaseWebConfig)[];
const firebaseWebConfigLabels: Record<keyof FirebaseWebConfig, string> = {
  apiKey: 'Web API key',
  authDomain: 'auth domain',
  projectId: 'project ID',
  storageBucket: 'storage bucket',
  messagingSenderId: 'messaging sender ID',
  appId: 'web app ID',
  vapidKey: 'VAPID public key',
};

export function serializeFirebaseWebConfig(config: FirebaseWebConfig) {
  return JSON.stringify(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJavaScriptConfig(input: string) {
  if (!input.includes('{') || !input.includes('}')) {
    throw new Error('Paste the Firebase web configuration object and include a vapidKey value.');
  }
  const parsed: Record<string, string> = {};
  for (const field of firebaseWebConfigFields) {
    const expression = new RegExp(`(?:["']?${field}["']?)\\s*:\\s*(["'])([^"'\\r\\n]*)\\1`);
    const match = input.match(expression);
    if (match) parsed[field] = match[2];
  }
  return parsed;
}

function validateFirebaseWebConfig(config: Record<string, unknown>): FirebaseWebConfig {
  const values = {} as FirebaseWebConfig;
  for (const field of firebaseWebConfigFields) {
    const value = config[field];
    if (field === 'authDomain' || field === 'storageBucket') {
      if (value === undefined || value === '') {
        values[field] = '';
        continue;
      }
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`The Firebase Web Configuration is missing the ${firebaseWebConfigLabels[field]}. Include it in the pasted config.`);
    }
    values[field] = value.trim();
  }

  if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(values.apiKey)) throw new Error('The Firebase Web API key is invalid.');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(values.vapidKey)) {
    throw new Error('The VAPID public key is missing or invalid. Add it as "vapidKey" in the config object.');
  }
  if (!/^[a-z0-9][a-z0-9-]{5,29}$/.test(values.projectId)) throw new Error('The Firebase project ID is invalid.');
  if (!/^\d+$/.test(values.messagingSenderId)) throw new Error('The Firebase messaging sender ID must contain only digits.');
  if ((values.authDomain && !/^[A-Za-z0-9.-]+$/.test(values.authDomain))
    || (values.storageBucket && !/^[A-Za-z0-9.-]+$/.test(values.storageBucket))) {
    throw new Error('The Firebase auth domain or storage bucket is invalid.');
  }
  if (!new RegExp(`^\\d+:${values.messagingSenderId}:web:[A-Za-z0-9]+$`).test(values.appId)) {
    throw new Error('The Firebase web app ID is invalid or does not match the messaging sender ID.');
  }
  return values;
}

export function parseFirebaseWebConfig(input: string): FirebaseWebConfig {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Paste your Firebase web configuration and VAPID public key.');
  }
  if (/\b(private_key|client_email|service_account|FCM_TOKEN_ENCRYPTION_KEY|privateKey)\b/i.test(input)) {
    throw new Error('Do not paste Firebase service-account credentials, private keys, or encryption keys here. Use only public web config and the VAPID public key.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    parsed = readJavaScriptConfig(input);
  }
  if (!isRecord(parsed)) throw new Error('Paste a Firebase web configuration object.');

  return validateFirebaseWebConfig(parsed);
}
