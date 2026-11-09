// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsSection from '../src/pages/admin/SettingsSection';

// Mock the eventApi settings methods
vi.mock('../src/data/eventApi', () => ({
  eventApi: {
    googleOAuthSettings: vi.fn(),
    googleConfig: vi.fn(),
    updateGoogleOAuthSettings: vi.fn(),
    recaptchaSettings: vi.fn(),
    updateRecaptchaSettings: vi.fn(),
    mapPickerSettings: vi.fn(),
    updateMapPickerSettings: vi.fn(),
    googleCalendarStatus: vi.fn(),
    googleCalendarSettings: vi.fn(),
    updateGoogleCalendarSettings: vi.fn(),
    googleCalendarAuthorizeUrl: vi.fn(),
    pushNotificationSettings: vi.fn(),
    updatePushNotificationSettings: vi.fn(),
    saveFirebaseWebConfig: vi.fn(),
    resetFirebaseWebConfig: vi.fn(),
    verifyAdminSettingsPin: vi.fn(),
    sendAdminSettingsEmailCode: vi.fn(),
    verifyAdminSettingsEmailCode: vi.fn(),
  },
}));

import { eventApi } from '../src/data/eventApi';

const mockGoogleOAuthSettings = eventApi.googleOAuthSettings as ReturnType<typeof vi.fn>;
const mockGoogleConfig = eventApi.googleConfig as ReturnType<typeof vi.fn>;
const mockUpdateGoogleOAuthSettings = eventApi.updateGoogleOAuthSettings as ReturnType<typeof vi.fn>;
const mockRecaptchaSettings = eventApi.recaptchaSettings as ReturnType<typeof vi.fn>;
const mockUpdateRecaptchaSettings = eventApi.updateRecaptchaSettings as ReturnType<typeof vi.fn>;
const mockMapPickerSettings = eventApi.mapPickerSettings as ReturnType<typeof vi.fn>;
const mockUpdateMapPickerSettings = eventApi.updateMapPickerSettings as ReturnType<typeof vi.fn>;
const mockGoogleCalendarStatus = eventApi.googleCalendarStatus as ReturnType<typeof vi.fn>;
const mockGoogleCalendarAuthorizeUrl = eventApi.googleCalendarAuthorizeUrl as ReturnType<typeof vi.fn>;
const mockUpdateGoogleCalendarSettings = eventApi.updateGoogleCalendarSettings as ReturnType<typeof vi.fn>;
const mockPushNotificationSettings = eventApi.pushNotificationSettings as ReturnType<typeof vi.fn>;
const mockUpdatePushNotificationSettings = eventApi.updatePushNotificationSettings as ReturnType<typeof vi.fn>;
const mockSaveFirebaseWebConfig = eventApi.saveFirebaseWebConfig as ReturnType<typeof vi.fn>;
const mockResetFirebaseWebConfig = eventApi.resetFirebaseWebConfig as ReturnType<typeof vi.fn>;
const mockVerifyAdminSettingsPin = eventApi.verifyAdminSettingsPin as ReturnType<typeof vi.fn>;
const mockSendAdminSettingsEmailCode = eventApi.sendAdminSettingsEmailCode as ReturnType<typeof vi.fn>;
const mockVerifyAdminSettingsEmailCode = eventApi.verifyAdminSettingsEmailCode as ReturnType<typeof vi.fn>;

