import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, BadgeCheck, Loader2, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { AuthService } from '../data/authService';
import { useAuth } from '../context/AuthContext';
import type { GooglePrefill } from '../data/eventApi';

/**
 * Step two of Google signup: this is an ACCOUNT REQUEST, not an account.
 *
 * The applicant provides nothing typed - the verified Google identity below
 * (name and email) is the entire request, taken from the verified ID token on
 * the server. Department/course and the final role are assigned by an
 * administrator during approval; no User exists and no session is granted
 * until then.
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

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      // AD003.3: submitting stores an email-only pending signup request. No User
      // exists yet, so there is no session to refresh and no dashboard to enter.
      const result = await AuthService.completeGoogleProfile();
      if (result.status === 'signed_in') {
        await refreshSession();
        navigate('/registration-complete', { replace: true });
        return;
      }
      navigate('/login/pending', { replace: true, state: { email: prefill.email } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not submit your account request.');
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
          <h1 id="profile-title" className="auth-light-title">Request an account</h1>
          <p className="auth-light-subtitle">Submit an account request with your verified Google email. Nothing else is needed.</p>
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
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-medium leading-5 text-slate-600">
            This submits an <strong>account request</strong>, not an account. An administrator reviews every request
            and assigns the department and role. You cannot sign in and no account is created until your request
            is approved.
          </p>

          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            Access requires Administrator approval. Signing up with Google alone grants no role or access.
          </div>

          {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-700"><AlertCircle className="mt-0.5 shrink-0" size={16} />{error}</p>}

          <button type="submit" disabled={isLoading} className="auth-light-button">
            {isLoading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Submitting your request...</> : 'Submit account request'}
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
