import { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Activity, AlertCircle, ArrowRight, BarChart3, CalendarDays, Check, CheckCircle2,
  ClipboardCheck, Download, Edit3, FileText, MessageSquare,
  Plus, Search, ShieldCheck, Trash2, Users, X,
} from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthService } from '../../data/authService';
import { eventApi, type AdminEventRequest } from '../../data/eventApi';
import {
  addAttendance, addUser, correctAttendance,
  getAttendanceCounts, getAttendancePercentage, getFormResults, getLiveEvent,
  removeAttendance, removeForm, removeUser, reportRows, saveForm, setUserStatus,
  updateUser, useAdminState,
  type AdminEvent, type AdminRole, type AdminState, type AdminUserAccount,
  type AttendanceStatus, type EvaluationForm, type EventAudience, type EventOrigin,
} from '../../data/adminStore';
import Button from '../../components/common/Button';
import { StatusBadge } from '../../components/common/StatusBadge';

export type AdminSection = 'dashboard' | 'users' | 'events' | 'attendance' | 'reports' | 'feedback';

type UserForm = {
  id?: string;
  name: string;
  username: string;
  email: string;
  contact: string;
  role: AdminRole;
  department: string;
  password: string;
};

type EventForm = {
  name: string;
  description: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  organizer: string;
  origin: EventOrigin;
  audience: EventAudience;
  department: string;
  method: AdminEvent['method'];
  identifierRange: string;
  cutoff: string;
  status: AdminEvent['status'];
  requiredForAttendance: boolean;
};

const emptyUserForm: UserForm = { name: '', username: '', email: '', contact: '', role: 'Student', department: 'BSIT', password: '' };
const emptyEventForm: EventForm = {
  name: '', description: '', date: '', start: '08:00', end: '16:00', venue: '', organizer: 'College of Technologies',
  origin: 'Admin', audience: 'All', department: 'College of Technologies', method: 'QR Code', identifierRange: 'All active attendees', cutoff: '08:15', status: 'Approved', requiredForAttendance: true,
};
const inputClass = 'w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20';
const labelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/45';
const panelClass = 'rounded-2xl border border-white/[0.08] bg-[#11151d]/90 shadow-xl';

function statusTone(status: string): 'success' | 'warning' | 'error' | 'info' {
  if (['Active', 'Approved', 'Present', 'Completed'].includes(status)) return 'success';
  if (['Pending', 'Late', 'Ongoing'].includes(status)) return 'warning';
  if (['Inactive', 'Cancelled', 'Absent'].includes(status)) return 'error';
  return 'info';
}

function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }

function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><button type="button" aria-label="Close dialog" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} /><section className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#151a23] p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-white">{title}</h2>{description && <p className="mt-1 text-sm text-white/45">{description}</p>}</div><button type="button" onClick={onClose} className="rounded-lg p-2 text-white/45 hover:bg-white/[0.06] hover:text-white" aria-label="Close"><X size={18} /></button></div>{children}</section></div>;
}

function EmptyState({ message }: { message: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.12] p-10 text-center text-sm text-white/45">{message}</div>; }

function Metric({ label, value, tone = 'blue', icon: Icon }: { label: string; value: string | number; tone?: 'blue' | 'green' | 'amber' | 'rose'; icon: typeof Activity }) {
  const tones = { blue: 'text-blue-300 bg-blue-400/10', green: 'text-emerald-300 bg-emerald-400/10', amber: 'text-amber-300 bg-amber-400/10', rose: 'text-rose-300 bg-rose-400/10' };
  return <div className={panelClass + ' p-5'}><div className="flex items-center justify-between"><p className="text-xs font-semibold text-white/45">{label}</p><span className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon size={18} /></span></div><p className="mt-4 text-3xl font-black text-white">{value}</p></div>;
}

function UserEditor({ form, editingId, setForm, onSubmit, onClose, error }: { form: UserForm; editingId?: string; setForm: (form: UserForm) => void; onSubmit: () => void; onClose: () => void; error: string }) {
  const set = (key: keyof UserForm, value: string) => setForm({ ...form, [key]: value });
  return <Modal title={form.id ? 'Edit account' : 'Create account'} description="Manage identity, contact details, and access role." onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSubmit(); }} className="grid gap-4 sm:grid-cols-2">
    <label><span className={labelClass}>Full name</span><input className={inputClass} value={form.name} onChange={event => set('name', event.target.value)} required /></label>
    <label><span className={labelClass}>Account ID</span><input className={inputClass} value={form.id || ''} onChange={event => set('id', event.target.value)} placeholder="STU011 / EMP004 / ADM004" required readOnly={Boolean(editingId)} /></label>
    <label><span className={labelClass}>Username</span><input className={inputClass} value={form.username} onChange={event => set('username', event.target.value)} required /></label>
    <label><span className={labelClass}>Email</span><input type="email" className={inputClass} value={form.email} onChange={event => set('email', event.target.value)} required /></label>
    <label><span className={labelClass}>Contact details</span><input className={inputClass} value={form.contact} onChange={event => set('contact', event.target.value)} placeholder="Phone or email" required /></label>
    <label><span className={labelClass}>Department / course</span><input className={inputClass} value={form.department} onChange={event => set('department', event.target.value)} required /></label>
    <label><span className={labelClass}>Role</span><select className={inputClass} value={form.role} onChange={event => set('role', event.target.value)}><option>Student</option><option>Faculty</option><option>Admin</option></select></label>
    <label><span className={labelClass}>{form.id ? 'New password (optional)' : 'Temporary password'}</span><input type="password" className={inputClass} value={form.password} onChange={event => set('password', event.target.value)} required={!form.id} /></label>
    {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200 sm:col-span-2">{error}</p>}
    <div className="flex justify-end gap-3 sm:col-span-2"><Button variant="glass" onClick={onClose}>Cancel</Button><Button type="submit">{form.id ? 'Save changes' : 'Create account'}</Button></div>
  </form></Modal>;
}



