import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Eye,
  EyeOff,
  IdCard,
  Loader2,
  LockKeyhole,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
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
      const destination = user.role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard';
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not complete sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-screen flex min-h-screen items-center justify-center bg-[#090b10] px-4 py-8 text-white sm:px-6">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-orange-200/40 blur-3xl" />
        <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-amber-100/60 blur-3xl" />
      </div>

      <section className="auth-card relative w-full max-w-[480px] rounded-[28px] border border-white/15 bg-[#11151d] px-6 py-8 text-slate-100 shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:px-10 sm:py-10" aria-labelledby="login-title">
        <div className="mb-8 text-center">
          <img src="/brand/sbo-logo.jpg" alt="College of Technologies Student Body Organization" className="mx-auto mb-5 h-20 w-20 rounded-full bg-[#f8fafc] object-contain p-1 shadow-xl shadow-black/40" />
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-blue-300">COT Event Attendance</p>
          <h1 id="login-title" className="text-3xl font-black tracking-tight text-white">Welcome back</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm font-medium leading-6 text-slate-300">Sign in to view events and record your own event attendance.</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div className="rounded-xl border border-blue-400/30 bg-blue-400/10 p-3 text-xs font-semibold leading-5 text-blue-100">
            Your Student, Faculty, or Administrator role is assigned by the server. You cannot select or change it here.
          </div>

          <div>
            <label htmlFor="identifier" className="mb-2 block text-sm font-bold text-slate-200">ID or username</label>
            <div className="relative">
              <IdCard className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="identifier" name="identifier" type="text" autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder="e.g. STU001 or FAC001" className="w-full rounded-2xl border border-white/15 bg-white/[0.06] py-3.5 pl-12 pr-4 text-sm font-semibold text-white caret-blue-200 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-white/25 focus:border-blue-400 focus:bg-white/[0.08] focus:ring-4 focus:ring-blue-400/20" />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-bold text-slate-200">Password</label>
            <div className="relative">
              <LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" className="w-full rounded-2xl border border-white/15 bg-white/[0.06] py-3.5 pl-12 pr-12 text-sm font-semibold text-white caret-blue-200 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-white/25 focus:border-blue-400 focus:bg-white/[0.08] focus:ring-4 focus:ring-blue-400/20" />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/35 bg-rose-400/10 p-3 text-xs font-bold leading-5 text-rose-100"><AlertCircle className="mt-0.5 shrink-0 text-rose-300" size={16} />{error}</p>}

          <button type="submit" disabled={isLoading} className="app-button-primary w-full py-4 text-base">
            {isLoading ? <><Loader2 size={18} className="animate-spin" /> Signing in…</> : <><LogIn size={18} /> Sign in</>}
          </button>
        </form>

        <div className="mt-8 border-t border-white/15 pt-6 text-center">
          <p className="text-sm font-medium text-slate-300">COT accounts are created and approved by an administrator.</p>
          <p className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400"><ShieldCheck size={14} /> Secure event-only access</p>
        </div>
      </section>
    </main>
  );
};

export default Login;
