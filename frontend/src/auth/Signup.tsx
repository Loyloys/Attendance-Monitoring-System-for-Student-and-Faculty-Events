import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GoogleSignInButton from './GoogleSignInButton';
import { AuthService } from '../data/authService';
import { eventApi, type GoogleSignInMode } from '../data/eventApi';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [emailSetup, setEmailSetup] = useState<{ configured: boolean; missing: string[] } | null>(null);
  const [google, setGoogle] = useState<{ clientId: string; nonce: string } | null>(null);
  const [googleMode, setGoogleMode] = useState<GoogleSignInMode>('unavailable');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    eventApi.emailDeliveryStatus().then(status => { if (active) setEmailSetup(status); })
      .catch(caught => { if (active) setEmailSetup({ configured: false, missing: [caught instanceof Error ? caught.message : 'backend email status'] }); });
    AuthService.googleConfig().then(config => {
      if (!active) return;
      setGoogleMode(config.mode ?? 'unavailable');
      if (!config.enabled) return;
      void AuthService.googleSession().then(session => {
        if (!active || !session.enabled || !session.nonce || !session.clientId) return;
        setGoogle({ clientId: session.clientId, nonce: session.nonce });
      }).catch(() => { if (active) setGoogle(null); });
    }).catch(() => { if (active) setGoogle(null); });
    return () => { active = false; };
  }, []);

  const requestEmailLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await eventApi.requestEmailSignup(email);
      setNotice(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email verification could not be started.');
    } finally { setBusy(false); }
  };

  const handleGoogle = async (credential: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await loginWithGoogle(credential);
      if (result.status === 'signed_in') {
        navigate(result.user.role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard', { replace: true });
      } else if (result.status === 'signup_pending') {
        navigate('/login/pending', { replace: true });
      } else {
        navigate('/login/complete-profile', { replace: true, state: { prefill: result.prefill } });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google verification failed.');
      setBusy(false);
    }
  };

  return <main className="auth-light flex min-h-screen items-center justify-center px-4 py-8">
    <section className="auth-light-card w-full max-w-lg px-6 py-8 sm:px-9">
      <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-orange-700">← Back to sign in</Link>
      <header className="my-7 text-center"><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">COT Event Attendance</p><h1 className="auth-light-title mt-2">Create an account request</h1><p className="auth-light-subtitle mt-2">Provide only your email address. The application verifies ownership and an administrator assigns your account role.</p></header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <form onSubmit={event => void requestEmailLink(event)} className="space-y-4">
        <label className="block text-sm font-semibold text-slate-700">Email address<input type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} className="auth-light-input mt-1" placeholder="you@example.edu" /></label>
        <button disabled={busy || emailSetup?.configured === false} className="app-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Requesting…' : 'Send verification link'}</button>
      </form>
      {emailSetup && !emailSetup.configured && <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Email verification is unavailable until the backend SMTP provider is configured. Required: {emailSetup.missing.join(', ')}. The backend also needs SMTP_SECURE set for the provider and PUBLIC_APP_URL set to the frontend’s public base URL.</p>}
      <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />OR CONTINUE WITH VERIFIED GOOGLE EMAIL<span className="h-px flex-1 bg-slate-200" /></div>
      {google ? <GoogleSignInButton clientId={google.clientId} nonce={google.nonce} text="signup" onCredential={credential => void handleGoogle(credential)} onError={setError} />
        : <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-600">Google signup is unavailable. Email verification can be used independently when SMTP is configured.</p>}
      {googleMode === 'development_test' && <p className="mt-3 text-xs text-amber-800">Google sign-in is restricted to the server’s development test list.</p>}
      <p className="mt-5 text-xs leading-5 text-slate-500">Verified student and faculty institutional domains receive a pending inferred role. Other verified addresses go to Admin review without an assigned role. No user account or application session is created before approval.</p>
    </section>
  </main>;
}