function EventEditor({ form, setForm, onSubmit, onClose, error, saving }: { form: EventForm; setForm: (form: EventForm) => void; onSubmit: () => void; onClose: () => void; error: string; saving: boolean }) {
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm({ ...form, [key]: value });
  return <Modal title="Schedule event" description="Set event details, attendance method, and automatic late cut-off." onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSubmit(); }} className="grid gap-4 sm:grid-cols-2">
    <label className="sm:col-span-2"><span className={labelClass}>Event name</span><input className={inputClass} value={form.name} onChange={event => set('name', event.target.value)} required /></label>
    <label className="sm:col-span-2"><span className={labelClass}>Description</span><textarea className={inputClass} rows={2} value={form.description} onChange={event => set('description', event.target.value)} required /></label>
    <label><span className={labelClass}>Date</span><input type="date" className={inputClass} value={form.date} onChange={event => set('date', event.target.value)} required /></label>
    <label><span className={labelClass}>Venue</span><input className={inputClass} value={form.venue} onChange={event => set('venue', event.target.value)} required /></label>
    <label><span className={labelClass}>Start time</span><input type="time" className={inputClass} value={form.start} onChange={event => set('start', event.target.value)} required /></label>
    <label><span className={labelClass}>End time</span><input type="time" className={inputClass} value={form.end} onChange={event => set('end', event.target.value)} required /></label>
    <label><span className={labelClass}>Cut-off time</span><input type="time" className={inputClass} value={form.cutoff} onChange={event => set('cutoff', event.target.value)} required /></label>
    <label><span className={labelClass}>Event status</span><select className={inputClass} value={form.status} onChange={event => set('status', event.target.value as EventForm['status'])}><option>Pending</option><option>Approved</option><option>Ongoing</option><option>Completed</option><option>Cancelled</option></select></label>
    <label><span className={labelClass}>Attendance method</span><select className={inputClass} value={form.method} onChange={event => set('method', event.target.value as EventForm['method'])}><option>QR Code</option><option>Barcode</option><option>ID range</option><option>Manual attendance</option></select></label>
    <label className="sm:col-span-2"><span className={labelClass}>ID / barcode range or attendance group</span><input className={inputClass} value={form.identifierRange} onChange={event => set('identifierRange', event.target.value)} required /></label>
    <label><span className={labelClass}>Event source</span><select className={inputClass} value={form.origin} onChange={event => set('origin', event.target.value as EventOrigin)}><option>Admin</option><option>Student organization</option><option>Faculty</option></select></label>
    <label><span className={labelClass}>Audience</span><select className={inputClass} value={form.audience} onChange={event => set('audience', event.target.value as EventAudience)}><option>All</option><option>Student</option><option>Faculty</option></select></label>
    <label><span className={labelClass}>Department / group</span><input className={inputClass} value={form.department} onChange={event => set('department', event.target.value)} required /></label>
    <label className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/70"><input type="checkbox" checked={form.requiredForAttendance} onChange={event => set('requiredForAttendance', event.target.checked)} /> Required for percentage</label>
    {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200 sm:col-span-2">{error}</p>}
    <div className="flex justify-end gap-3 sm:col-span-2"><Button variant="glass" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Schedule event'}</Button></div>
  </form></Modal>;
}

