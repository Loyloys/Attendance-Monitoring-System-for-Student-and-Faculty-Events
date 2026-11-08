// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PushNotificationControl from '../src/components/event/PushNotificationControl';

vi.mock('../src/data/eventApi', () => ({
  eventApi: {
    pushNotificationStatus: vi.fn(),
    registerPushDevice: vi.fn(),
    unregisterPushDevice: vi.fn(),
  },
}));

vi.mock('../src/data/pushNotifications', () => ({
  pushNotificationsConfigured: vi.fn(),
  pushNotificationsSupported: vi.fn(),
  getPushToken: vi.fn(),
  deletePushToken: vi.fn(),
  listenForPushMessages: vi.fn(() => vi.fn()),
}));

import { eventApi } from '../src/data/eventApi';
import { deletePushToken, getPushToken, pushNotificationsConfigured, pushNotificationsSupported } from '../src/data/pushNotifications';

const mockPushStatus = eventApi.pushNotificationStatus as ReturnType<typeof vi.fn>;
const mockRegister = eventApi.registerPushDevice as ReturnType<typeof vi.fn>;
const mockUnregister = eventApi.unregisterPushDevice as ReturnType<typeof vi.fn>;
const mockSupported = pushNotificationsSupported as ReturnType<typeof vi.fn>;
const mockWebConfigConfigured = pushNotificationsConfigured as ReturnType<typeof vi.fn>;
const mockGetToken = getPushToken as ReturnType<typeof vi.fn>;
const mockDeleteToken = deletePushToken as ReturnType<typeof vi.fn>;

class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  onclick: (() => void) | null = null;

  constructor() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Notification', MockNotification);
  MockNotification.permission = 'default';
  MockNotification.requestPermission.mockResolvedValue('granted');
  mockSupported.mockResolvedValue(true);
  mockWebConfigConfigured.mockResolvedValue(true);
  mockPushStatus.mockResolvedValue({ configured: true, enabled: true, available: true });
  mockGetToken.mockResolvedValue('browser-fcm-token-1234567890');
  mockRegister.mockResolvedValue({ registered: true });
  mockUnregister.mockResolvedValue({ registered: false });
  mockDeleteToken.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe('PushNotificationControl', () => {
  it('lets an opted-in user enable push notifications', async () => {
    render(<PushNotificationControl />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    await settle();

    expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
    expect(mockRegister).toHaveBeenCalledWith('browser-fcm-token-1234567890');
    expect(screen.getByText(/browser is registered for announcement notifications/)).toBeInTheDocument();
  });

  it('unregisters and deletes the browser token when opting out', async () => {
    MockNotification.permission = 'granted';
    render(<PushNotificationControl />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off notifications' }));
    await settle();

    expect(mockUnregister).toHaveBeenCalledWith('browser-fcm-token-1234567890');
    expect(mockDeleteToken).toHaveBeenCalledOnce();
    expect(screen.getByText(/Push notifications were disabled/)).toBeInTheDocument();
  });

  it('explains that setup is needed when backend FCM credentials are missing', async () => {
    mockPushStatus.mockResolvedValue({ configured: false, enabled: true, available: true });
    render(<PushNotificationControl />);
    await settle();
    expect(screen.getByText(/Firebase Admin credentials or the token-encryption key are missing/)).toBeInTheDocument();
  });

  it('explains that Firebase web configuration must be set up before browser support checks', async () => {
    mockPushStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      available: true,
      firebaseWebConfig: null,
    });
    mockWebConfigConfigured.mockResolvedValue(false);
    render(<PushNotificationControl />);
    await settle();
    expect(screen.getByText(/Firebase browser configuration is incomplete/)).toBeInTheDocument();
    expect(mockSupported).not.toHaveBeenCalled();
  });

  it('explains when an administrator has disabled push notifications', async () => {
    mockPushStatus.mockResolvedValue({ configured: true, enabled: false, available: true });
    render(<PushNotificationControl />);
    await settle();
    expect(screen.getByText(/disabled by an administrator/)).toBeInTheDocument();
  });
});
