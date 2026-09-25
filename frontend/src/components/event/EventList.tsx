import { CalendarDays, Check, Clock3, MapPin, QrCode, UserCheck } from 'lucide-react';
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

export default function EventList({ events, onRegister, onScan }: Props) {
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="app-label">Event directory</p><h1 className="app-page-title">Available events</h1><p className="app-page-subtitle">Every attendance action below is tied to the selected event.</p></div><button type="button" onClick={onScan} className="app-button-primary"><QrCode size={17} /> Scan attendance</button></div>
    {events.length === 0 && <div className="app-card app-empty-state"><CalendarDays size={32} className="text-white/20" /><p className="mt-4 font-semibold text-white/70">No events are available.</p></div>}
    <div className="grid gap-5 xl:grid-cols-2">
      {events.map(event => <article key={event.id} className="app-card flex flex-col p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="app-label">{event.audience === 'all' ? 'COT event' : `${event.audience} event`}</p><h2 className="text-xl font-bold text-white">{event.name}</h2></div><span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-100">{event.status}</span></div>
        <p className="mt-4 min-h-12 text-sm leading-6 text-white/55">{event.description || 'Event details are available from the organizer.'}</p>
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm"><Info icon={CalendarDays} label="Date" value={dateLabel(event.starts_at)} /><Info icon={Clock3} label="Time" value={`${timeLabel(event.starts_at)} – ${timeLabel(event.ends_at)}`} /><Info icon={MapPin} label="Venue" value={event.venue} /><Info icon={QrCode} label="Method" value={methodLabel(event.attendance_method)} /></div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4 text-xs text-white/45"><span>Organizer: {event.organizer_name}</span>{event.registration_required && <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-100">Registration required</span>}</div>
        {event.is_organizer && event.attendance_method === 'qr' && (event.status === 'ongoing' || event.status === 'upcoming') && <EventQRCode eventId={event.id} eventName={event.name} />}
        <div className="mt-auto flex flex-wrap gap-3 pt-5">
          {event.registration_required && event.can_register && <button type="button" onClick={() => onRegister(event)} className="app-button-primary"><Check size={16} /> Confirm registration</button>}
          {event.registration_status === 'registered' && <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100"><UserCheck size={15} /> Registered</span>}
          {event.attendance_status && <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold capitalize text-white/70">{event.attendance_status} recorded</span>}
        </div>
      </article>)}
    </div>
  </div>;
}

function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex items-start gap-2"><Icon size={16} className="mt-0.5 shrink-0 text-blue-200" /><div><p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{label}</p><p className="mt-1 text-sm text-white/75">{value}</p></div></div>;
}

