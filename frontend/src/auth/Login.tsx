import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  IdCard,
  Loader2,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { AuthService, type UserType } from '../data/authService';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

const roleOptions: Array<{ value: UserType; label: string; description: string; icon: typeof GraduationCap }> = [
  { value: 'student', label: 'Student', description: 'Access events and attendance', icon: GraduationCap },
  { value: 'faculty', label: 'Faculty', description: 'Organize and supervise events', icon: BriefcaseBusiness },
  { value: 'admin', label: 'Administrator', description: 'Manage the whole system', icon: ShieldCheck },
];

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState<UserType>('student');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setFieldError('');
    setRecoveryMessage('');

    if (Date.now() < lockedUntil) {
      setError('Too many failed attempts. Please wait 30 seconds and try again.');
      return;
    }

    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      setFieldError('Enter your email, username, or ID number.');
      return;
    }
    if (normalizedIdentifier.length < 3) {
      setFieldError('Enter a valid email, username, or ID number.');
      return;
    }
    if (!password) {
      setError('Enter your password to continue.');
      return;
    }

    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 350));
      const user = AuthService.login({ email: normalizedIdentifier, password, userType });
      if (!user) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (nextAttempts >= MAX_ATTEMPTS) setLockedUntil(Date.now() + LOCKOUT_MS);
        setError('The credentials do not match an active account for this role.');
        return;
      }

      setFailedAttempts(0);
      AuthService.saveUser(user);
      const dashboardMap: Record<UserType, string> = {
        student: '/student/dashboard',
        faculty: '/portal',
        lecturer: '/portal',
        admin: '/admin/dashboard',
      };
      navigate(dashboardMap[user.type] || '/portal', { replace: true });
    } catch {
      setError('We could not complete sign in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecovery = () => {
    setRecoveryMessage('Password recovery requires a registered COT email or ID. Contact a COT administrator to reset your account.');
    setError('');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7ed] px-4 py-8 text-[#17212b] sm:px-6">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-orange-200/40 blur-3xl" />
        <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-amber-100/60 blur-3xl" />
      </div>

      <section className="relative w-full max-w-[480px] rounded-[28px] border border-white bg-white px-6 py-8 shadow-[0_24px_70px_rgba(20,64,48,0.14)] sm:px-10 sm:py-10" aria-labelledby="login-title">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-900/20">
            <span className="text-xl font-black tracking-tight">COT</span>
          </div>
          <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-orange-600">COT Attendance Web</p>
          <h1 id="login-title" className="text-3xl font-black tracking-tight text-[#17212b]">Welcome Back</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">Sign in to manage and track event attendance.</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <fieldset>
            <legend className="mb-3 text-sm font-bold text-[#142b36]">Sign in as</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {roleOptions.map(({ value, label, description, icon: Icon }) => (
                <button key={value} type="button" aria-pressed={userType === value} onClick={() => setUserType(value)} className={`rounded-2xl border px-3 py-3 text-left transition focus:outline-none focus:ring-4 focus:ring-orange-100 ${userType === value ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-500 hover:border-orange-300'}`}>
                  <Icon size={18} aria-hidden="true" />
                  <span className="mt-2 block text-xs font-black">{label}</span>
                  <span className="mt-1 block text-[10px] leading-4">{description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="identifier" className="mb-2 block text-sm font-bold text-[#142b36]">Email, username, or ID number</label>
            <div className="relative">
              <IdCard className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="identifier" name="identifier" type="text" autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder="e.g. student or COT-STU001" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? 'identifier-error' : undefined} />
            </div>
            {fieldError && <p id="identifier-error" className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-600"><AlertCircle size={14} />{fieldError}</p>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-bold text-[#142b36]">Password</label>
              <button type="button" onClick={handleRecovery} className="text-xs font-bold text-orange-600 hover:underline focus:outline-none focus:ring-2 focus:ring-orange-200">Forgot Password?</button>
            </div>
            <div className="relative">
              <LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-12 text-sm outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:text-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-200">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {recoveryMessage && <p className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{recoveryMessage}</p>}
          {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</p>}

          <button type="submit" disabled={isLoading || Date.now() < lockedUntil} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-4 text-sm font-black text-white shadow-lg shadow-orange-900/15 transition hover:bg-orange-600 focus:outline-none focus:ring-4 focus:ring-orange-200 disabled:cursor-not-allowed disabled:opacity-60">
            {isLoading ? <><Loader2 size={18} className="animate-spin" /> Signing in...</> : <><LogIn size={18} /> Sign In</>}
          </button>
        </form>

        <div className="mt-8 border-t border-slate-100 pt-6 text-center">
          <p className="text-sm text-slate-500">COT accounts are created and approved by an administrator.</p>
          <p className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-400"><UserRound size={13} /> Secure access for COT students, faculty, and administrators</p>
        </div>
      </section>
    </main>
  );
};

export default Login;
