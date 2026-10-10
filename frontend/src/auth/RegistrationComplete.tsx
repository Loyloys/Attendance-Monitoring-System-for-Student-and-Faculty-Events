import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Brief confirmation shown after a Student finishes registration.
 *
 * The account is already active by the time this renders - the server creates it
 * approved - so this screen exists purely to confirm success and hand the person
 * on to the dashboard. It says nothing about waiting, because there is nothing
 * to wait for.
 *
 * Reaching this screen requires a signed-in account (`RequireAuth`), so it is a
 * convenience, never a security control.
 */
const RegistrationComplete: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Move on by itself so a registered person lands on their dashboard without
  // having to click. `replace` keeps this out of history so Back does not
  // return to a confirmation for an account that is already set up.
  useEffect(() => {
    const timer = setTimeout(() => {
      navigate(user?.role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard', { replace: true });
    }, 4000);
    return () => clearTimeout(timer);
  }, [navigate, user?.role]);

  return (
    <main className="app-workspace flex min-h-screen items-center justify-center bg-[#F5F4EC] p-6">
      <section className="app-card max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <BadgeCheck size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-[#10203B]">Registration successful</h1>
        <p className="mt-3 text-sm leading-6 text-[#64748B]">
          Your account is active and ready to use. You are being taken to your dashboard.
        </p>
        <dl className="mt-6 space-y-2 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-4 text-left text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Name</dt><dd className="font-semibold text-[#10203B]">{user?.name || '-'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Account ID</dt><dd className="font-semibold text-[#10203B]">{user?.id || '-'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Email</dt><dd className="font-semibold break-all text-[#10203B]">{user?.email || '-'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Role</dt><dd className="font-semibold capitalize text-[#10203B]">{user?.role || '-'}</dd></div>
        </dl>
        <p className="mt-4 text-xs leading-5 text-[#64748B]">
          Your account has Student access. Faculty or Administrator access is assigned by an
          administrator, and you are not registered for any events yet.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            className="app-button-primary"
            onClick={() => navigate(user?.role === 'admin' ? '/admin/dashboard' : '/portal?view=dashboard', { replace: true })}
          >
            Go to dashboard <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="app-button-secondary"
            onClick={() => { void logout().then(() => navigate('/login', { replace: true })); }}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </section>
    </main>
  );
};

export default RegistrationComplete;