import { CalendarDays, CheckCircle2, Clock3, MapPin, QrCode, Ticket, TrendingUp } from 'lucide-react';
import type { AuthUser, EventRecord, PersonalAttendanceData } from '../../types/eventAttendance';

interface Props {
  user: AuthUser;
  events: EventRecord[];
  attendance: PersonalAttendanceData;
  onNavigate: (view: string) => void;
  onScan: () => void;
  onCertificate: (certificateId: string) => void;
}

const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function EventDashboard({ user, events, attendance, onNavigate, onScan, onCertificate }: Props) {
  const upcoming = events.filter(event => event.status === 'upcoming' || event.status === 'ongoing');
  const certificates = events.filter(event => event.certificate_id);
  return <div className="space-y-7">
    <section className="relative overflow-hidden rounded-3xl border border-[#F0DAC2] bg-gradient-to-br from-[#FFF7ED] via-[#FDFBF7] to-[#F6F5EF] p-7 shadow-[0_18px_44px_-26px_rgba(16,32,59,0.4)] sm:p-9">
      <div className="relative z-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#C2410C]">COT event attendance portal</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#10203B] sm:text-4xl">Welcome, {user.name.split(' ')[0]}.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#475569]">View upcoming events, confirm your participation when required, and record your own attendance through the event check-in method.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onScan} className="app-button-primary"><QrCode size={17} /> Scan event attendance</button>
          <button type="button" onClick={() => onNavigate('events')} className="app-button-secondary">Browse events <CalendarDays size={17} /></button>
        </div>
      </div>
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-orange-200/40 blur-3xl" />
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'Attendance percentage', value: `${attendance.summary.attendancePercentage}%`, icon: TrendingUp, tone: 'text-[#C2410C]' },
        { label: 'Present', value: attendance.summary.present, icon: CheckCircle2, tone: 'text-emerald-600' },
        { label: 'Late', value: attendance.summary.late, icon: Clock3, tone: 'text-amber-600' },
        { label: 'Upcoming / ongoing', value: upcoming.length, icon: CalendarDays, tone: 'text-violet-600' },
      ].map(({ label, value, icon: Icon, tone }) => <div key={label} className="app-card p-5">
        <Icon size={19} className={tone} />
        <p className="mt-5 text-3xl font-bold text-[#10203B]">{value}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#64748B]">{label}</p>
      </div>)}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
      <div className="app-card p-6">
        <div className="flex items-center justify-between gap-4"><div><p className="app-label">Next events</p><h2 className="app-section-title">Your event schedule</h2></div><button type="button" onClick={() => onNavigate('events')} className="rounded text-xs font-semibold text-[#C2410C] transition hover:text-[#9A3412] hover:underline focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2">View all</button></div>
        <div className="mt-5 space-y-3">
          {upcoming.slice(0, 4).map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-4">
            <div><p className="font-semibold text-[#10203B]">{event.name}</p><p className="mt-1 flex flex-wrap gap-3 text-xs text-[#64748B]"><span className="inline-flex items-center gap-1"><CalendarDays size={12} />{dateLabel(event.starts_at)}</span><span className="inline-flex items-center gap-1"><Clock3 size={12} />{timeLabel(event.starts_at)}</span><span className="inline-flex items-center gap-1"><MapPin size={12} />{event.venue}</span></p></div>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700">{event.status}</span>
          </div>)}
          {!upcoming.length && <p className="py-8 text-center text-sm text-[#64748B]">No upcoming events are published.</p>}
        </div>
      </div>
      <div className="app-card p-6">
        <div className="flex items-center gap-2"><Ticket size={18} className="text-[#C2410C]" /><h2 className="app-section-title">Participation certificates</h2></div>
        <p className="mt-2 text-xs leading-5 text-[#64748B]">Certificates are optional and appear only when an organizer issues one for an event you attended.</p>
        <div className="mt-5 space-y-2">
          {certificates.map(event => <div key={event.id} className="rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-3 text-sm text-[#334155]"><p>{event.name}</p><button type="button" onClick={() => event.certificate_id && onCertificate(event.certificate_id)} className="mt-2 rounded text-xs font-semibold text-emerald-700 transition hover:text-emerald-800 hover:underline focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2">Download certificate</button></div>)}
          {!certificates.length && <p className="rounded-xl border border-dashed border-[#D8DAD5] p-4 text-xs text-[#94A3B8]">No certificates are available yet.</p>}
        </div>
        <button type="button" onClick={() => onNavigate('history')} className="app-button-secondary mt-5 w-full">Open attendance history</button>
      </div>
    </section>
  </div>;
}

