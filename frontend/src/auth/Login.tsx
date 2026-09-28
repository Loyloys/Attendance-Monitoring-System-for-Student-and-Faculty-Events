import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Info,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthService } from '../data/authService';
import type { UserRole } from '../types/eventAttendance';
import GoogleSignInButton from './GoogleSignInButton';

type Tab = 'signin' | 'signup';

const ACCOUNTS: Record<UserRole, { title: string; blurb: string; identifierLabel: string; identifierHint: string; signupNote: string }> = {
  student: {
    title: 'Student Sign In',
    blurb: 'Sign in to see your events and record your own attendance.',
    identifierLabel: 'Student ID or email',
    identifierHint: 'e.g. STU001 or you@institution.edu',
    signupNote: 'New students can create an account with Google. Your student number is checked against the official list.',
  },
  faculty: {
    title: 'Faculty Sign In',
    blurb: 'Sign in to monitor attendance and manage college events.',
    identifierLabel: 'Faculty ID or email',
    identifierHint: 'e.g. FAC001 or you@institution.edu',
    signupNote: 'Faculty accounts are approved by an administrator. Continue with Google to start as a Student account.',
  },
  admin: {
    title: 'Administrator Sign In',
    blurb: 'Sign in to administer accounts, events and reports.',
    identifierLabel: 'Administrator ID or email',
    identifierHint: 'e.g. admin or you@institution.edu',
    signupNote: 'Administrator accounts are pre-authorized. They cannot be created through public sign-up.',
  },
};

const isUserRole = (value: string | undefined): value is UserRole =>
  value === 'student' || value === 'faculty' || value === 'admin';

