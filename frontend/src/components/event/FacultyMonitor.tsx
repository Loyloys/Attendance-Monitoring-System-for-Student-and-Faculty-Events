import { BarChart3, CalendarDays, Download, MapPin, RefreshCw, Users } from 'lucide-react';
import type { EventRecord, MonitoredEventAttendance } from '../../types/eventAttendance';

interface Props {
  events: EventRecord[];
  selectedId: string;
  data: MonitoredEventAttendance | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
  loading: boolean;
}

export default function FacultyMonitor({ events, selectedId, data, onSelect, onRefresh, onDownload, loading }: Props) {
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="app-label">Authorized scope</p><h1 className="app-page-title">Monitor assigned events</h1><p className="app-page-subtitle">You can only view attendance for events you organize or supervise.</p></div><div className="flex gap-2"><button type="button" onClick={onRefresh} className="app-button-secondary"><RefreshCw size={16} /> Refresh</button><button type="button" onClick={onDownload} disabled={!selectedId} className="app-button-primary"><Download size={16} /> Export event PDF</button></div></div>
    <section className="app-card p-5"><label className="app-label" htmlFor="managed-event">Assigned event</label><select id="managed-event" value={selectedId} onChange={event => onSelect(event.target.value)} className="app-input"><option value="">Select an authorized event</option>{events.map(event => <option key={event.id} value={event.id}>{event.name} · {event.venue}</option>)}</select>{!events.length && <p className="mt-3 text-sm text-white/45">No events are assigned to your faculty account.</p>}</section>
    {loading && <div className="app-card p-10 text-center text-sm text-white/50">Loading authorized event attendance…</div>}
    {data && !loading && <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Present', data.summary.present, 'text-emerald-200'], ['Late', data.summary.late, 'text-amber-200'], ['Absent', data.summary.absent, 'text-rose-200'], ['Total attendees', data.summary.total, 'text-blue-200'],
    ].map(([label, value, tone]) => <div key={label} className="app-card p-5"><p className={`text-3xl font-bold ${tone}`}>{value}</p><p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{label}</p></div>)}</section><section className="app-card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] p-6"><div><h2 className="app-section-title">Attendance summary</h2><p className="mt-1 flex items-center gap-2 text-xs text-white/40"><CalendarDays size={13} />{data.event.name}<MapPin size={13} />{data.event.venue}</p></div><span className="inline-flex items-center gap-2 text-xs text-white/45"><Users size={14} />{data.summary.registered} registered student(s)</span></div><div className="app-table-wrap"><table className="app-table"><thead><tr><th>Attendee</th><th>ID</th><th>Role</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{data.attendees.map(record => <tr key={`${record.id}-${record.recordedAt}`}><td className="font-semibold text-white/80">{record.name}</td><td>{record.id}</td><td className="capitalize">{record.role}</td><td><span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">{record.status}</span></td><td>{new Date(record.recordedAt).toLocaleString()}</td></tr>)}</tbody></table></div>{!data.attendees.length && <div className="app-empty-state"><BarChart3 size={30} className="text-white/20" /><p className="mt-3 text-sm text-white/45">No attendance has been recorded for this event yet.</p></div>}</section></>}
  </div>;
}

