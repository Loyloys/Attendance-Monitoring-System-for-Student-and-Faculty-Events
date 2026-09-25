import { useEffect, useState, type FormEvent } from 'react';
import { Save, ShieldCheck, UserRound } from 'lucide-react';
import type { AuthUser } from '../../types/eventAttendance';

interface Props { user: AuthUser; onSave: (values: { name: string; email: string; phone: string }) => Promise<void>; }

export default function ProfilePanel({ user, onSave }: Props) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(user.name); setEmail(user.email); setPhone(user.phone); }, [user]);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setMessage(''); setError(''); try { await onSave({ name, email, phone }); setMessage('Profile updated.'); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Profile could not be updated.'); } finally { setSaving(false); } };
  return <div className="space-y-6"><div><p className="app-label">Account settings</p><h1 className="app-page-title">My profile</h1><p className="app-page-subtitle">Update your personal contact information. Your role and ID are administrator-managed.</p></div><section className="app-card max-w-3xl p-6"><form onSubmit={submit} className="space-y-5"><div className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/20 text-blue-100"><UserRound size={22} /></div><div><p className="font-semibold text-white">{user.username}</p><p className="mt-1 inline-flex items-center gap-1 text-xs capitalize text-white/45"><ShieldCheck size={13} />{user.role} · role protected</p></div></div><div><label htmlFor="profile-name" className="app-label">Full name</label><input id="profile-name" value={name} onChange={event => setName(event.target.value)} className="app-input" required /></div><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="profile-email" className="app-label">Email</label><input id="profile-email" type="email" value={email} onChange={event => setEmail(event.target.value)} className="app-input" /></div><div><label htmlFor="profile-phone" className="app-label">Phone</label><input id="profile-phone" value={phone} onChange={event => setPhone(event.target.value)} className="app-input" /></div></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100">Your role, username, department assignment, and card identifier cannot be changed from this profile.</div>{error && <p className="text-sm text-rose-200">{error}</p>}{message && <p className="text-sm text-emerald-200">{message}</p>}<button type="submit" disabled={saving} className="app-button-primary"><Save size={16} />{saving ? 'Saving…' : 'Save profile'}</button></form></section></div>;
}