const Login: React.FC = () => {
  const { accountType } = useParams<{ accountType: string }>();
  const account: UserRole = isUserRole(accountType) ? accountType : 'student';
  const copy = ACCOUNTS[account];

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [roleMismatch, setRoleMismatch] = useState<{ message: string; path: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [tab, setTab] = useState<Tab>('signin');
  const [google, setGoogle] = useState<{ clientId: string; nonce: string } | null>(null);
  const [googleState, setGoogleState] = useState<'idle' | 'working' | 'unavailable'>('idle');
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  // The client id and the single-use nonce both come from the server, so the
  // button can never be rendered with a client id the backend would reject.
  // VITE_GOOGLE_CLIENT_ID may supply the id ahead of time, but the server stays
  // the authority: a mismatched value still fails verification there, and the
  // nonce is only ever issued by the backend.
  useEffect(() => {
    let active = true;
    AuthService.googleConfig()
      .then(config => {
        if (!active) return;
        if (!config.enabled) {
          setGoogleState('unavailable');
          return;
        }
        return AuthService.googleSession().then(session => {
          if (!active || !session.enabled || !session.nonce) {
            if (active) setGoogleState('unavailable');
            return;
          }
          const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || session.clientId;
          if (!clientId) {
            setGoogleState('unavailable');
            return;
          }
          setGoogle({ clientId, nonce: session.nonce });
        });
      })
      .catch(() => { if (active) setGoogleState('unavailable'); });
    return () => { active = false; };
  }, []);

  const goToDashboard = useCallback((role: string) => {
    navigate(role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard', { replace: true });
  }, [navigate]);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setError('');
    setNotice('');
    setRoleMismatch(null);
    setGoogleState('working');
    try {
      // The selected account type travels with the credential purely so the
      // server can explain a role mismatch. It never assigns a role.
      // This goes through the auth context so the signed-in user also lands in
      // React state; calling the service directly would leave the route guards
      // holding a null user and send the person back to /login.
      const result = await loginWithGoogle(credential, account);
      if (result.status === 'signed_in') {
        goToDashboard(result.user.role);
        return;
      }
      navigate('/login/complete-profile', {
        replace: true,
        state: { prefill: result.prefill, selectedRole: account },
      });
    } catch (caught) {
      const payload = (caught as { payload?: { code?: string; detail?: string; correctPath?: string } }).payload;
      if (payload?.code === 'role_mismatch' && payload.correctPath) {
        setRoleMismatch({ message: payload.detail || 'Your account role does not match this sign-in.', path: payload.correctPath });
      } else {
        setError(caught instanceof Error ? caught.message : 'We could not complete Google sign-in.');
      }
      setGoogleState('idle');
    }
  }, [account, goToDashboard, loginWithGoogle, navigate]);

  const handleGoogleError = useCallback((message: string) => {
    setError(message);
    setGoogleState((state) => (state === 'unavailable' ? state : 'idle'));
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      setError('Enter your ID or username.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      const user = await login(normalizedIdentifier, password);
      goToDashboard(user.role);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not complete sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-light flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <section className="auth-light-card w-full max-w-[440px] px-6 py-8 sm:px-9 sm:py-10" aria-labelledby="login-title">
        <Link
          to="/login"
          className="mb-6 inline-flex items-center gap-1.5 rounded text-sm font-semibold text-slate-500 outline-none transition hover:text-orange-600 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to account selection
        </Link>

        <header className="mb-7 text-center">
          <img
            src="/brand/sbo-logo.jpg"
            alt="College of Technologies Student Body Organization"
            className="mx-auto mb-4 h-16 w-16 rounded-full bg-white object-contain p-1 shadow-md ring-1 ring-slate-200"
          />
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-orange-600">COT Event Attendance</p>
          <h1 id="login-title" className="auth-light-title">{copy.title}</h1>
          <p className="auth-light-subtitle">{copy.blurb}</p>
        </header>

        {/* Google sign-in: the primary no-typing path. */}
        <div className="mb-6">
          {google ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
              <div className="w-full sm:w-auto">
                <GoogleSignInButton
                  clientId={google.clientId}
                  nonce={google.nonce}
                  text={tab === 'signup' ? 'signup' : 'signin'}
                  onCredential={handleGoogleCredential}
                  onError={handleGoogleError}
                />
              </div>
              <p className="text-center text-xs font-medium leading-5 text-slate-600 sm:text-left">
                Use your institutional Google account.
              </p>
            </div>
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-xs font-semibold leading-5 text-amber-800">
              {googleState === 'unavailable'
                ? 'Google sign-in is not configured on this server yet. Use your ID and password below.'
                : 'Preparing Google sign-inâ€¦'}
            </p>
          )}

          {googleState === 'working' && (
            <p role="status" className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-orange-700">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Verifying with Googleâ€¦
            </p>
          )}
        </div>

        <div className="my-6 flex items-center gap-4" role="separator" aria-label="or continue with">
          <span className="h-px flex-1 bg-slate-200" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">or continue with</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <div role="tablist" aria-label="Account access" className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(['signin', 'signup'] as Tab[]).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              id={`auth-tab-${option}`}
              aria-selected={tab === option}
              aria-controls={`auth-panel-${option}`}
              onClick={() => { setTab(option); setError(''); setNotice(''); }}
              className={`rounded-lg px-4 py-2.5 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-orange-500 ${
                tab === option ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {option === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}
          </p>
        )}
        {roleMismatch && (
          <div role="alert" className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <p className="flex items-start gap-2 text-xs font-semibold leading-5 text-orange-900">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-orange-600" aria-hidden="true" />
              {roleMismatch.message}
            </p>
            <Link to={roleMismatch.path} className="auth-light-link mt-2 inline-block text-xs">
              Go to the correct sign-in
            </Link>
          </div>
        )}
        {notice && (
          <p role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-semibold leading-5 text-sky-800">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{notice}
          </p>
        )}

        {tab === 'signin' ? (
          <form
            id="auth-panel-signin"
            role="tabpanel"
            aria-labelledby="auth-tab-signin"
            className="space-y-5"
            onSubmit={handleSubmit}
            noValidate
          >
            <div>
              <label htmlFor="identifier" className="auth-light-label">{copy.identifierLabel}</label>
              <div className="relative">
                <Mail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={event => setIdentifier(event.target.value)}
                  placeholder={copy.identifierHint}
                  className="auth-light-input pl-11"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="auth-light-label">Password</label>
              <div className="relative">
                <LockKeyhole size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="Enter your password"
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
              Forgot your password? Password recovery is handled by an administrator.
            </p>

            <button type="submit" disabled={isLoading} className="auth-light-button">
              {isLoading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Signing inâ€¦</> : <><LogIn size={18} aria-hidden="true" /> Sign In</>}
            </button>
          </form>
        ) : (
          <div id="auth-panel-signup" role="tabpanel" aria-labelledby="auth-tab-signup" className="space-y-4">
            <p className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-900">
              Choose <span className="font-bold">Continue with Google</span> above to register.
              We verify your Google account, then ask only for the details this application needs.
            </p>
            <p className="text-xs leading-5 text-slate-600">{copy.signupNote}</p>
            <ul className="space-y-2 text-xs font-medium leading-5 text-slate-600">
              <li className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-orange-400" aria-hidden="true" />Your Google password is never seen by COT.</li>
              <li className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-orange-400" aria-hidden="true" />We never request Gmail, Drive or contacts access.</li>
              <li className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-orange-400" aria-hidden="true" />New accounts start as Student; an administrator approves any change.</li>
            </ul>
            <button
              type="button"
              onClick={() => setTab('signin')}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition hover:border-orange-400 hover:bg-orange-50/60 hover:text-orange-700 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              Already have an account? Sign in
            </button>
          </div>
        )}

        <p className="mt-7 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs font-semibold text-slate-400">
          <ShieldCheck size={14} aria-hidden="true" /> Secure event-only access
        </p>
      </section>
    </main>
  );
};

export default Login;
