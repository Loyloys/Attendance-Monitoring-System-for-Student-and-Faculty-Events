import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthService } from '../data/authService';
import { eventApi } from '../data/eventApi';
import type { GoogleSignInMode } from '../data/eventApi';
import GoogleSignInButton from './GoogleSignInButton';

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [google, setGoogle] = useState<{ clientId: string; nonce: string } | null>(null);
  const [googleState, setGoogleState] = useState<'checking' | 'idle' | 'working' | 'unavailable' | 'error'>('checking');
  const [googleNotice, setGoogleNotice] = useState('');
  // What the server is actually enforcing. The card is labelled from this value
  // alone, so it can never describe the private test list as an institutional
  // restriction, or vice versa.
  const [googleMode, setGoogleMode] = useState<GoogleSignInMode>('unavailable');
  const [recaptchaState, setRecaptchaState] = useState<'loading' | 'disabled' | 'enabled' | 'error'>('loading');
  const [recaptchaError, setRecaptchaError] = useState('');
  const recaptchaWidgetRef = useRef<HTMLDivElement>(null);
  const recaptchaWidgetId = useRef<number | null>(null);
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  // The client id and single-use nonce both come from the backend so the button
  // cannot be configured with an audience that the server would reject.
  useEffect(() => {
    let active = true;
    AuthService.googleConfig()
      .then(config => {
        if (!active) return;
        setGoogleMode(config.mode ?? (config.enabled ? 'institutional' : 'unavailable'));
        if (!config.settingAvailable) {
          setGoogleState('unavailable');
          setGoogleNotice('Google sign-in status could not be read from the server. You can still sign in below with your application password.');
          return;
        }
        if (!config.settingEnabled) {
          setGoogleState('unavailable');
          setGoogleNotice('Google sign-in is disabled in Admin settings. An authorized Admin can enable it under Settings > Google OAuth.');
          return;
        }
        if (!config.configurationAvailable) {
          setGoogleState('unavailable');
          if (!config.clientIdPresent) {
            setGoogleNotice('Google sign-in is not configured on the backend. The operator must configure GOOGLE_CLIENT_ID before it can be enabled.');
          } else if (config.policy === 'off') {
            setGoogleNotice('Google sign-in is disabled by the backend access policy. The operator must configure GOOGLE_ACCESS_POLICY before it can be enabled.');
          } else {
            setGoogleNotice('Google sign-in backend configuration is incomplete. The operator must check GOOGLE_ACCESS_POLICY and its required policy-specific settings.');
          }
          return;
        }
        if (!config.enabled || !config.clientId) {
          setGoogleState('error');
          setGoogleNotice('The server returned inconsistent Google sign-in configuration. You can still sign in below with your application password.');
          return;
        }
        return AuthService.googleSession().then(session => {
          if (!active || !session.enabled || !session.nonce) {
            if (active) {
              setGoogleState('unavailable');
              setGoogleNotice(session.settingAvailable && !session.settingEnabled
                ? 'Google sign-in is disabled in Admin settings. An authorized Admin can enable it under Settings > Google OAuth.'
                : 'Google sign-in could not be prepared by the server. You can still sign in below with your application password.');
            }
            return;
          }
          if (session.mode) setGoogleMode(session.mode);
          if (!session.clientId) {
            setGoogleState('error');
            setGoogleNotice('The backend did not provide its configured Google client ID. You can still sign in below with your application password.');
            return;
          }
          setGoogle({ clientId: session.clientId, nonce: session.nonce });
          setGoogleState('idle');
        });
      })
      .catch(() => {
        if (!active) return;
        setGoogleState('error');
        setGoogleNotice('Could not check Google sign-in availability because the server did not respond. You can still sign in below with your application password.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (recaptchaState !== 'enabled') return;

    const renderWidget = () => {
      const grecaptcha = (window as any).grecaptcha;
      if (!grecaptcha?.ready || !grecaptcha.render || !recaptchaWidgetRef.current || recaptchaWidgetId.current !== null) return;
      grecaptcha.ready(() => {
        if (recaptchaWidgetRef.current && recaptchaWidgetId.current === null) {
          recaptchaWidgetId.current = grecaptcha.render(recaptchaWidgetRef.current, {
            sitekey: import.meta.env.VITE_RECAPTCHA_SITE_KEY,
          });
        }
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-recaptcha-script], script[src*="google.com/recaptcha/api.js"]');
    const retry = window.setInterval(renderWidget, 100);
    if (existingScript) {
      renderWidget();
      existingScript.addEventListener('load', renderWidget, { once: true });
      return () => {
        window.clearInterval(retry);
        existingScript.removeEventListener('load', renderWidget);
      };
    }

    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.recaptchaScript = 'true';
    script.addEventListener('load', renderWidget, { once: true });
    document.head.appendChild(script);

    return () => {
      window.clearInterval(retry);
      script.removeEventListener('load', renderWidget);
    };
  }, [recaptchaState]);

  useEffect(() => {
    let active = true;
    eventApi.recaptchaSettings()
      .then(status => {
        if (!active) return;
        if (!status.available) {
          setRecaptchaError('Could not confirm the reCAPTCHA setting. Please try again before signing in.');
          setRecaptchaState('error');
          return;
        }
        if (status.enabled && (!status.configured || !import.meta.env.VITE_RECAPTCHA_SITE_KEY)) {
          setRecaptchaError('reCAPTCHA is enabled but not fully configured. Please contact an administrator.');
          setRecaptchaState('error');
          return;
        }
        setRecaptchaState(status.enabled ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (!active) return;
        setRecaptchaError('Could not confirm the reCAPTCHA setting. Please try again before signing in.');
        setRecaptchaState('error');
      })
    return () => { active = false; };
  }, []);

  const goToDashboard = useCallback((role: string) => {
    navigate(role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard', { replace: true });
  }, [navigate]);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setError('');
    setGoogleState('working');
    try {
      const result = await loginWithGoogle(credential);
      if (result.status === 'signed_in') {
        // Only an existing, already-approved account reaches this branch. A new
        // Google signup is parked as a pending request (see below) and a
        // deactivated or blocked account is refused by the server.
        goToDashboard(result.user.role);
        return;
      }
      if (result.status === 'signup_pending') {
        // AD003.3: this identity already submitted a signup request, so there is
        // no account to profile and no session to open - only the pending page.
        navigate('/login/pending', { replace: true, state: {} });
        return;
      }
      navigate('/login/complete-profile', {
        replace: true,
        state: { prefill: result.prefill },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not complete Google sign-in.');
      setGoogleState('idle');
    }
  }, [goToDashboard, loginWithGoogle, navigate]);

  const handleGoogleError = useCallback((message: string) => {
    setError(message);
    setGoogleState('idle');
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      setError('Enter your account email, ID, or username.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      if (recaptchaState === 'loading' || recaptchaState === 'error') {
        setError(recaptchaError || 'Could not confirm the reCAPTCHA setting. Please try again before signing in.');
        return;
      }
      let token: string | undefined;
      if (recaptchaState === 'enabled') {
        if (recaptchaWidgetId.current === null) {
          setError('reCAPTCHA is still loading. Please wait a moment and try again.');
          return;
        }
        token = (window as any).grecaptcha?.getResponse?.(recaptchaWidgetId.current ?? undefined) || '';
        if (!token) {
          setError('Please complete the reCAPTCHA before signing in.');
          (window as any).grecaptcha?.reset?.(recaptchaWidgetId.current ?? undefined);
          return;
        }
      }
      const user = await login(normalizedIdentifier, password, token);
      goToDashboard(user.role);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not complete sign in.');
      (window as any).grecaptcha?.reset?.(recaptchaWidgetId.current ?? undefined);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-light flex min-h-screen flex-col lg:flex-row">
      <section className="relative isolate flex min-h-[230px] flex-col justify-between overflow-hidden bg-slate-900 px-6 py-6 sm:px-8 lg:min-h-screen lg:w-[46%] lg:p-12 xl:w-1/2">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -left-24 top-1/4 h-96 w-96 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />
          <svg className="absolute -right-40 top-1/2 h-[140%] w-[140%] -translate-y-1/2 text-white/[0.07]" viewBox="0 0 600 600" fill="none" aria-hidden="true">
            {[60, 120, 180, 240, 300, 360].map(radius => (
              <circle key={radius} cx="300" cy="300" r={radius} stroke="currentColor" strokeWidth="1" />
            ))}
          </svg>
        </div>

        <div className="relative flex items-center gap-3">
          <img
            src="/brand/sbo-logo.jpg"
            alt=""
            className="h-12 w-12 rounded-full bg-white object-contain p-1 shadow-lg shadow-black/40"
          />
          <div>
            <p className="text-sm font-black tracking-tight text-white">COT Event Attendance</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-400">College of Technologies</p>
          </div>
        </div>

        <div className="relative my-8 max-w-lg lg:my-0">
          <h2 className="text-3xl font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-4xl xl:text-[3.4rem]">
            Welcome to COT Event Attendance
          </h2>
          <p className="mt-4 text-base font-semibold text-slate-200 sm:text-lg">
            A faster, safer way to check in to college events.
          </p>
          <p className="mt-4 hidden text-sm leading-6 text-slate-400 sm:block">
            Sign in securely to access your event attendance workspace. Google handles your identity when you choose Google sign-in; this application never sees your Google password.
          </p>
        </div>

        <p className="relative hidden items-center gap-2 text-xs font-semibold text-slate-500 lg:flex">
          <ShieldCheck size={14} aria-hidden="true" />
          Secure, event-only access. This is not the university&apos;s official sign-in service.
        </p>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-9 sm:px-8 lg:py-14">
        <div className="w-full max-w-md">
          <header className="mb-7">
            <h1 id="login-title" className="text-[2rem] font-bold leading-tight tracking-[-0.02em] text-slate-900">Sign in to your account</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">Use your account email, ID, or username and application password.</p>
          </header>

          <div className="mb-6">
            {google ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-full">
                  <GoogleSignInButton
                    clientId={google.clientId}
                    nonce={google.nonce}
                    text="signin"
                    onCredential={handleGoogleCredential}
                    onError={handleGoogleError}
                  />
                </div>
                <p className="w-full text-center text-xs font-medium leading-5 text-slate-600">
                  {googleMode === 'development_test'
                    ? "Sign in with the Google account on this server's private test list."
                    : 'Continue with Google to sign in.'}
                </p>
              </div>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-xs font-semibold leading-5 text-amber-800">
                {googleNotice || (googleState === 'checking'
                  ? 'Checking Google sign-in availability...'
                  : 'Google sign-in is not available. You can still sign in below with your application password.')}
              </p>
            )}

            {google && googleMode === 'development_test' && (
              <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
                <FlaskConical size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                Development testing only - not school-approved. Only the specific Google accounts listed on
                this server may sign in. Password sign-in below works normally.
              </p>
            )}

            {googleState === 'working' && (
              <p role="status" className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-orange-700">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Verifying with Google...
              </p>
            )}
          </div>

          <div className="my-6 flex items-center gap-4" role="separator" aria-label="or continue with">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">or continue with</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {error && (
            <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}
            </p>
          )}
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="identifier" className="auth-light-label">Email, ID, or username</label>
              <div className="relative">
                <Mail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={event => setIdentifier(event.target.value)}
                  placeholder="e.g. you@institution.edu or STU001"
                  className="auth-light-input pl-11"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="auth-light-label">Application password</label>
              <div className="relative">
                <LockKeyhole size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="Enter your application password"
                  className="auth-light-input pl-11 pr-11"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(value => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-orange-500"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <p className="text-xs leading-5 text-slate-500">
              This is your application password, not your Google password. Google passwords and Gmail SMTP App Passwords never work here. Approved Google-only accounts can use Google sign-in above or ask an administrator to send or resend their application password setup link.
            </p>

            {recaptchaError && (
              <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {recaptchaError}
              </p>
            )}
            {recaptchaState === 'loading' ? (
              <p className="mt-3 text-sm text-slate-500">Loading reCAPTCHA…</p>
            ) : recaptchaState === 'enabled' ? (
              <div ref={recaptchaWidgetRef} data-testid="g-recaptcha" className="g-recaptcha" />
            ) : recaptchaState === 'disabled' ? (
              <p className="mt-3 text-sm text-slate-500">
                reCAPTCHA is disabled. Ask an administrator to enable it in Settings.
              </p>
            ) : null}

            <button type="submit" disabled={isLoading} className="auth-light-button">
              {isLoading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Signing in...</> : <><LogIn size={18} aria-hidden="true" /> Sign in</>}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            Need an account? <Link to="/signup" className="auth-light-link">Request one separately</Link>
          </p>

          <p className="mt-7 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs font-semibold text-slate-400 lg:hidden">
            <ShieldCheck size={14} aria-hidden="true" /> Secure event-only access
          </p>
        </div>
      </section>
    </main>
  );
};

export default Login;
