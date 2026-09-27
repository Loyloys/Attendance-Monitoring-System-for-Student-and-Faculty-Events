import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, BadgeCheck, IdCard, Loader2, Mail, Phone, School, UserRound } from 'lucide-react';
import { AuthService } from '../data/authService';
import { useAuth } from '../context/AuthContext';
import type { GooglePrefill } from '../data/eventApi';

type FieldErrors = Partial<Record<'accountId' | 'name' | 'department' | 'phone', string>>;

const inputClass = 'auth-light-input pl-11';

const fieldClass = (hasError: boolean) => `relative ${hasError ? 'rounded-xl ring-1 ring-rose-400' : ''}`;

/**
 * Step two of Google registration. The verified Google name and email are shown
 * read-only, because the server is the authority for both, and only the fields
 * this application actually needs are collected.
 */
const CompleteGoogleProfile: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const locationState = (location.state as { prefill?: GooglePrefill; selectedRole?: string } | null) ?? {};
  const prefill: GooglePrefill = locationState.prefill ?? { name: '', email: '', picture: '' };
  // Remembered only so "Cancel" returns to the screen the person came from.
  const selectedRole = ['student', 'faculty', 'admin'].includes(locationState.selectedRole ?? '')
    ? locationState.selectedRole
    : null;

  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState(prefill.name);
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validate = () => {
    const next: FieldErrors = {};
    if (!accountId.trim()) next.accountId = 'Enter your student or staff ID.';
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/.test(accountId.trim())) next.accountId = 'Use 3 to 30 letters, numbers, dots, dashes or underscores.';
    if (!name.trim()) next.name = 'Enter your full name.';
    if (!department.trim()) next.department = 'Enter your department or program.';
    if (phone.trim().length > 40) next.phone = 'Phone must not exceed 40 characters.';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!validate()) return;
    setIsLoading(true);
    try {
      // Goes through the auth context so the new session also lands in React state.
      // The service alone would leave the route guards holding a null user, and
      // the redirect below would bounce the new account straight back to /login.
      const user = await AuthService.completeGoogleProfile({
        accountId: accountId.trim().toUpperCase(),
        department: department.trim(),
        name: name.trim(),
        phone: phone.trim(),
      });
      await refreshSession();
      navigate(user.role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not create your account.');
      setIsLoading(false);
    }
  };

  const abandon = () => {
    AuthService.logout().catch(() => undefined);
    navigate(selectedRole ? `/login/${selectedRole}` : '/login', { replace: true });
  };

  return (
    <main className="auth-light flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <section className="auth-light-card w-full max-w-[480px] px-6 py-8 sm:px-10 sm:py-10" aria-labelledby="profile-title">
        <div className="mb-7 text-center">
          <img src="/brand/sbo-logo.jpg" alt="College of Technologies Student Body Organization" className="mx-auto mb-4 h-16 w-16 rounded-full bg-white object-contain p-1 shadow-md ring-1 ring-slate-200" />
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-orange-600">COT Event Attendance</p>
          <h1 id="profile-title" className="auth-light-title">Complete your profile</h1>
          <p className="auth-light-subtitle">Confirm your details so an administrator can recognise and approve your account.</p>
        </div>

        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          {prefill.picture
            ? <img src={prefill.picture} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
            : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600"><UserRound size={20} /></span>}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-900">
              {prefill.name || 'Google account'}
              <BadgeCheck size={15} className="shrink-0 text-orange-500" aria-label="Verified by Google" />
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-slate-500"><Mail size={12} />{prefill.email}</p>
          </div>
        </div>


        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="accountId" className="auth-light-label">Student or staff ID</label>
            <div className={fieldClass(Boolean(fieldErrors.accountId))}>
              <IdCard className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="accountId" name="accountId" type="text" autoComplete="off" value={accountId} onChange={event => setAccountId(event.target.value)} aria-invalid={Boolean(fieldErrors.accountId)} aria-describedby={fieldErrors.accountId ? 'accountId-error' : undefined} placeholder="e.g. STU001" className={inputClass} />
            </div>
            {fieldErrors.accountId && <p id="accountId-error" role="alert" className="mt-2 text-xs font-semibold text-rose-600">{fieldErrors.accountId}</p>}
          </div>

          <div>
            <label htmlFor="fullName" className="auth-light-label">Full name</label>
            <div className={fieldClass(Boolean(fieldErrors.name))}>
              <UserRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="fullName" name="name" type="text" autoComplete="name" value={name} onChange={event => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'name-error' : undefined} className={inputClass} />
            </div>
            {fieldErrors.name && <p id="name-error" role="alert" className="mt-2 text-xs font-semibold text-rose-600">{fieldErrors.name}</p>}
          </div>

          <div>
            <label htmlFor="department" className="auth-light-label">Department or program</label>
            <div className={fieldClass(Boolean(fieldErrors.department))}>
              <School className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="department" name="department" type="text" autoComplete="organization-title" value={department} onChange={event => setDepartment(event.target.value)} aria-invalid={Boolean(fieldErrors.department)} aria-describedby={fieldErrors.department ? 'department-error' : undefined} placeholder="e.g. BSIT" className={inputClass} />
            </div>
            {fieldErrors.department && <p id="department-error" role="alert" className="mt-2 text-xs font-semibold text-rose-600">{fieldErrors.department}</p>}
          </div>

          <div>
            <label htmlFor="phone" className="auth-light-label">Contact number <span className="font-normal text-slate-400">(optional)</span></label>
            <div className={fieldClass(Boolean(fieldErrors.phone))}>
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'phone-error' : undefined} placeholder="09XXXXXXXXX" className={inputClass} />
            </div>
            {fieldErrors.phone && <p id="phone-error" role="alert" className="mt-2 text-xs font-semibold text-rose-600">{fieldErrors.phone}</p>}
          </div>

          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-900">
            New accounts start as Student. Faculty and Administrator access is granted by an administrator.
          </div>

          {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-700"><AlertCircle className="mt-0.5 shrink-0" size={16} />{error}</p>}

          <button type="submit" disabled={isLoading} className="auth-light-button">
            {isLoading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Creating your account...</> : 'Create my account'}
          </button>
          <button
            type="button"
            onClick={abandon}
            disabled={isLoading}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition hover:border-orange-400 hover:bg-orange-50/60 hover:text-orange-700 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            Cancel
          </button>
        </form>
      </section>
    </main>
  );
};

export default CompleteGoogleProfile;
