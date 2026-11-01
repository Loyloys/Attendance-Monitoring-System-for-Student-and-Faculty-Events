import { CalendarDays, Check, Clock3, Hourglass, MapPin, QrCode, Timer, UserCheck } from 'lucide-react';
import EventQRCode from '../common/EventQRCode';
import type { EventRecord } from '../../types/eventAttendance';
import { canShowAttendanceAction, durationLabel, registrationLabel, requiredAttendanceLabel } from '../../utils/eventLabels';
import { eventDateLabel, eventTimeLabel } from '../../utils/eventTime';

interface Props {
  events: EventRecord[];
  onRegister: (event: EventRecord) => Promise<void>;
  /**
   * Opens the scanner.
   *
   * With no argument this is the GENERAL scanner, which keeps its existing
   * behaviour: the person picks the event inside it, so it can record any event
   * they are eligible for.
   *
   * With an event id it is opened ALREADY SCOPED to that event, which is what a
   * card-level button uses. Scoping only preselects the event - it must not
   * change which codes are acceptable, so a QR belonging to a different event is
   * still rejected rather than silently recording against this one.
   */
  onScan: (eventId?: string) => void;
  /**
   * GST016: archived events the signed-in person registered for or attended.
   * Rendered read-only: no registration or check-in actions, only the event's
   * date, time, venue and the person's own registration/attendance status.
   */
  archivedEvents?: EventRecord[];
  /**
   * When true, this list renders ONLY the archived ("Events Attended")
   * section: its own header, the read-only archived events, and an empty state
   * when there are none. Available and completed sections are hidden. Used by
   * the separate /portal?view=attended page so archived history is not mixed
   * with the active event directory.
   */
  archivedOnly?: boolean;
}

const dateLabel = eventDateLabel;
const timeLabel = eventTimeLabel;
const methodLabel = (method: string) => method === 'rfid' ? 'RFID / ID' : method === 'barcode' ? 'Barcode' : 'QR code';

const sectionTitle = (status: EventRecord['status']) => status === 'completed' ? 'Completed events' : 'Available events';

export default function EventList({ events, onRegister, onScan, archivedEvents = [], archivedOnly = false }: Props) {
  const available = events.filter(event => event.status === 'upcoming' || event.status === 'ongoing');
  const completed = events.filter(event => event.status === 'completed');

  // GST016: Events Attended page — render ONLY the archived section, read-only.
  if (archivedOnly) {
    return <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="app-label">Event history</p><h1 className="app-page-title">Events Attended</h1><p className="app-page-subtitle">Events you registered for or attended that have been archived by an administrator. These are read-only records.</p></div></div>
        {archivedEvents.length === 0 ? <div className="app-card app-empty-state"><Clock3 size={32} className="text-[#CBD5E1]" /><p className="mt-4 font-semibold text-[#334155]">You have no archived events.</p><p className="mt-2 text-sm text-[#64748B]">Events you registered for or attended appear here after an administrator archives them.</p></div> : <div className="grid gap-5 xl:grid-cols-2">{archivedEvents.map(event => renderEventCard(event, async () => { }, async () => { }))}</div>}
      </div>
    </div>;
  }

  return <div className="space-y-6">
    {/* Available events: upcoming and active events only. */}
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="app-label">Event directory</p><h1 className="app-page-title">{sectionTitle('upcoming')}</h1><p className="app-page-subtitle">Upcoming and active events you can register for and check in to.</p></div><button type="button" onClick={() => onScan()} className="app-button-primary"><QrCode size={17} /> Scan attendance</button></div>
      {available.length === 0 ? <div className="app-card app-empty-state"><CalendarDays size={32} className="text-[#CBD5E1]" /><p className="mt-4 font-semibold text-[#334155]">No events are available.</p></div> : <div className="grid gap-5 xl:grid-cols-2">{available.map(event => renderEventCard(event, onRegister, onScan))}</div>}
    </div>

    {/* Completed events: events whose end date and time have already passed. */}
    {completed.length > 0 && <div className="space-y-4">
      <div><p className="app-label">Past events</p><h2 className="app-page-title">{sectionTitle('completed')}</h2><p className="app-page-subtitle">These events have ended and no longer accept check-ins.</p></div>
      <div className="grid gap-5 xl:grid-cols-2">{completed.map(event => renderEventCard(event, onRegister, onScan))}</div>
    </div>}

  </div>;
}

