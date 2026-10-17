import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Hourglass } from 'lucide-react';

/**
 * AD003.3: confirmation after a signup request is submitted. The person has no
 * account, no role, and no access yet; this screen explains the wait and
 * deliberately offers no dashboard link.
 */
const SignupPending: React.FC = () => {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email || '';
  return (
    <main className="auth-light flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <section className="auth-light-card w-full max-w-[480px] px-6 py-8 text-center sm:px-10 sm:py-10" aria-labelledby="pending-title">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <Hourglass size={22} aria-hidden="true" />
        </span>
        <h1 id="pending-title" className="auth-light-title mt-5">Signup request received</h1>
        <p className="auth-light-subtitle">
          {email ? <>We received an account request for <strong>{email}</strong>. </> : null}
          Your request is pending administrator approval. No account exists yet and you cannot sign in until an administrator reviews the request and assigns your department.
        </p>
        <Link to="/login" className="auth-light-button mt-6">Back to sign in</Link>
      </section>
    </main>
  );
};

export default SignupPending;
