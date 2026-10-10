import { BarChart3, CalendarDays, Download, MapPin, RefreshCw, Users } from 'lucide-react';
import type { EventRecord, MonitoredEventAttendance, MonitoredSession } from '../../types/eventAttendance';
import { formatVerified, locationBadgeText, locationBadgeTone, PAUSE_TEXT } from '../../utils/attendanceTracking';

interface Props {
  events: EventRecord[];
  selectedId: string;
  data: MonitoredEventAttendance | null;
  /** GST007: live tracking sessions for the selected event. */
  sessions: MonitoredSession[];
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
  loading: boolean;
}

const DURATION_LABEL: Record<MonitoredSession['durationOutcome'], string> = {
  met: 'Required duration met',
  in_progress: 'In progress',
  incomplete: 'Incomplete',
  unconfigured: 'Not configured',
};

function AttendeeRow({ record }: { record: MonitoredEventAttendance['attendees'][number] }) {
  return (
    <tr>
      <td className="font-semibold text-[#10203B]">{record.name}</td>
      <td>{record.id}</td>
      <td className="capitalize">{record.role}</td>
      <td>
        <span className="rounded-full border border-[#E2E3DF] bg-[#FAF9F5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#334155]">
          {record.status}
        </span>
      </td>
      <td>{new Date(record.recordedAt).toLocaleString()}</td>
    </tr>
  );
}

