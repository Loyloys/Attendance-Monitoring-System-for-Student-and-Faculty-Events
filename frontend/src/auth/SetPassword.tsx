import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { eventApi } from '../data/eventApi';

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!token) { setError('This password setup link is missing its token. Ask an administrator to send a new link.'); return; }
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      await eventApi.setApplicationPassword(token, password);
      setComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The password could not be set.');
    } finally { setBusy(false); }
  };

  return <main className="auth-light flex min-h-screen items-center justify-center p-5"><section className="auth-light-card w-full max-w-lg p-8"><h1 className="auth-light-title">Set application password</h1><p className="mt-2 text-sm text-slate-600">This is a separate password for this application, never your Google password.</p>{complete ? <><p role="status" className="mt-5 text-sm text-emerald-800">Password saved securely. Sign in using your assigned account ID and the application password.</p><Link to="/login" className="app-button-primary mt-6 inline-flex">Continue to sign in</Link></> : <form onSubmit={event => void submit(event)} className="mt-5 space-y-4"><label className="block text-sm font-semibold text-slate-700">New password<input type="password" required minLength={10} maxLength={256} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="auth-light-input mt-1" /></label><label className="block text-sm font-semibold text-slate-700">Confirm password<input type="password" required minLength={10} maxLength={256} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="auth-light-input mt-1" /></label>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<button disabled={busy} className="app-button-primary w-full">{busy ? 'Saving…' : 'Set password'}</button></form>}</section></main>;
}
