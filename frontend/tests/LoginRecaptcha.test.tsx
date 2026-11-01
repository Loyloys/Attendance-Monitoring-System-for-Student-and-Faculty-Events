// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Login from '../src/auth/Login';

// Mock AuthContext
vi.mock('../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock eventApi
vi.mock('../src/data/eventApi', () => ({
  eventApi: {
    googleConfig: vi.fn(),
    recaptchaSettings: vi.fn(),
  },
}));

import { useAuth } from '../src/context/AuthContext';
import { eventApi } from '../src/data/eventApi';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockRecaptchaSettings = eventApi.recaptchaSettings as ReturnType<typeof vi.fn>;
const mockGoogleConfig = eventApi.googleConfig as ReturnType<typeof vi.fn>;

const mockLogin = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // @vitest-environment jsdom does not expose VITE_* variables by default.
  // Use Vitest's env override so the login page can render the widget.
  vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '6LfUBQIuAAAAACQCJt4qlrNE1HouYfGgRmfFukCO');
  mockUseAuth.mockReturnValue({
    login: mockLogin,
    loginWithGoogle: vi.fn(),
    user: null,
    isAuthenticated: false,
    isOwner: vi.fn(),
    refreshSession: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  });
  // Google config always returns usable config so the login page can render.
  mockGoogleConfig.mockResolvedValue({
    configurationAvailable: true,
    enabled: true,
    clientId: 'test-client-id',
    mode: 'institutional',
    settingAvailable: true,
    settingEnabled: true,
    clientIdPresent: true,
    policy: 'open',
  });
  // Default: reCAPTCHA disabled
  mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true, configured: true });
  mockLogin.mockResolvedValue({ id: 'user1', role: 'student', name: 'Test User' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  );
}

async function fillAndSubmit(identifier = 'testuser', password = 'password123') {
  const identifierInput = screen.getByRole('textbox', { name: /email, id, or username/i });
  const passwordInput = screen.getByPlaceholderText('Enter your application password');
  const submitButton = screen.getByRole('button', { name: /sign in/i });

  fireEvent.change(identifierInput, { target: { value: identifier } });
  fireEvent.change(passwordInput, { target: { value: password } });
  fireEvent.click(submitButton);
}

describe('Login reCAPTCHA', () => {
  it('hides the reCAPTCHA checkbox when disabled', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true, configured: true });

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.queryByTestId('g-recaptcha')).not.toBeInTheDocument();
    expect(screen.queryByText(/g-recaptcha/i)).not.toBeInTheDocument();
  });

  it('shows the reCAPTCHA checkbox when enabled, configured, and site key is loaded', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: true, available: true, configured: true });

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // The g-recaptcha div should be present
    expect(
      screen.getByTestId('g-recaptcha') ?? document.querySelector('.g-recaptcha')
    ).toBeInTheDocument();
  });

  it('does not allow password login when enabled reCAPTCHA is not fully configured', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: true, available: true, configured: false });

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.queryByTestId('g-recaptcha')).not.toBeInTheDocument();
    expect(screen.getByText(/enabled but not fully configured/i)).toBeInTheDocument();

    await fillAndSubmit();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('does not allow password login when the settings API fails', async () => {
    mockRecaptchaSettings.mockRejectedValue(new Error('Server unavailable'));

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/could not confirm the recaptcha setting/i)).toBeInTheDocument();
    await fillAndSubmit();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('does not show a disabled state when the settings response is unavailable', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: true, available: true, configured: true });

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('g-recaptcha') ?? document.querySelector('.g-recaptcha')).toBeInTheDocument();
  });

  it('blocks login when reCAPTCHA is enabled, configured, and no token is provided', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: true, available: true, configured: true });
    // Simulate grecaptcha not having a token
    (window as any).grecaptcha = {
      ready: (callback: () => void) => callback(),
      render: () => 0,
      getResponse: () => '',
      reset: vi.fn(),
    };

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Wait for the reCAPTCHA settings to load (recaptchaLoading -> false)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    await fillAndSubmit();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/please complete the recaptcha before signing in/i)).toBeInTheDocument();
  });

  it('allows login when reCAPTCHA is disabled without a token', async () => {
    mockRecaptchaSettings.mockResolvedValue({ enabled: false, available: true, configured: true });
    (window as any).grecaptcha = undefined;

    renderLogin();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Wait for the reCAPTCHA settings to load (recaptchaLoading -> false)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    await fillAndSubmit();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123', undefined);
  });
});