function UsersSection({ users }: { users: AdminUserAccount[] }) {
  const [filter, setFilter] = useState<'All' | AdminRole>('All');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminUserAccount | null | undefined>(undefined);
  const [form, setForm] = useState<UserForm>(emptyUserForm);
  const [error, setError] = useState('');
  const visible = users.filter(user => (filter === 'All' || user.role === filter) && `${user.name} ${user.id} ${user.email} ${user.department}`.toLowerCase().includes(query.toLowerCase()));
  const openCreate = () => { setEditing(null); setForm(emptyUserForm); setError(''); };
  const openEdit = (user: AdminUserAccount) => { setEditing(user); setForm({ id: user.id, name: user.name, username: user.username, email: user.email, contact: user.contact, role: user.role, department: user.department, password: '' }); setError(''); };
  const save = () => {
    try {
      if (editing) updateUser(editing.id, { name: form.name, username: form.username, email: form.email, contact: form.contact, role: form.role, department: form.department, ...(form.password ? { passwordHash: form.password } : {}) });
      else addUser({ id: form.id, username: form.username, name: form.name, email: form.email, contact: form.contact, role: form.role, department: form.department, passwordHash: form.password });
      setEditing(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save account.'); }
  };
  const remove = (user: AdminUserAccount) => { if (window.confirm(`Delete ${user.name}'s account?`)) { try { removeUser(user.id); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to delete account.'); } } };
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">RBAC · Identity directory</p><h1 className="mt-2 text-3xl font-black text-white">User management</h1><p className="mt-1 text-sm text-white/45">Create, update, deactivate, and assign Student, Faculty, or Admin access.</p></div><Button onClick={openCreate}><Plus size={17} /> Add account</Button></div>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" /><input className={inputClass + ' pl-10'} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, ID, email, or department" /></div><select className={inputClass + ' sm:w-48'} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option>All</option><option>Student</option><option>Faculty</option><option>Admin</option></select></div>
    <div className="overflow-x-auto rounded-2xl border border-white/[0.08]"><table className="w-full min-w-[920px] text-left text-sm"><thead className="border-b border-white/[0.08] bg-white/[0.03] text-xs uppercase tracking-wider text-white/40"><tr><th className="px-5 py-4">Account</th><th className="px-5 py-4">Role</th><th className="px-5 py-4">Department / course</th><th className="px-5 py-4">Contact</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{visible.map(user => <tr key={user.id} className="hover:bg-white/[0.025]"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-400/10 text-xs font-bold text-blue-200">{initials(user.name)}</span><div><p className="font-semibold text-white">{user.name}</p><p className="text-xs text-white/40">{user.id} · @{user.username}</p></div></div></td><td className="px-5 py-4"><StatusBadge status="info">{user.role}</StatusBadge></td><td className="px-5 py-4 text-white/65">{user.department}</td><td className="px-5 py-4 text-white/55">{user.contact || user.email}</td><td className="px-5 py-4"><StatusBadge status={user.status === 'Active' ? 'success' : 'error'}>{user.status}</StatusBadge></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button type="button" title="Edit account" onClick={() => openEdit(user)} className="rounded-lg p-2 text-white/45 hover:bg-blue-400/10 hover:text-blue-200"><Edit3 size={16} /></button><button type="button" title={user.status === 'Active' ? 'Deactivate account' : 'Reactivate account'} onClick={() => setUserStatus(user.id, user.status === 'Active' ? 'Inactive' : 'Active')} className="rounded-lg p-2 text-white/45 hover:bg-amber-400/10 hover:text-amber-200"><ShieldCheck size={16} /></button><button type="button" title="Delete account" onClick={() => remove(user)} className="rounded-lg p-2 text-white/45 hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table>{visible.length === 0 && <div className="p-8"><EmptyState message="No accounts match the current filters." /></div>}</div>
    {editing !== undefined && <UserEditor form={form} editingId={editing?.id} setForm={setForm} onSubmit={save} onClose={() => setEditing(undefined)} error={error} />}
  </section>;
}

function EventsSection() {
  const [serverEvents, setServerEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Student organization' | 'Faculty'>('All');
  const [editing, setEditing] = useState<AdminEvent | null | undefined>(undefined);
  const [form, setForm] = useState<EventForm>(emptyEventForm);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    eventApi.adminEvents()
      .then(data => { if (active) setServerEvents(data); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Events could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = (loading ? [] : serverEvents)
    .filter(event => filter === 'All' || event.origin === filter)
    .sort((a, b) => b.date.localeCompare(a.date));
  const openCreate = () => { setEditing(null); setForm(emptyEventForm); setError(''); };
  const openEdit = (event: AdminEvent) => {
    setEditing(event);
    setForm({ name: event.name, description: event.description, date: event.date, start: event.start, end: event.end, venue: event.venue, organizer: event.organizer, origin: event.origin, audience: event.audience, department: event.department, method: event.method, identifierRange: event.identifierRange, cutoff: event.cutoff, status: event.status, requiredForAttendance: event.requiredForAttendance });
    setError('');
  };
  const requestFromForm = (value: EventForm): AdminEventRequest => ({
    name: value.name.trim(),
    description: value.description.trim(),
    date: value.date,
    start: value.start,
    end: value.end,
    venue: value.venue.trim(),
    audience: value.audience.toLowerCase() as AdminEventRequest['audience'],
    method: value.method === 'Barcode' ? 'barcode' : value.method === 'ID range' ? 'rfid' : 'qr',
    cutoff: value.cutoff,
    status: value.status === 'Cancelled' ? 'cancelled' : 'published',
    requiredForAttendance: value.requiredForAttendance,
  });
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const request = requestFromForm(form);
      const saved = editing
        ? await eventApi.updateAdminEvent(editing.id, request)
        : await eventApi.createAdminEvent(request);
      setServerEvents(current => editing
        ? current.map(event => event.id === saved.id ? saved : event)
        : [saved, ...current]);
      setEditing(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save event.');
    } finally {
      setSaving(false);
    }
  };
  const approve = async (event: AdminEvent) => {
    try {
      const saved = await eventApi.updateAdminEvent(event.id, { status: 'published' });
      setServerEvents(current => current.map(item => item.id === saved.id ? saved : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to approve event.');
    }
  };
  const cancel = async (event: AdminEvent) => {
    if (!window.confirm(`Cancel ${event.name}?`)) return;
    try {
      const saved = await eventApi.cancelAdminEvent(event.id);
      setServerEvents(current => current.map(item => item.id === saved.id ? saved : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel event.');
    }
  };
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Scheduling · Approval · Cancellation</p><h1 className="mt-2 text-3xl font-black text-white">Event management</h1><p className="mt-1 text-sm text-white/45">Create events, review Student and Faculty submissions, and keep attendance tracking visible.</p></div><Button onClick={openCreate}><Plus size={17} /> Create event</Button></div>
    {error && !editing && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFilter('All')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === 'All' ? 'bg-blue-500/15 text-blue-200 ring-1 ring-inset ring-blue-400/20' : 'bg-white/[0.04] text-white/50'}`}>All events</button><button type="button" onClick={() => setFilter('Student organization')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === 'Student organization' ? 'bg-blue-500/15 text-blue-200 ring-1 ring-inset ring-blue-400/20' : 'bg-white/[0.04] text-white/50'}`}>Student submissions</button><button type="button" onClick={() => setFilter('Faculty')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === 'Faculty' ? 'bg-blue-500/15 text-blue-200 ring-1 ring-inset ring-blue-400/20' : 'bg-white/[0.04] text-white/50'}`}>Faculty submissions</button></div>
    <div className="grid gap-4 lg:grid-cols-2">{visible.map(event => <article key={event.id} className={panelClass + ' p-5'}><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/35">{event.id}</span><StatusBadge status={statusTone(event.status)}>{event.status}</StatusBadge></div><h2 className="mt-2 text-lg font-bold text-white">{event.name}</h2><p className="mt-1 text-sm leading-6 text-white/50">{event.description}</p></div><span className="rounded-xl bg-blue-400/10 p-2.5 text-blue-200"><CalendarDays size={19} /></span></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-white/35">Date & time</p><p className="mt-1 font-semibold text-white/75">{event.date} · {event.start}–{event.end}</p></div><div><p className="text-xs text-white/35">Venue</p><p className="mt-1 font-semibold text-white/75">{event.venue}</p></div><div><p className="text-xs text-white/35">Attendance</p><p className="mt-1 font-semibold text-white/75">{event.method} · {event.identifierRange}</p></div><div><p className="text-xs text-white/35">Late cut-off</p><p className="mt-1 font-semibold text-amber-200">{event.cutoff}</p></div></div><div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/[0.07] pt-4"><Button variant="glass" className="px-3 py-2 text-xs" onClick={() => openEdit(event)}><Edit3 size={14} /> Edit</Button>{event.status === 'Pending' && <Button className="px-3 py-2 text-xs" onClick={() => void approve(event)}><Check size={14} /> Approve</Button>}{event.status !== 'Cancelled' && event.status !== 'Completed' && <Button variant="glass" className="px-3 py-2 text-xs text-rose-200 hover:text-rose-100" onClick={() => cancel(event)}><X size={14} /> Cancel</Button>}</div></article>)}</div>
    {visible.length === 0 && <EmptyState message="No events match this submission filter." />}
    {editing !== undefined && <EventEditor form={form} setForm={setForm} onSubmit={() => void save()} onClose={() => setEditing(undefined)} error={error} saving={saving} />}
  </section>;
}



function AttendanceSection({ events, attendance, users }: { events: AdminEvent[]; attendance: AdminState['attendance']; users: AdminUserAccount[] }) {
  const live = events.find(event => event.status === 'Ongoing') || events[0];
  const [eventId, setEventId] = useState(live?.id || events[0]?.id || '');
  const selected = events.find(event => event.id === eventId) || live;
  const records = attendance.filter(record => record.eventId === selected?.id);
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [personId, setPersonId] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('Present');
  const [error, setError] = useState('');
  const visible = records.filter(record => `${record.name} ${record.personId} ${record.department}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Live monitoring · Manual correction</p><h1 className="mt-2 text-3xl font-black text-white">Attendance management</h1><p className="mt-1 text-sm text-white/45">Review individual records, add missing entries, correct disputes, and remove invalid records.</p></div><div className="flex flex-wrap gap-2"><select className={inputClass + ' sm:w-64'} value={eventId} onChange={event => setEventId(event.target.value)}>{events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select><Button onClick={() => { setAddOpen(true); setError(''); }}><Plus size={17} /> Add record</Button></div></div>
    {selected && <div className="grid gap-4 sm:grid-cols-4"><Metric label="Present" value={records.filter(record => record.status === 'Present').length} tone="green" icon={CheckCircle2} /><Metric label="Late" value={records.filter(record => record.status === 'Late').length} tone="amber" icon={Activity} /><Metric label="Absent" value={records.filter(record => record.status === 'Absent').length} tone="rose" icon={AlertCircle} /><Metric label="Cut-off" value={selected.cutoff} tone="blue" icon={Activity} /></div>}
    <div className="relative"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" /><input className={inputClass + ' pl-10'} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search attendee, ID, or department" /></div>
    <div className="overflow-x-auto rounded-2xl border border-white/[0.08]"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-white/[0.08] bg-white/[0.03] text-xs uppercase tracking-wider text-white/40"><tr><th className="px-5 py-4">Attendee</th><th className="px-5 py-4">Role / department</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Recorded</th><th className="px-5 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{visible.map(record => <tr key={record.id}><td className="px-5 py-4"><p className="font-semibold text-white">{record.name}</p><p className="text-xs text-white/40">{record.personId}</p></td><td className="px-5 py-4 text-white/60">{record.role} · {record.department}</td><td className="px-5 py-4"><StatusBadge status={statusTone(record.status)}>{record.status}</StatusBadge></td><td className="px-5 py-4 text-white/50">{record.scannedAt ? new Date(record.scannedAt).toLocaleString() : 'Manual entry'} <span className="block text-[10px] text-white/30">{record.source}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><select aria-label={`Correct ${record.name}`} className="rounded-lg border border-white/[0.1] bg-[#11151d] px-2 py-1.5 text-xs text-white" value={record.status} onChange={event => correctAttendance(record.id, event.target.value as AttendanceStatus, 'Corrected by administrator')}><option>Present</option><option>Late</option><option>Absent</option></select><button type="button" title="Remove attendance record" onClick={() => { if (window.confirm(`Remove ${record.name}'s record?`)) removeAttendance(record.id); }} className="rounded-lg p-2 text-white/40 hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table>{visible.length === 0 && <div className="p-8"><EmptyState message="No attendance records match this event and search." /></div>}</div>
    {addOpen && selected && <Modal title="Add attendance record" description={`Add a manual record to ${selected.name}.`} onClose={() => setAddOpen(false)}><div className="space-y-4"><label><span className={labelClass}>Account</span><select className={inputClass} value={personId} onChange={event => setPersonId(event.target.value)}><option value="">Select Student or Faculty</option>{users.filter(user => user.role !== 'Admin').map(user => <option key={user.id} value={user.id}>{user.name} · {user.id} · {user.role}</option>)}</select></label><label><span className={labelClass}>Status</span><select className={inputClass} value={status} onChange={event => setStatus(event.target.value as AttendanceStatus)}><option>Present</option><option>Late</option><option>Absent</option></select></label>{error && <p className="text-sm text-rose-200">{error}</p>}<div className="flex justify-end gap-3"><Button variant="glass" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => { const person = users.find(user => user.id === personId); if (!person) return setError('Select a valid account.'); try { addAttendance({ eventId: selected.id, personId: person.id, name: person.name, role: person.role === 'Faculty' ? 'Faculty' : 'Student', department: person.department, status, source: 'Manual addition' }); setPersonId(''); setAddOpen(false); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to add attendance.'); } }}>Add record</Button></div></div></Modal>}
  </section>;
}



function ReportsSection({ state }: { state: AdminState }) {
  const [eventId, setEventId] = useState('');
  const [department, setDepartment] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [role, setRole] = useState<'All' | 'Student' | 'Faculty'>('All');
  const departments = [...new Set(state.users.map(user => user.department).filter(Boolean))];
  const rows = reportRows({ eventId: eventId || undefined, department: department || undefined, startDate: startDate || undefined, endDate: endDate || undefined, role: role === 'All' ? undefined : role }, state);
  const counts = { present: rows.filter(row => row.status === 'Present').length, late: rows.filter(row => row.status === 'Late').length, absent: rows.filter(row => row.status === 'Absent').length };
  const exportPdf = (targetRole: 'Student' | 'Faculty') => {
    const targetRows = rows.filter(row => row.role === targetRole);
    const targetCounts = { present: targetRows.filter(row => row.status === 'Present').length, late: targetRows.filter(row => row.status === 'Late').length, absent: targetRows.filter(row => row.status === 'Absent').length };
    const pdf = new jsPDF();
    pdf.setTextColor(37, 99, 235); pdf.setFontSize(18); pdf.text('COT Attendance Report', 14, 18);
    pdf.setFontSize(10); pdf.setTextColor(70, 80, 95); pdf.text(`${targetRole} attendance · ${eventId || 'All filtered events'}`, 14, 27); pdf.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);
    pdf.text(`Present: ${targetCounts.present}   Late: ${targetCounts.late}   Absent: ${targetCounts.absent}   Total: ${targetRows.length}`, 14, 43);
    let y = 60; pdf.text('ID', 14, y); pdf.text('Name', 42, y); pdf.text('Event', 100, y); pdf.text('Status', 168, y); y += 7;
    targetRows.forEach(row => { if (y > 275) { pdf.addPage(); y = 20; } pdf.text(row.personId, 14, y); pdf.text(row.name.slice(0, 28), 42, y); pdf.text(row.eventId, 100, y); pdf.text(row.status, 168, y); y += 7; });
    pdf.save(`COT_${targetRole.toLowerCase()}_attendance_${eventId || 'report'}.pdf`);
  };
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Statistics · Event / department / date range</p><h1 className="mt-2 text-3xl font-black text-white">Attendance reports</h1><p className="mt-1 text-sm text-white/45">Generate summaries with Present, Late, Absent, totals, and per-person percentages.</p></div><div className="flex flex-wrap gap-2"><Button variant="glass" onClick={() => exportPdf('Student')}><Download size={15} /> Student PDF</Button><Button variant="glass" onClick={() => exportPdf('Faculty')}><Download size={15} /> Faculty PDF</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-4"><Metric label="Present" value={counts.present} tone="green" icon={CheckCircle2} /><Metric label="Late" value={counts.late} tone="amber" icon={Activity} /><Metric label="Absent" value={counts.absent} tone="rose" icon={AlertCircle} /><Metric label="Records" value={rows.length} tone="blue" icon={FileText} /></div>
    <div className={panelClass + ' p-5'}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><select className={inputClass} value={eventId} onChange={event => setEventId(event.target.value)}><option value="">All events</option>{state.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select><select className={inputClass} value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(value => <option key={value}>{value}</option>)}</select><input type="date" className={inputClass} value={startDate} onChange={event => setStartDate(event.target.value)} /><input type="date" className={inputClass} value={endDate} onChange={event => setEndDate(event.target.value)} /><select className={inputClass} value={role} onChange={event => setRole(event.target.value as typeof role)}><option>All</option><option>Student</option><option>Faculty</option></select></div><div className="mt-4 flex items-center gap-2 rounded-xl border border-blue-400/15 bg-blue-400/[0.06] p-3 text-xs text-blue-100/70"><BarChart3 size={16} /> Attendance percentage = events attended (Present or Late) ÷ required events × 100.</div></div>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]"><div className="overflow-x-auto rounded-2xl border border-white/[0.08]"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-white/[0.08] bg-white/[0.03] text-xs uppercase tracking-wider text-white/40"><tr><th className="px-5 py-4">Person</th><th className="px-5 py-4">Event</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Percentage</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{rows.map(row => <tr key={`${row.id}-${row.personId}`}><td className="px-5 py-4"><p className="font-semibold text-white">{row.name}</p><p className="text-xs text-white/40">{row.personId} · {row.department}</p></td><td className="px-5 py-4 text-white/60">{row.eventId}</td><td className="px-5 py-4"><StatusBadge status={statusTone(row.status)}>{row.status}</StatusBadge></td><td className="px-5 py-4 font-semibold text-blue-200">{getAttendancePercentage(row.personId, row.role, state)}%</td></tr>)}</tbody></table>{rows.length === 0 && <div className="p-8"><EmptyState message="No attendance rows match these report filters." /></div>}</div><div className={panelClass + ' p-5'}><h2 className="font-bold text-white">Per-person attendance</h2><p className="mt-1 text-xs text-white/40">Required events only; pending and cancelled events are excluded.</p><div className="mt-4 space-y-3">{state.users.filter(user => user.role !== 'Admin').map(user => { const percentage = getAttendancePercentage(user.id, user.role === 'Faculty' ? 'Faculty' : 'Student', state); return <div key={user.id}><div className="mb-1 flex justify-between text-xs"><span className="text-white/65">{user.name}</span><span className="font-bold text-blue-200">{percentage}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-blue-400" style={{ width: `${percentage}%` }} /></div></div>; })}</div></div></div>
  </section>;
}

function DashboardSection({ state, onNavigate }: { state: AdminState; onNavigate: (section: AdminSection) => void }) {
  const live = getLiveEvent(state);
  const counts = live ? getAttendanceCounts(live.id, state) : { present: 0, late: 0, absent: 0, total: 0 };
  const pending = state.events.filter(event => event.status === 'Pending');
  return <section className="space-y-6"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Administrator workspace</p><h1 className="mt-2 text-3xl font-black text-white">Attendance dashboard</h1><p className="mt-1 text-sm text-white/45">Monitor live attendance, manage accounts, schedule events, and review reports.</p></div><div className="flex flex-wrap gap-2"><Button variant="glass" onClick={() => onNavigate('users')}><Users size={16} /> Users</Button><Button onClick={() => onNavigate('events')}><Plus size={16} /> Create event</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Present" value={counts.present} tone="green" icon={CheckCircle2} /><Metric label="Late" value={counts.late} tone="amber" icon={Activity} /><Metric label="Absent" value={counts.absent} tone="rose" icon={AlertCircle} /><Metric label="Active events" value={state.events.filter(event => event.status === 'Ongoing' || event.status === 'Approved').length} tone="blue" icon={CalendarDays} /></div>
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]"><section className={panelClass + ' p-5'}><div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">Live event</p><h2 className="mt-1 text-xl font-bold text-white">{live?.name || 'No ongoing event'}</h2></div>{live && <StatusBadge status="warning">{live.status}</StatusBadge>}</div>{live ? <><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-white/35">Venue</p><p className="mt-1 font-semibold text-white/75">{live.venue}</p></div><div><p className="text-xs text-white/35">Date</p><p className="mt-1 font-semibold text-white/75">{live.date}</p></div><div><p className="text-xs text-white/35">Cut-off</p><p className="mt-1 font-semibold text-amber-200">{live.cutoff}</p></div><div><p className="text-xs text-white/35">Method</p><p className="mt-1 font-semibold text-white/75">{live.method}</p></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-blue-400" style={{ width: `${counts.total ? Math.round(((counts.present + counts.late) / counts.total) * 100) : 0}%` }} /></div><p className="mt-2 text-xs text-white/40">{counts.total} attendance records update as scans are recorded.</p><Button variant="glass" className="mt-5" onClick={() => onNavigate('attendance')}>Open attendance monitor <ArrowRight size={15} /></Button></> : <EmptyState message="Create or approve an event to begin live attendance monitoring." />}</section>
      <section className={panelClass + ' p-5'}><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">Approval queue</p><h2 className="mt-1 text-xl font-bold text-white">Pending events</h2></div><span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200">{pending.length}</span></div>{pending.length ? <div className="space-y-3">{pending.map(event => <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{event.name}</p><p className="text-xs text-white/40">{event.origin}</p></div><button type="button" onClick={() => onNavigate('events')} className="rounded-lg p-2 text-white/45 hover:bg-blue-400/10 hover:text-blue-200" title="Review event"><ArrowRight size={16} /></button></div>)}</div> : <EmptyState message="No event submissions are waiting for approval." />}</section></div>
    <section className={panelClass + ' p-5'}><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">Required administration</p><h2 className="mt-1 text-xl font-bold text-white">Workspace shortcuts</h2></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([{ id: 'users', label: 'Manage users', text: 'Accounts and RBAC', icon: Users }, { id: 'events', label: 'Manage events', text: 'Schedule and approve', icon: CalendarDays }, { id: 'attendance', label: 'Monitor attendance', text: 'Correct records', icon: ClipboardCheck }, { id: 'reports', label: 'Generate reports', text: 'PDF and percentages', icon: FileText }] as const).map(item => <button type="button" key={item.id} onClick={() => onNavigate(item.id)} className="flex items-center gap-3 rounded-xl border border-white/[0.07] p-4 text-left transition hover:border-blue-400/30 hover:bg-blue-400/[0.06]"><span className="rounded-lg bg-blue-400/10 p-2 text-blue-200"><item.icon size={17} /></span><span><span className="block text-sm font-semibold text-white">{item.label}</span><span className="block text-xs text-white/40">{item.text}</span></span></button>)}</div></section>
  </section>;
}



function FeedbackSection({ state }: { state: AdminState }) {
  const [selectedId, setSelectedId] = useState(state.forms[0]?.id || '');
  const selected = state.forms.find(form => form.id === selectedId);
  const [formTitle, setFormTitle] = useState('');
  const [formEventId, setFormEventId] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [questionText, setQuestionText] = useState('How would you rate the event?\nWhat can be improved?');
  const [error, setError] = useState('');
  const results = selectedId ? getFormResults(selectedId) : [];
  const selectForm = (form?: EvaluationForm) => { const nextId = form?.id || ''; setSelectedId(nextId); setFormTitle(form?.title || ''); setFormEventId(form?.eventId || state.events[0]?.id || ''); setFormActive(form?.active ?? true); setQuestionText(form?.questions.map(question => question.prompt).join('\n') || ''); setError(''); };
  const save = () => {
    const prompts = questionText.split('\n').map(prompt => prompt.trim()).filter(Boolean);
    if (!formTitle.trim() || !formEventId || !prompts.length) return setError('Add a title, event, and at least one question.');
    try { const existing = selected?.questions || []; const form = saveForm({ id: selectedId || undefined, title: formTitle, eventId: formEventId, active: formActive, questions: prompts.map((prompt, index) => ({ id: existing[index]?.id || `Q-${Date.now()}-${index}`, prompt, type: existing[index]?.type || (index === prompts.length - 1 ? 'text' : 'rating'), required: existing[index]?.required ?? index < 2 })) }); selectForm(form); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save form.'); }
  };
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Create · Configure · Review</p><h1 className="mt-2 text-3xl font-black text-white">Feedback & evaluations</h1><p className="mt-1 text-sm text-white/45">Create event forms, associate them with events, and review compiled attendee results.</p></div><Button variant="glass" onClick={() => selectForm()}><Plus size={16} /> New form</Button></div>
    <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]"><section className={panelClass + ' p-5'}><div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-blue-400/10 p-2.5 text-blue-200"><MessageSquare size={18} /></span><div><h2 className="font-bold text-white">Form builder</h2><p className="text-xs text-white/40">One question per line</p></div></div><div className="space-y-4"><label><span className={labelClass}>Form title</span><input className={inputClass} value={formTitle} onChange={event => setFormTitle(event.target.value)} placeholder="Event evaluation" /></label><label><span className={labelClass}>Associate with event</span><select className={inputClass} value={formEventId} onChange={event => setFormEventId(event.target.value)}><option value="">Select event</option>{state.events.filter(event => event.status !== 'Cancelled').map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label><label><span className={labelClass}>Questions</span><textarea className={inputClass} rows={6} value={questionText} onChange={event => setQuestionText(event.target.value)} placeholder="One question per line" /></label><label className="flex items-center gap-3 text-sm text-white/65"><input type="checkbox" checked={formActive} onChange={event => setFormActive(event.target.checked)} /> Form is active for attendees</label>{error && <p className="text-sm text-rose-200">{error}</p>}<div className="flex justify-end gap-3"><Button variant="glass" onClick={() => selectForm()}>Clear</Button><Button onClick={save}>{selectedId ? 'Save form' : 'Create form'}</Button></div></div></section>
      <section className={panelClass + ' p-5'}><div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-bold text-white">Compiled results</h2><p className="text-xs text-white/40">{selected ? `${results.length} attendee responses` : 'Select or create a form'}</p></div><select className={inputClass + ' max-w-56'} value={selectedId} onChange={event => selectForm(state.forms.find(form => form.id === event.target.value))}><option value="">Select form</option>{state.forms.map(form => <option key={form.id} value={form.id}>{form.title}</option>)}</select></div>{selected ? <>{selected.questions.map(question => <div key={question.id} className="mb-4 rounded-xl border border-white/[0.07] p-4"><p className="text-sm font-semibold text-white/80">{question.prompt}</p><div className="mt-3 space-y-2">{results.slice(0, 5).map(response => <div key={response.id} className="flex justify-between gap-3 text-xs"><span className="text-white/50">{response.attendeeName}</span><span className="text-right text-blue-200">{response.answers[question.id] || '—'}</span></div>)}</div></div>)}<div className="mt-5 flex justify-end"><Button variant="glass" className="text-rose-200" onClick={() => { if (window.confirm(`Delete ${selected.title}?`)) { removeForm(selected.id); selectForm(); } }}><Trash2 size={15} /> Delete form</Button></div></> : <EmptyState message="No evaluation form selected." />}</section></div>
  </section>;
}


export default function AdminWorkspace() {
  const state = useAdminState();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const pathnameSection = location.pathname.split('/').pop();
  const requested = searchParams.get('section') || pathnameSection;
  const section: AdminSection = requested === 'users' || requested === 'events' || requested === 'attendance' || requested === 'reports' || requested === 'feedback' ? requested : 'dashboard';
  const go = (next: AdminSection) => { navigate(`/admin/${next === 'dashboard' ? 'dashboard' : next}`); };
  const user = AuthService.getCurrentUser();
  return <div className="min-h-full"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Signed in as {user?.name || 'Administrator'}</p><p className="mt-1 text-sm text-white/45">Required Admin functions · functional requirements workspace</p></div><nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">{([{ id: 'dashboard', label: 'Dashboard' }, { id: 'users', label: 'Users' }, { id: 'events', label: 'Events' }, { id: 'attendance', label: 'Attendance' }, { id: 'reports', label: 'Reports' }, { id: 'feedback', label: 'Feedback' }] as const).map(item => <button type="button" key={item.id} onClick={() => go(item.id)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${section === item.id ? 'bg-blue-500/15 text-blue-200' : 'text-white/45 hover:bg-white/[0.06] hover:text-white'}`}>{item.label}</button>)}</nav></div>{section === 'dashboard' && <DashboardSection state={state} onNavigate={go} />}{section === 'users' && <UsersSection users={state.users} />}{section === 'events' && <EventsSection />}{section === 'attendance' && <AttendanceSection events={state.events} attendance={state.attendance} users={state.users} />}{section === 'reports' && <ReportsSection state={state} />}{section === 'feedback' && <FeedbackSection state={state} />}</div>;
}

