import { CalendarDays, CheckCircle2, Clock3, Download, FileDown } from 'lucide-react';
import type { PersonalAttendanceData } from '../../types/eventAttendance';

interface Props {
  data: PersonalAttendanceData;
  onDownload: () => Promise<void>;
}

const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function AttendanceHistory({ data, onDownload }: Props) {
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="app-label">Personal record</p><h1 className="app-page-title">My event attendance</h1><p className="app-page-subtitle">Only your own event attendance is shown here.</p></div><button type="button" onClick={onDownload} className="app-button-primary"><FileDown size={17} /> Export my PDF</button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Attendance percentage', `${data.summary.attendancePercentage}%`], ['Present', data.summary.present], ['Late', data.summary.late], ['Absent', data.summary.absent],
    ].map(([label, value]) => <div key={label} className="app-card p-5"><p className="text-3xl font-bold text-white">{value}</p><p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{label}</p></div>)}</div>
    <section className="app-card overflow-hidden"><div className="border-b border-white/[0.07] p-6"><h2 className="app-section-title">Event attendance history</h2><p className="mt-1 text-xs text-white/40">Present, late, and absent statuses are calculated by the server.</p></div><div className="app-table-wrap"><table className="app-table"><thead><tr><th>Event</th><th>Date and time</th><th>Status</th><th>Method</th><th>Recorded</th></tr></thead><tbody>{data.records.map(record => <tr key={record.id}><td className="font-semibold text-white/80">{record.eventName}</td><td><span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-blue-200" />{dateLabel(record.eventDate)} · {timeLabel(record.eventDate)}</span></td><td><Status status={record.status} /></td><td className="capitalize">{record.method === 'rfid' ? 'RFID / ID' : record.method}</td><td>{dateLabel(record.recordedAt)}</td></tr>)}</tbody></table></div>{!data.records.length && <div className="app-empty-state"><Clock3 size={30} className="text-white/20" /><p className="mt-3 text-sm text-white/45">No event attendance has been recorded yet.</p></div>}</section>
    <p className="flex items-center gap-2 text-xs text-white/35"><Download size={14} /> The PDF is generated on the server and always limited to your account.</p>
  </div>;
}

function Status({ status }: { status: 'present' | 'late' | 'absent' }) {
  const styles = { present: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100', late: 'border-amber-300/20 bg-amber-300/10 text-amber-100', absent: 'border-rose-300/20 bg-rose-300/10 text-rose-100' };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${styles[status]}`}><CheckCircle2 size={12} />{status}</span>;
}