function renderEventCard(event: EventRecord, onRegister: (event: EventRecord) => Promise<void>, onScan: (eventId?: string) => void) {
  return <article key={event.id} className="app-card flex flex-col p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="app-label">{event.audience === 'all' ? 'COT event' : `${event.audience} event`}</p><h2 className="text-xl font-bold text-[#10203B]">{event.name}</h2></div><span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700">{event.status}</span></div>
        <p className="mt-4 min-h-12 text-sm leading-6 text-[#334155]">{event.description || 'Event details are available from the organizer.'}</p>
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm"><Info icon={CalendarDays} label="Date" value={dateLabel(event.starts_at)} /><Info icon={Clock3} label="Time" value={`${timeLabel(event.starts_at)} – ${timeLabel(event.ends_at)}`} /><Info icon={MapPin} label="Venue" value={event.venue} /><Info icon={QrCode} label="Method" value={methodLabel(event.attendance_method)} /><Info icon={Hourglass} label="Event length" value={durationLabel(event.duration_minutes)} /><Info icon={Timer} label="Required attendance" value={requiredAttendanceLabel(event.required_attendance_minutes)} /></div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#E2E3DF] pt-4 text-xs text-[#64748B]"><span>Organizer: {event.organizer_name}</span>{registrationLabel(event) === 'Registration required' && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">Registration required</span>}{registrationLabel(event) === 'Registration not required' && <span className="rounded-full border border-[#E2E3DF] bg-[#FAF9F5] px-2 py-1 text-[#475569]">Registration not required</span>}</div>
        {event.is_organizer && event.attendance_method === 'qr' && (event.status === 'ongoing' || event.status === 'upcoming') && <EventQRCode eventId={event.id} eventName={event.name} />}
        <div className="mt-auto flex flex-wrap gap-3 pt-5">
          {/*
            REGISTRATION IS ALWAYS EXPLAINED, NEVER SILENTLY OMITTED.

            This used to render the button only when `registration_required &&
            can_register`. That made the action vanish whenever registration was
            required but currently impossible, while the badge above still said
            "Registration required" - a dead end, because scanning then refused
            with "Register for this event before checking in." and nothing on the
            screen could satisfy that.

            The three states are now explicit and mutually exclusive:
              registered  -> the status is shown
              open        -> the action is offered
              closed      -> the server's reason is shown in its place
            The reason text is the server's own, not a second copy of its rule.
          */}
          {event.registration_status === 'registered'
            ? <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100" data-testid="registration-status"><UserCheck size={15} /> Registered</span>
            : event.registration_required && event.can_register
              ? <button type="button" onClick={() => onRegister(event)} className="app-button-primary" data-testid="register-event"><Check size={16} /> Confirm registration</button>
              : event.registration_required && event.registration_unavailable_reason
                ? <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" data-testid="registration-closed-reason">{event.registration_unavailable_reason}</span>
                : null}
          {event.attendance_status && <span className="inline-flex items-center gap-2 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] px-3 py-2 text-xs font-semibold capitalize text-[#334155]">{event.attendance_status} recorded</span>}
          {/* The attendance action, shown only when the SERVER says check-in is
              open. This does not restate or re-derive `can_check_in`: the
              window, registration and role rules behind it stay exactly as the
              server computes them, so this button can never offer an action the
              API would refuse. */}
          {!event.attendance_status && !canShowAttendanceAction(event) && (event.registration_status === 'registered' || !event.registration_required) && <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" data-testid="attendance-not-available">Attendance for this event is not yet available. Please wait until the administrator opens attendance.</span>}
          {canShowAttendanceAction(event) && <button type="button" onClick={() => onScan(event.id)} className="app-button-primary" data-testid={`scan-${event.id}`}><QrCode size={16} /> Scan attendance for this event</button>}
        </div>
      </article>;
}

function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex items-start gap-2"><Icon size={16} className="mt-0.5 shrink-0 text-[#C2410C]" /><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</p><p className="mt-1 text-sm text-[#334155]">{value}</p></div></div>;
}