const firebaseWebConfig = {
  apiKey: 'AIzaSyTestFirebaseWebApiKey000000000',
  authDomain: 'attendance-test.firebaseapp.com',
  projectId: 'attendance-test',
  storageBucket: 'attendance-test.firebasestorage.app',
  messagingSenderId: '696332399690',
  appId: '1:696332399690:web:ccd6602a07a1978b4422b3',
  vapidKey: 'BFDmIchOfLp8j3oZ6drOef3so9oilBl8N8gMlHTdtizj9GTT9e8BMHuBy_mMpg8b2NtwisdIsFJZ6nNZW-aaNVQ',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyAdminSettingsPin.mockResolvedValue({ verified: true });
  mockSendAdminSettingsEmailCode.mockResolvedValue({ sent: true });
  mockVerifyAdminSettingsEmailCode.mockResolvedValue({ verified: true });
  // Default: settings available and disabled
  mockGoogleOAuthSettings.mockResolvedValue({ enabled: false, available: true, clientId: '1234567890-test.apps.googleusercontent.com' });
  mockGoogleConfig.mockResolvedValue({ configurationAvailable: true, enabled: true, clientId: 'test-client-id', mode: 'institutional', settingAvailable: true, settingEnabled: true, clientIdPresent: true, policy: 'open' });
  mockUpdateGoogleOAuthSettings.mockResolvedValue({ enabled: false, available: true });
  mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true, configured: true });
  mockUpdateRecaptchaSettings.mockResolvedValue({ enabled: false, available: true });
  mockMapPickerSettings.mockResolvedValue({ enabled: false, available: true, tileProviderKeyConfigured: false });
  mockUpdateMapPickerSettings.mockImplementation(async (enabled: boolean, tileProviderApiKey?: string) => ({
    enabled,
    available: true,
    tileProviderKeyConfigured: Boolean(tileProviderApiKey),
  }));
  mockGoogleCalendarStatus.mockResolvedValue({ configured: true, connected: false, enabled: true, settingAvailable: true, missing: [] });
  mockUpdateGoogleCalendarSettings.mockResolvedValue({ enabled: false, available: true });
  mockGoogleCalendarAuthorizeUrl.mockReturnValue('/api/auth/google/calendar/authorize/');
  mockPushNotificationSettings.mockResolvedValue({
    enabled: false,
    available: true,
    configured: true,
    firebaseWebConfig: null,
    firebaseWebConfigConfigured: false,
    firebaseWebConfigAvailable: true,
  });
  mockUpdatePushNotificationSettings.mockImplementation(async (enabled: boolean) => ({ enabled, available: true, configured: true }));
  mockSaveFirebaseWebConfig.mockImplementation(async (config: typeof firebaseWebConfig) => ({
    enabled: false,
    available: true,
    configured: true,
    firebaseWebConfig: config,
    firebaseWebConfigConfigured: true,
    firebaseWebConfigAvailable: true,
  }));
  mockResetFirebaseWebConfig.mockResolvedValue({
    enabled: false,
    available: true,
    configured: true,
    firebaseWebConfig: null,
    firebaseWebConfigConfigured: false,
    firebaseWebConfigAvailable: true,
  });
});

afterEach(() => {
  cleanup();
});

