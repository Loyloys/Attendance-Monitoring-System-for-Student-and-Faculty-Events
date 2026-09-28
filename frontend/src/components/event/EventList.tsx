import { CalendarDays, Check, Clock3, Hourglass, MapPin, QrCode, UserCheck } from 'lucide-react';
import EventQRCode from '../common/EventQRCode';
import type { EventRecord } from '../../types/eventAttendance';

interface Props {
  events: EventRecord[];
  onRegister: (event: EventRecord) => Promise<void>;
  onScan: () => void;
}

const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const methodLabel = (method: string) => method === 'rfid' ? 'RFID / ID' : method === 'barcode' ? 'Barcode' : 'QR code';
// GST002: duration comes from the server (duration_minutes) so the browser never
// recomputes it from two timestamps, which is where timezone mistakes creep in.
const durationLabel = (minutes: number) => minutes >= 60
  ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim()
  : `${minutes} min`;

export default function EventList({ events, onRegister, onScan }: Props) {
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="app-label">Event directory</p><h1 className="app-page-title">Available events</h1><p className="app-page-subtitle">Every attendance action below is tied to the selected event.</p></div><button type="button" onClick={onScan} className="app-button-primary"><QrCode size={17} /> Scan attendance</button></div>
    {events.length === 0 && <div className="app-card app-empty-state"><CalendarDays size={32} className="text-[#CBD5E1]" /><p className="mt-4 font-semibold text-[#334155]">No events are available.</p></div>}
    <div className="grid gap-5 xl:grid-cols-2">
      {events.map(event => <article key={event.id} className="app-card flex flex-col p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="app-label">{event.audience === 'all' ? 'COT event' : `${event.audience} event`}</p><h2 className="text-xl font-bold text-[#10203B]">{event.name}</h2></div><span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700">{event.status}</span></div>
        <p className="mt-4 min-h-12 text-sm leading-6 text-[#334155]">{event.description || 'Event details are available from the organizer.'}</p>
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm"><Info icon={CalendarDays} label="Date" value={dateLabel(event.starts_at)} /><Info icon={Clock3} label="Time" value={`${timeLabel(event.starts_at)} – ${timeLabel(event.ends_at)}`} /><Info icon={MapPin} label="Venue" value={event.venue} /><Info icon={Hourglass} label="Required duration" value={durationLabel(event.duration_minutes)} /><Info icon={QrCode} label="Method" value={methodLabel(event.attendance_method)} /></div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#E2E3DF] pt-4 text-xs text-[#64748B]"><span>Organizer: {event.organizer_name}</span>{event.registration_required && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">Registration required</span>}</div>
        {event.is_organizer && event.attendance_method === 'qr' && (event.status === 'ongoing' || event.status === 'upcoming') && <EventQRCode eventId={event.id} eventName={event.name} />}
        <div className="mt-auto flex flex-wrap gap-3 pt-5">
          {event.registration_required && event.can_register && <button type="button" onClick={() => onRegister(event)} className="app-button-primary"><Check size={16} /> Confirm registration</button>}
          {event.registration_status === 'registered' && <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100"><UserCheck size={15} /> Registered</span>}
          {event.attendance_status && <span className="inline-flex items-center gap-2 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] px-3 py-2 text-xs font-semibold capitalize text-[#334155]">{event.attendance_status} recorded</span>}
        </div>
      </article>)}
    </div>
  </div>;
}

function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex items-start gap-2"><Icon size={16} className="mt-0.5 shrink-0 text-[#C2410C]" /><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</p><p className="mt-1 text-sm text-[#334155]">{value}</p></div></div>;
}