function LocationBadge({ state }: { state: MonitoredSession['locationState'] }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${locationBadgeTone(state)}`}>
      {locationBadgeText(state)}
    </span>
  );
}

/**
 * GST007: one attendee's live row.
 *
 * Every figure below is server-verified. The browser performs no attendance
 * accounting, so this table is a read-only view of the server's session state.
 * Location state is deliberately a separate column from the outcome: being
 * Inside is a position fact and does not by itself mean Present or Met.
 */
function SessionRow({ session }: { session: MonitoredSession }) {
  return (
    <tr>
      <td className="font-semibold text-[#10203B]">
        {session.name}
        <span className="block text-xs font-normal capitalize text-[#64748B]">{session.role}</span>
      </td>
      <td><LocationBadge state={session.locationState} /></td>
      <td>
        <span className="capitalize">{session.state}</span>
        {session.pauseReason && (
          <span className="block text-xs text-[#64748B]">
            {PAUSE_TEXT[session.pauseReason] ?? session.pauseReason}
          </span>
        )}
      </td>
      <td className="text-xs text-[#64748B]">
        {session.lastVerifiedAt ? new Date(session.lastVerifiedAt).toLocaleTimeString() : 'never'}
      </td>
      <td className="font-mono font-semibold">{formatVerified(session.creditedSeconds)}</td>
      <td>{session.requiredMinutes ? `${session.requiredMinutes} min` : 'Not configured'}</td>
      <td>
        {session.arrival === 'late' ? 'Late' : 'On time'}
        <span className="block text-xs text-[#64748B]">{DURATION_LABEL[session.durationOutcome]}</span>
      </td>
    </tr>
  );
}

export default function FacultyMonitor({ events, selectedId, data, sessions, onSelect, onRefresh, onDownload, loading }: Props) {
  return <MonitorLayout
    events={events}
    selectedId={selectedId}
    data={data}
    sessions={sessions}
    onSelect={onSelect}
    onRefresh={onRefresh}
    onDownload={onDownload}
    loading={loading}
  />;
}

function EventPicker({ events, selectedId, onSelect }: { events: EventRecord[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section className="app-card p-5">
      <label className="app-label" htmlFor="managed-event">Assigned event</label>
      <select id="managed-event" value={selectedId} onChange={event => onSelect(event.target.value)} className="app-input">
        <option value="">Select an authorized event</option>
        {events.map(event => <option key={event.id} value={event.id}>{event.name} · {event.venue}</option>)}
      </select>
      {!events.length && (
        <p className="mt-3 text-sm text-[#64748B]">No events are assigned to your faculty account.</p>
      )}
    </section>
  );
}

function SummaryTiles({ data }: { data: MonitoredEventAttendance }) {
  const tiles: [string, number, string][] = [
    ['Present', data.summary.present, 'text-emerald-600'],
    ['Late', data.summary.late, 'text-amber-600'],
    ['Absent', data.summary.absent, 'text-rose-600'],
    ['Total attendees', data.summary.total, 'text-[#C2410C]'],
  ];
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(([label, value, tone]) => (
        <div key={label} className="app-card p-5">
          <p className={`text-3xl font-bold ${tone}`}>{value}</p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#64748B]">{label}</p>
        </div>
      ))}
    </section>
  );
}

function AttendanceTable({ data }: { data: MonitoredEventAttendance }) {
  return (
    <section className="app-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E3DF] p-6">
        <div>
          <h2 className="app-section-title">Attendance summary</h2>
          <p className="mt-1 flex items-center gap-2 text-xs text-[#64748B]">
            <CalendarDays size={13} />{data.event.name}<MapPin size={13} />{data.event.venue}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-[#64748B]">
          <Users size={14} />{data.summary.registered} registered student(s)
        </span>
      </div>
      <div className="app-table-wrap">
        <table className="app-table">
          <thead><tr><th>Attendee</th><th>ID</th><th>Role</th><th>Status</th><th>Recorded</th></tr></thead>
          <tbody>
            {data.attendees.map(record => (
              <AttendeeRow key={`${record.id}-${record.recordedAt}`} record={record} />
            ))}
          </tbody>
        </table>
      </div>
      {!data.attendees.length && (
        <div className="app-empty-state">
          <BarChart3 size={30} className="text-[#CBD5E1]" />
          <p className="mt-3 text-sm text-[#64748B]">No attendance has been recorded for this event yet.</p>
        </div>
      )}
    </section>
  );
}

/** GST007: the live tracking table. Refreshed by the parent, never polled here. */
function TrackingTable({ sessions }: { sessions: MonitoredSession[] }) {
  return (
    <section className="app-card overflow-hidden">
      <div className="border-b border-[#E2E3DF] p-6">
        <h2 className="app-section-title">Live attendance tracking</h2>
        <p className="mt-1 text-xs text-[#64748B]">
          Verified in-zone time reported by each attendee&apos;s device. Location state and
          attendance outcome are shown separately.
        </p>
      </div>
      {sessions.length > 0 ? (
        <div className="app-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Attendee</th>
                <th>Location</th>
                <th>Tracking</th>
                <th>Last verification</th>
                <th>Verified time</th>
                <th>Required</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => <SessionRow key={session.id} session={session} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="app-empty-state">
          <Users size={30} className="text-[#CBD5E1]" />
          <p className="mt-3 text-sm text-[#64748B]">
            Nobody is tracking attendance time for this event yet.
          </p>
        </div>
      )}
    </section>
  );
}

function MonitorLayout({ events, selectedId, data, sessions, onSelect, onRefresh, onDownload, loading }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="app-label">Authorized scope</p>
          <h1 className="app-page-title">Monitor assigned events</h1>
          <p className="app-page-subtitle">You can only view attendance for events you organize or supervise.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onRefresh} className="app-button-secondary"><RefreshCw size={16} /> Refresh</button>
          <button type="button" onClick={onDownload} disabled={!selectedId} className="app-button-primary"><Download size={16} /> Export event PDF</button>
        </div>
      </div>

      <EventPicker events={events} selectedId={selectedId} onSelect={onSelect} />

      {loading && (
        <div className="app-card p-10 text-center text-sm text-[#64748B]">
          Loading authorized event attendance…
        </div>
      )}

      {data && !loading && (
        <>
          <SummaryTiles data={data} />
          <AttendanceTable data={data} />
        </>
      )}

      {selectedId && !loading && <TrackingTable sessions={sessions} />}
    </div>
  );
}