async function renderSettings() {
  render(<SettingsSection />);
  expect(screen.queryByText('Google OAuth')).not.toBeInTheDocument();
  expect(mockGoogleOAuthSettings).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Settings PIN'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function approveSettingsChange() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  if (!screen.queryByRole('dialog')) return;
  fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '123456' } });
  fireEvent.submit(screen.getByRole('dialog'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe('SettingsSection', () => {
  it('requires the PIN before loading any settings', async () => {
    render(<SettingsSection />);
    expect(screen.getByLabelText('Settings PIN')).toBeInTheDocument();
    expect(mockGoogleOAuthSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Settings PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockVerifyAdminSettingsPin).toHaveBeenCalledWith('123456');
    expect(mockGoogleOAuthSettings).toHaveBeenCalledOnce();
  });

  it('requires email verification for PIN reset and keeps settings locked', async () => {
    mockVerifyAdminSettingsEmailCode.mockResolvedValue({
      verified: true,
      detail: 'Email verified. Set the new SU_PIN in the backend .env file and restart the backend.',
    });
    render(<SettingsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot or reset PIN?' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockSendAdminSettingsEmailCode).toHaveBeenCalledWith('pin_reset');
    fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('dialog'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockVerifyAdminSettingsEmailCode).toHaveBeenCalledWith('pin_reset', '123456');
    expect(screen.getByRole('status')).toHaveTextContent('Set the new SU_PIN');
    expect(screen.getByLabelText('Settings PIN')).toBeInTheDocument();
    expect(mockGoogleOAuthSettings).not.toHaveBeenCalled();
  });

  it('loads and displays all settings including Google Calendar', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: true, available: true, configured: true });
    mockMapPickerSettings.mockResolvedValue({ enabled: true, available: true });

    await renderSettings();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Google OAuth card
    expect(screen.getByText('Google OAuth')).toBeInTheDocument();
    // reCAPTCHA card
    expect(screen.getByText('reCAPTCHA on login')).toBeInTheDocument();
    // Map Picker card
    expect(screen.getByText('Leaflet venue map picker')).toBeInTheDocument();
    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText('Firebase Cloud Messaging')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable Firebase Cloud Messaging')).not.toBeChecked();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable Google Calendar')).toBeChecked();
    expect(screen.getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute(
      'href',
      '/api/auth/google/calendar/authorize/',
    );

    // reCAPTCHA checkbox should be checked when enabled
    const recaptchaCheckbox = screen.getByLabelText('Enable reCAPTCHA on login');
    expect(recaptchaCheckbox).toBeChecked();

    // Map Picker checkbox should be checked when enabled
    const mapPickerCheckbox = screen.getByLabelText('Enable venue map picker');
    expect(mapPickerCheckbox).toBeChecked();
  });

  it('persists the Admin Calendar enabled state without disconnecting it', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const calendarCheckbox = screen.getByLabelText('Enable Google Calendar');
    fireEvent.click(calendarCheckbox);
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleCalendarSettings).toHaveBeenCalledWith(false);
    expect(calendarCheckbox).not.toBeChecked();
    expect(screen.getByText(/tokens, and Calendar events were preserved/)).toBeInTheDocument();
  });

  it('enables and disables Firebase Cloud Messaging from settings', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const checkbox = screen.getByLabelText('Enable Firebase Cloud Messaging');
    fireEvent.click(checkbox);
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdatePushNotificationSettings).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/setting is enabled/)).toBeInTheDocument();

    fireEvent.click(checkbox);
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdatePushNotificationSettings).toHaveBeenLastCalledWith(false);
    expect(checkbox).not.toBeChecked();
  });

  it('saves masked Firebase web configuration and shows saved-state feedback', async () => {
    mockPushNotificationSettings.mockResolvedValue({
      enabled: false,
      available: true,
      configured: true,
      firebaseWebConfig,
      firebaseWebConfigConfigured: true,
      firebaseWebConfigAvailable: true,
    });
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const configInput = screen.getByLabelText('Firebase Web Configuration');
    expect(configInput).toHaveAttribute('type', 'password');
    fireEvent.change(configInput, { target: { value: JSON.stringify(firebaseWebConfig) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Firebase web configuration' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockSaveFirebaseWebConfig).toHaveBeenCalledWith(firebaseWebConfig);
    expect(screen.getByText(/Firebase web configuration saved/)).toBeInTheDocument();
    expect(screen.getByText(/Firebase web configuration is saved/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Firebase (Web API key|project ID|messaging sender ID)/)).not.toBeInTheDocument();
  });

  it('validates required Firebase web configuration before saving', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.change(screen.getByLabelText('Firebase Web Configuration'), { target: { value: '{"apiKey":"incomplete"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Firebase web configuration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The Firebase Web Configuration is missing the project ID.');
    expect(mockSaveFirebaseWebConfig).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Firebase Web Configuration'), { target: { value: '{"private_key":"not for the browser"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Firebase web configuration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not paste Firebase service-account credentials');
    expect(mockSaveFirebaseWebConfig).not.toHaveBeenCalled();
  });

  it('resets Firebase web configuration to the frontend defaults', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Firebase web configuration to default' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockResetFirebaseWebConfig).toHaveBeenCalledOnce();
    expect(screen.getByText(/Firebase web configuration reset/)).toBeInTheDocument();
  });

  it('saves the Google OAuth client ID from the settings card', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const clientIdInput = screen.getByLabelText('Google OAuth client ID');
    expect(clientIdInput).toHaveAttribute('type', 'password');
    fireEvent.change(clientIdInput, { target: { value: '9876543210-new.apps.googleusercontent.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save client ID' })[0]);
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleOAuthSettings).toHaveBeenCalledWith(false, '9876543210-new.apps.googleusercontent.com');
  });

  it('saves the Calendar client ID through the shared Google OAuth setting', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const clientIdInput = screen.getByLabelText('Google Calendar client ID');
    expect(clientIdInput).toHaveAttribute('type', 'password');
    fireEvent.change(clientIdInput, { target: { value: '9876543210-calendar.apps.googleusercontent.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save client ID' })[1]);
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleOAuthSettings).toHaveBeenCalledWith(false, '9876543210-calendar.apps.googleusercontent.com');
  });

  it('resets Google OAuth to disabled and the server client ID default', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Google OAuth to default' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleOAuthSettings).toHaveBeenCalledWith(false, '');
    expect(screen.getByLabelText('Enable Google OAuth')).not.toBeChecked();
    expect(screen.getByText(/Google OAuth was reset to defaults/)).toBeInTheDocument();
  });

  it('resets Google Calendar to enabled and the server client ID default', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Google Calendar to default' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await approveSettingsChange();
    expect(mockUpdateGoogleOAuthSettings).toHaveBeenCalledWith(false, '');
    expect(mockUpdateGoogleCalendarSettings).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText('Enable Google Calendar')).toBeChecked();
    expect(screen.getByText(/Google Calendar was reset to defaults/)).toBeInTheDocument();
  });

  it('saves reCAPTCHA enabled state', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true });
    mockUpdateRecaptchaSettings.mockResolvedValue({ enabled: true, available: true });

    await renderSettings();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const recaptchaCheckbox = screen.getByLabelText('Enable reCAPTCHA on login');
    expect(recaptchaCheckbox).not.toBeChecked();

    fireEvent.click(recaptchaCheckbox);
    await approveSettingsChange();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockUpdateRecaptchaSettings).toHaveBeenCalledWith(true, import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '');
    expect(recaptchaCheckbox).toBeChecked();
  });

  it('saves the reCAPTCHA site key', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const siteKeyInput = screen.getByLabelText('reCAPTCHA site key');
    fireEvent.change(siteKeyInput, { target: { value: 'test-public-site-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save site key' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateRecaptchaSettings).toHaveBeenCalledWith(false, 'test-public-site-key');
    expect(screen.getByRole('status')).toHaveTextContent('reCAPTCHA site key saved.');
  });

  it('resets reCAPTCHA to disabled and frontend site-key defaults', async () => {
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.getByLabelText('reCAPTCHA site key')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Reset reCAPTCHA to default' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateRecaptchaSettings).toHaveBeenCalledWith(false, '');
    expect(screen.getByLabelText('Enable reCAPTCHA on login')).not.toBeChecked();
    expect(screen.getByText(/reCAPTCHA was reset to defaults/)).toBeInTheDocument();
  });

  it('disables reCAPTCHA checkbox when backend keys missing', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: false });

    await renderSettings();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const recaptchaCheckbox = screen.getByLabelText('Enable reCAPTCHA on login');
    expect(recaptchaCheckbox).toBeDisabled();
  });

  it('saves map picker enabled state', async () => {
    mockMapPickerSettings.mockResolvedValue({ enabled: false, available: true });
    mockUpdateMapPickerSettings.mockResolvedValue({ enabled: true, available: true });

    await renderSettings();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const mapPickerCheckbox = screen.getByLabelText('Enable venue map picker');
    expect(mapPickerCheckbox).not.toBeChecked();

    fireEvent.click(mapPickerCheckbox);
    await approveSettingsChange();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockUpdateMapPickerSettings).toHaveBeenCalledWith(true);
    expect(mapPickerCheckbox).toBeChecked();
  });

  it('resets the venue map picker to its hidden default', async () => {
    mockMapPickerSettings.mockResolvedValue({ enabled: true, available: true });
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Reset venue map picker to default' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateMapPickerSettings).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Enable venue map picker')).not.toBeChecked();
    expect(screen.getByText(/Venue map picker was reset to its default hidden state/)).toBeInTheDocument();
  });

  it('saves a masked tile provider key without loading the saved value back', async () => {
    mockMapPickerSettings.mockResolvedValue({ enabled: true, available: true, tileProviderKeyConfigured: true });
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    const apiKeyInput = screen.getByLabelText('Tile provider API key');
    expect(apiKeyInput).toHaveAttribute('type', 'password');
    expect(apiKeyInput).toHaveValue('');
    fireEvent.change(apiKeyInput, { target: { value: 'test-map-provider-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tile provider key' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(mockUpdateMapPickerSettings).toHaveBeenCalledWith(true, 'test-map-provider-key');
    expect(apiKeyInput).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Tile provider API key saved securely.');
  });

  it('shows an error when the tile provider key cannot be saved', async () => {
    mockUpdateMapPickerSettings.mockRejectedValue(new Error('Secure key storage is unavailable.'));
    await renderSettings();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const apiKeyInput = screen.getByLabelText('Tile provider API key');
    fireEvent.change(apiKeyInput, { target: { value: 'test-map-provider-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tile provider key' }));
    await approveSettingsChange();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(screen.getByRole('alert')).toHaveTextContent('Secure key storage is unavailable.');
    expect(apiKeyInput).toHaveValue('test-map-provider-key');
  });

  it('shows error state when reCAPTCHA load fails', async () => {
    mockRecaptchaSettings.mockRejectedValue(new Error('Server unavailable'));

    await renderSettings();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/Server unavailable/)).toBeInTheDocument();
  });
});