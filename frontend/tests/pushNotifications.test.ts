// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApps, mockGetToken, mockInitializeApp, mockRegisterServiceWorker, mockPushNotificationStatus, mockIsSupported } = vi.hoisted(() => ({
  mockApps: [] as { name: string; options: Record<string, string> }[],
  mockGetToken: vi.fn(),
  mockInitializeApp: vi.fn(),
  mockRegisterServiceWorker: vi.fn(),
  mockPushNotificationStatus: vi.fn(),
  mockIsSupported: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  getApps: () => mockApps,
  initializeApp: (options: Record<string, string>, name: string) => {
    mockInitializeApp(options, name);
    const app = { name, options };
    mockApps.push(app);
    return app;
  },
  deleteApp: async (app: { name: string }) => {
    const index = mockApps.findIndex(candidate => candidate.name === app.name);
    if (index >= 0) mockApps.splice(index, 1);
  },
}));

vi.mock('firebase/messaging', () => ({
  deleteToken: vi.fn(),
  getMessaging: vi.fn(() => ({})),
  getToken: mockGetToken,
  isSupported: mockIsSupported,
  onMessage: vi.fn(),
}));

vi.mock('../src/data/eventApi', () => ({
  eventApi: { pushNotificationStatus: mockPushNotificationStatus },
}));

import { getPushToken } from '../src/data/pushNotifications';

const firebaseWebConfig = {
  apiKey: 'AIzaSyTestFirebaseWebApiKey000000000',
  authDomain: 'attendance-test.firebaseapp.com',
  projectId: 'attendance-test',
  storageBucket: 'attendance-test.firebasestorage.app',
  messagingSenderId: '696332399690',
  appId: '1:696332399690:web:ccd6602a07a1978b4422b3',
  vapidKey: 'public-vapid-key-for-browser-tests-1234567890',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApps.length = 0;
  for (const key of [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_VAPID_KEY',
  ]) vi.stubEnv(key, '');
  mockPushNotificationStatus.mockResolvedValue({ firebaseWebConfig, enabled: true, available: true, configured: true });
  mockGetToken.mockResolvedValue('generated-browser-token');
  mockIsSupported.mockResolvedValue(true);
  mockRegisterServiceWorker.mockResolvedValue({});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: mockRegisterServiceWorker },
  });
  vi.stubGlobal('Notification', class {});
  Object.defineProperty(window, 'Notification', { configurable: true, value: class {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Firebase browser push initialization', () => {
  it('initializes the SDK and service worker using saved public web settings and VAPID key', async () => {
    const token = await getPushToken();
    expect(token).toBe('generated-browser-token');
    expect(mockPushNotificationStatus).toHaveBeenCalledOnce();
    expect(mockInitializeApp).toHaveBeenCalledWith({
      apiKey: firebaseWebConfig.apiKey,
      authDomain: firebaseWebConfig.authDomain,
      projectId: firebaseWebConfig.projectId,
      storageBucket: firebaseWebConfig.storageBucket,
      messagingSenderId: firebaseWebConfig.messagingSenderId,
      appId: firebaseWebConfig.appId,
    }, 'attendance-push');
    const workerUrl = new URL(mockRegisterServiceWorker.mock.calls[0][0], 'https://attendance.test');
    expect(JSON.parse(workerUrl.searchParams.get('config') || '{}')).toEqual({
      apiKey: firebaseWebConfig.apiKey,
      authDomain: firebaseWebConfig.authDomain,
      projectId: firebaseWebConfig.projectId,
      storageBucket: firebaseWebConfig.storageBucket,
      messagingSenderId: firebaseWebConfig.messagingSenderId,
      appId: firebaseWebConfig.appId,
    });
    expect(mockGetToken).toHaveBeenCalledWith({}, {
      vapidKey: firebaseWebConfig.vapidKey,
      serviceWorkerRegistration: {},
    });
  });

  it('reports a clear setup error when public web configuration is incomplete', async () => {
    mockPushNotificationStatus.mockResolvedValue({
      firebaseWebConfig: {
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
        vapidKey: '',
      },
      enabled: true,
      available: true,
      configured: true,
    });
    await expect(getPushToken()).rejects.toThrow(/configure Cloud Messaging in Admin Settings/);
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });
});
