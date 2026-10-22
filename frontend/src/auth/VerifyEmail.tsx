import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { eventApi } from '../data/eventApi';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<{ loading: boolean; message: string; error: boolean }>({
    loading: true, message: 'Verifying your email link…', error: false,
  });

  useEffect(() => {
    let active = true;
    if (!token) return () => { active = false; };
    eventApi.verifyEmailSignup(token)
      .then(result => { if (active) setState({ loading: false, message: result.message, error: false }); })
      .catch(caught => { if (active) setState({ loading: false, message: caught instanceof Error ? caught.message : 'This link is invalid or expired.', error: true }); });
    return () => { active = false; };
  }, [token]);

  const visibleState = token
    ? state
    : { loading: false, message: 'This verification link is missing its token. Request a new one.', error: true };
  return <main className="auth-light flex min-h-screen items-center justify-center p-5"><section className="auth-light-card max-w-lg p-8"><h1 className="auth-light-title">Email verification</h1><p role={visibleState.error ? 'alert' : 'status'} className={`mt-4 text-sm leading-6 ${visibleState.error ? 'text-rose-700' : 'text-slate-700'}`}>{visibleState.loading ? 'Checking the single-use link…' : visibleState.message}</p>{!visibleState.loading && <p className="mt-5 text-sm text-slate-600">Verification creates a pending signup request only. It does not sign you in or grant application access. An administrator must approve the request first.</p>}<Link to="/signup" className="mt-6 inline-block text-sm font-bold text-orange-700">Request another link</Link></section></main>;
}
