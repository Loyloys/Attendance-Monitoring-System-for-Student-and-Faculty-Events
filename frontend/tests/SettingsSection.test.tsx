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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: settings available and disabled
  mockGoogleOAuthSettings.mockResolvedValue({ enabled: false, available: true, clientId: '1234567890-test.apps.googleusercontent.com' });
  mockGoogleConfig.mockResolvedValue({ configurationAvailable: true, enabled: true, clientId: 'test-client-id', mode: 'institutional', settingAvailable: true, settingEnabled: true, clientIdPresent: true, policy: 'open' });
  mockUpdateGoogleOAuthSettings.mockResolvedValue({ enabled: false, available: true });
  mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true, configured: true });
  mockUpdateRecaptchaSettings.mockResolvedValue({ enabled: false, available: true });
  mockMapPickerSettings.mockResolvedValue({ enabled: false, available: true });
  mockUpdateMapPickerSettings.mockResolvedValue({ enabled: false, available: true });
  mockGoogleCalendarStatus.mockResolvedValue({ configured: true, connected: false, enabled: true, settingAvailable: true, missing: [] });
  mockUpdateGoogleCalendarSettings.mockResolvedValue({ enabled: false, available: true });
  mockGoogleCalendarAuthorizeUrl.mockReturnValue('/api/auth/google/calendar/authorize/');
});

afterEach(() => {
  cleanup();
});

describe('SettingsSection', () => {
  it('loads and displays all settings including Google Calendar', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: true, available: true, configured: true });
    mockMapPickerSettings.mockResolvedValue({ enabled: true, available: true });

    render(<SettingsSection />);

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
    render(<SettingsSection />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const calendarCheckbox = screen.getByLabelText('Enable Google Calendar');
    fireEvent.click(calendarCheckbox);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleCalendarSettings).toHaveBeenCalledWith(false);
    expect(calendarCheckbox).not.toBeChecked();
    expect(screen.getByText(/tokens, and Calendar events were preserved/)).toBeInTheDocument();
  });

  it('saves the Google OAuth client ID from the settings card', async () => {
    render(<SettingsSection />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const clientIdInput = screen.getByLabelText('Google OAuth client ID');
    fireEvent.change(clientIdInput, { target: { value: '9876543210-new.apps.googleusercontent.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save client ID' })[0]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleOAuthSettings).toHaveBeenCalledWith(false, '9876543210-new.apps.googleusercontent.com');
  });

  it('saves the Calendar client ID through the shared Google OAuth setting', async () => {
    render(<SettingsSection />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const clientIdInput = screen.getByLabelText('Google Calendar client ID');
    fireEvent.change(clientIdInput, { target: { value: '9876543210-calendar.apps.googleusercontent.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save client ID' })[1]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateGoogleOAuthSettings).toHaveBeenCalledWith(false, '9876543210-calendar.apps.googleusercontent.com');
  });

  it('saves reCAPTCHA enabled state', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true });
    mockUpdateRecaptchaSettings.mockResolvedValue({ enabled: true, available: true });

    render(<SettingsSection />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const recaptchaCheckbox = screen.getByLabelText('Enable reCAPTCHA on login');
    expect(recaptchaCheckbox).not.toBeChecked();

    fireEvent.click(recaptchaCheckbox);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockUpdateRecaptchaSettings).toHaveBeenCalledWith(true, import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '');
    expect(recaptchaCheckbox).toBeChecked();
  });

  it('saves the reCAPTCHA site key', async () => {
    render(<SettingsSection />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const siteKeyInput = screen.getByLabelText('reCAPTCHA site key');
    fireEvent.change(siteKeyInput, { target: { value: 'test-public-site-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save site key' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockUpdateRecaptchaSettings).toHaveBeenCalledWith(false, 'test-public-site-key');
    expect(screen.getByRole('status')).toHaveTextContent('reCAPTCHA site key saved.');
  });

  it('disables reCAPTCHA checkbox when backend keys missing', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: false });

    render(<SettingsSection />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const recaptchaCheckbox = screen.getByLabelText('Enable reCAPTCHA on login');
    expect(recaptchaCheckbox).toBeDisabled();
  });

  it('saves map picker enabled state', async () => {
    mockMapPickerSettings.mockResolvedValue({ enabled: false, available: true });
    mockUpdateMapPickerSettings.mockResolvedValue({ enabled: true, available: true });

    render(<SettingsSection />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const mapPickerCheckbox = screen.getByLabelText('Enable venue map picker');
    expect(mapPickerCheckbox).not.toBeChecked();

    fireEvent.click(mapPickerCheckbox);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockUpdateMapPickerSettings).toHaveBeenCalledWith(true);
    expect(mapPickerCheckbox).toBeChecked();
  });

  it('shows error state when reCAPTCHA load fails', async () => {
    mockRecaptchaSettings.mockRejectedValue(new Error('Server unavailable'));

    render(<SettingsSection />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/Server unavailable/)).toBeInTheDocument();
  });
});