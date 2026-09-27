import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Landmark, ShieldCheck, Users } from 'lucide-react';

/**
 * The account types this application actually supports. Employee and Alumni are
 * deliberately absent: they are not roles in this system, and adding them here
 * would imply access that does not exist.
 */
const ACCOUNT_TYPES = [
  {
    key: 'student',
    title: 'Student',
    description: 'Event invitations, QR check-in and your own attendance record.',
    icon: GraduationCap,
    path: '/login/student',
  },
  {
    key: 'faculty',
    title: 'Faculty',
    description: 'Monitor attendance, review event reports and manage your events.',
    icon: Users,
    path: '/login/faculty',
  },
] as const;

/**
 * Screen one of the sign-in journey.
 *
 * This screen only decides which sign-in screen comes next. It assigns no role,
 * grants no permission, and tells the server nothing: the account that is actually
 * opened is decided by the stored profile role, exactly as before.
 */
const AccountTypeSelection: React.FC = () => {
  const navigate = useNavigate();

  return (
    <main className="auth-light flex min-h-screen flex-col lg:flex-row">
      {/* Welcome / branding panel. Hidden on small screens so the choices lead. */}
      <section className="relative isolate hidden overflow-hidden bg-slate-900 lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-12 xl:w-1/2">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -left-24 top-1/4 h-96 w-96 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />
          {/* Concentric decorative curves, echoing the reference layout. */}
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

        <div className="relative max-w-lg">
          <h1 className="text-[2.6rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white xl:text-[3.4rem]">
            Welcome to COT Event Attendance
          </h1>
          <p className="mt-5 text-lg font-semibold text-slate-200">
            A faster, safer way to check in to college events.
          </p>
          <p className="mt-5 text-sm leading-6 text-slate-400">
            Sign in once with your institutional Google account and your event access is ready.
            Google handles your identity; this application never sees your Google password.
          </p>
        </div>

        <p className="relative flex items-center gap-2 text-xs font-semibold text-slate-500">
          <ShieldCheck size={14} aria-hidden="true" />
          Secure, event-only access. This is not the university&apos;s official sign-in service.
        </p>
      </section>

      {/* Account choices */}
      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:py-14">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/brand/sbo-logo.jpg" alt="" className="h-11 w-11 rounded-full bg-white object-contain p-1 shadow-md" />
            <div>
              <p className="text-sm font-black tracking-tight text-slate-900">COT Event Attendance</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">College of Technologies</p>
            </div>
          </div>

          <h2 className="text-[2rem] font-bold leading-tight tracking-[-0.02em] text-slate-900">Choose your account type</h2>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Select the option that matches your COT account to continue to sign in.
            Your role is assigned by an administrator, so this choice cannot grant extra access.
          </p>

          <ul className="mt-8 space-y-4">
            {ACCOUNT_TYPES.map(({ key, title, description, icon: Icon, path }) => (
              <li key={key}>
                <button type="button" onClick={() => navigate(path)} className="auth-choice">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                    <Icon size={23} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-bold text-slate-900">{title}</span>
                    <span className="mt-0.5 block text-sm leading-5 text-slate-600">{description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Administrator access is preserved, but kept visually secondary: those
              accounts are pre-authorized and can never be registered publicly. */}
          <button
            type="button"
            onClick={() => navigate('/login/administrator')}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 outline-none transition hover:border-orange-400 hover:bg-orange-50/60 hover:text-orange-700 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
          >
            <Landmark size={16} aria-hidden="true" />
            Administrator sign in
          </button>

          <p className="mt-8 text-center text-xs leading-5 text-slate-500">
            New to COT Event Attendance? Choose your account type and continue with Google to
            create a Student account. Faculty and Administrator access is approved separately.
          </p>
        </div>
      </section>
    </main>
  );
};

export default AccountTypeSelection;
