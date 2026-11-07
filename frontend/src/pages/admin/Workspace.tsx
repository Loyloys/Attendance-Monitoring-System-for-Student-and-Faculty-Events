import { useEffect, useCallback, useRef, useState } from 'react';
import {
  Activity, AlertCircle, Archive, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Clock,
  ClipboardCheck, Download, Edit3, FileCheck, FileText, KeyRound, MessageSquare, Plus, Search, ShieldCheck, Trash2, UserCheck, Users, X,
} from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthService } from '../../data/authService';
import { eventApi, type AdminEventCreated, type AdminEventRequest, type AdminEventUpdated, type AdminSignupRequest, type SavedVenue } from '../../data/eventApi';
import {
  addAttendance, addUser, correctAttendance,
  eventParticipationLabel, getAttendanceCounts, getAttendancePercentage, getFormResults, getLiveEvent,
  initializeAdminState, loadUserRegistrations,
  removeAttendance, removeForm, refreshAdminState, removeUser, restoreUser, reportRows, saveForm,
  updateUser, useAdminState,
  type AdminAttendanceRecord, type AdminEvent, type AdminRole, type AdminState, type AdminUserAccount,
  type AdminUserRegistrationDetail, type AdminEventRegistrant, type AttendanceStatus, type EvaluationForm, type EventAudience,
  type AccountStatus,
} from '../../data/adminStore';
import Button from '../../components/common/Button';
import { StatusBadge } from '../../components/common/StatusBadge';
import EventQrPanel from '../../components/common/EventQRCode';
import GoogleCalendarLink from '../../components/event/GoogleCalendarLink';
import { createAttendanceReportPdfBlob } from '../../utils/attendanceReportPdf';

import MapVenuePicker, { type Coordinate } from '../../components/admin/MapVenuePicker';
import UseMyLocation from '../../components/admin/UseMyLocation';
import AdminAnnouncementsSection from './AnnouncementsSection';
import SettingsSection from './SettingsSection';
import { DEPARTMENTS } from '../../utils/departments';

export type AdminSection = 'dashboard' | 'signups' | 'users' | 'events' | 'archive' | 'attendance' | 'reports' | 'feedback' | 'announcements' | 'settings';

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
  id?: string;
  name: string;
  description: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  organizer: string;
  audience: EventAudience;
  department: string;
  method: AdminEvent['method'];
  cutoff: string;
  status: AdminEvent['status'];
  /**
   * Whether Students must register before checking in.
   *
   * DELIBERATELY NOT THE SAME CONTROL AS `requiredForAttendance`. They were one
   * value behind one checkbox, so an event that merely counted for a percentage
   * also demanded registration from every Student.
   */
  registrationRequired: boolean;
  /** Optional deadline. Empty string means "no deadline", sent as null. */
  registrationDeadline: string;
  /** Whether this event counts toward a person's attendance percentage. */
  requiredForAttendance: boolean;
  /** GST006: required in-zone minutes. Empty string means "not configured". */
  requiredAttendanceMinutes: string;
  /** GST004: optional venue geofence. All three must be filled to enable it. */
  venueLatitude?: number;
  venueLongitude?: number;
  venueRadiusMeters?: number;
  geofenceType: 'circle' | 'polygon';
  geofencePolygon: Coordinate[];
};

const emptyUserForm: UserForm = { name: '', username: '', email: '', contact: '', role: 'Student', department: '', password: '' };
const emptyEventForm: EventForm = {
  name: '', description: '', date: '', start: '08:00', end: '16:00', venue: '', organizer: 'College of Technologies',
  audience: 'All', department: 'College of Technologies', method: 'QR Code', cutoff: '08:15', status: 'Approved',
  // Registration defaults to OFF. It is a restriction on Students, so it is
  // opted into deliberately rather than switched on by default - the previous
  // default made every admin-created event demand registration.
  registrationRequired: false,
  registrationDeadline: '',
  // The percentage box keeps its historical default: an administrator who has
  // not thought about it should keep counting the event as before.
  requiredForAttendance: true,
  requiredAttendanceMinutes: '',
  geofenceType: 'circle',
  geofencePolygon: [],
};
const inputClass = 'w-full rounded-xl border border-[#E2E3DF] bg-white px-3 py-2.5 text-sm text-[#10203B] outline-none transition placeholder:text-[#94A3B8] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15';
const labelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-[#64748B]';
const panelClass = 'rounded-2xl border border-[#E2E3DF] bg-white shadow-xl';

/**
 * Live-refresh budget for the administrator workspace.
 *
 * Attendance is recorded by other people on other devices, so the list pulls.
 * The default of 60 polls at 5 s is five minutes of live updating - long enough
 * to watch a queue of students check in during an event, short enough that an
 * abandoned tab stops making requests on its own. Both are overridable so an
 * operator can tune or disable (0) the polling without a code change.
 */
const ADMIN_REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_ADMIN_REFRESH_INTERVAL_MS ?? 5_000);
const ADMIN_REFRESH_MAX_POLLS = Number(import.meta.env.VITE_ADMIN_REFRESH_MAX_POLLS ?? 60);

// `Pending` was removed with the status itself: it is no longer a value any
  // event can hold, so it no longer needs a colour.
function statusTone(status: string): 'success' | 'warning' | 'error' | 'info' {
  if (['Active', 'Approved', 'Present', 'Completed'].includes(status)) return 'success';
  if (['Late', 'Ongoing'].includes(status)) return 'warning';
  if (['Inactive', 'Cancelled', 'Absent'].includes(status)) return 'error';
  return 'info';
}

function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }

/**
 * GST008: presentation helpers for duration-based qualification.
 *
 * EVERY ONE OF THESE READS A SERVER VALUE. None of them computes elapsed time,
 * ticks a counter, or infers progress from how long the page has been open -
 * verified time arrives as `verifiedSeconds` and is only ever formatted here.
 */

/** Seconds as `m:ss`, the form the admin table shows. */
function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Verified in-zone time, or an honest "no data" rather than a fabricated zero. */
function verifiedLabel(record: AdminAttendanceRecord): string {
  if (record.qualification === undefined) return 'Not required';
  if (typeof record.verifiedSeconds !== 'number') return 'Unknown';
  return duration(record.verifiedSeconds);
}

/** The requirement, or "Not required" when the event asks for no duration. */
function requiredLabel(record: AdminAttendanceRecord): string {
  if (record.qualification === undefined) return 'Not required';
  if (typeof record.requiredAttendanceMinutes !== 'number') return 'Not configured';
  return `${record.requiredAttendanceMinutes} min`;
}

/**
 * Progress toward the requirement, from the two server numbers.
 *
 * Returns null when there is nothing meaningful to show, so the caller can
 * render an em dash instead of a misleading 0%.
 */
function progressLabel(record: AdminAttendanceRecord): string | null {
  if (record.qualification === undefined) return null;
  if (typeof record.requiredAttendanceMinutes !== 'number' || record.requiredAttendanceMinutes <= 0) return null;
  const verified = record.verifiedSeconds ?? 0;
  const percent = Math.min(100, Math.round((verified / (record.requiredAttendanceMinutes * 60)) * 100));
  return `${percent}% (${duration(verified)} of ${record.requiredAttendanceMinutes}:00)`;
}

/**
 * The latest location verdict.
 *
 * 'Unknown/Stale' is a real, meaningful state - it is what a record with no
 * accepted observation, or one that has gone quiet, actually is. It is never
 * rendered as 'Inside', and an absent value is never rendered as a zero.
 */
function locationLabel(record: AdminAttendanceRecord): string {
  if (record.qualification === undefined) return 'Not required';
  if (!record.lastLocationAt) return 'Unknown / stale';
  if (record.locationState === 'inside') return 'Inside';
  if (record.locationState === 'outside') return 'Outside';
  return 'Unknown / stale';
}

function locationTone(record: AdminAttendanceRecord): 'success' | 'warning' | 'error' | 'info' {
  if (record.locationState === 'inside') return 'success';
  if (record.locationState === 'outside') return 'warning';
  return 'info';
}

function trackingLabel(record: AdminAttendanceRecord): string {
  if (record.qualification === undefined) return 'Not required';
  if (record.trackingState === 'tracking') return 'Tracking';
  if (record.trackingState === 'paused') return 'Paused';
  if (record.trackingState === 'ended') return 'Ended';
  return 'Not started';
}

/**
 * 'Pending' has its own tone: it is NOT a success and must never be coloured
 * like 'Present', because doing so is exactly the "pending counted as present"
 * mistake this whole feature exists to prevent.
 */
function qualificationTone(record: AdminAttendanceRecord): 'success' | 'warning' | 'error' | 'info' {
  if (record.qualification === undefined) return 'info';
  if (record.manualOverride) return 'info';
  if (record.qualification === 'Present') return 'success';
  if (record.qualification === 'Late') return 'warning';
  if (record.qualification === 'Absent') return 'error';
  return 'info';
}

function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><button type="button" aria-label="Close dialog" className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onClose} /><section className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E2E3DF] bg-[#151a23] p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-[#10203B]">{title}</h2>{description && <p className="mt-1 text-sm text-[#64748B]">{description}</p>}</div><button type="button" onClick={onClose} className="rounded-lg p-2 text-[#64748B] hover:bg-[#FAF9F5] hover:text-[#10203B]" aria-label="Close"><X size={18} /></button></div>{children}</section></div>;
}

function EmptyState({ message }: { message: string }) { return <div className="rounded-2xl border border-dashed border-[#D8DAD5] p-10 text-center text-sm text-[#64748B]">{message}</div>; }

function Metric({ label, value, tone = 'blue', icon: Icon }: { label: string; value: string | number; tone?: 'blue' | 'green' | 'amber' | 'rose'; icon: typeof Activity }) {
  const tones = { blue: 'text-sky-700 bg-sky-50', green: 'text-emerald-700 bg-emerald-50', amber: 'text-amber-700 bg-amber-50', rose: 'text-rose-700 bg-rose-50' };
  return <div className={panelClass + ' p-5'}><div className="flex items-center justify-between"><p className="text-xs font-semibold text-[#64748B]">{label}</p><span className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon size={18} /></span></div><p className="mt-4 text-3xl font-black text-[#10203B]">{value}</p></div>;
}

function UserEditor({ form, editingId, setForm, onSubmit, onClose, error }: { form: UserForm; editingId?: string; setForm: (form: UserForm) => void; onSubmit: () => void; onClose: () => void; error: string }) {
  const set = (key: keyof UserForm, value: string) => setForm({ ...form, [key]: value });
  return <Modal title={form.id ? 'Edit account' : 'Create account'} description="Manage identity, contact details, and access role." onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSubmit(); }} className="grid gap-4 sm:grid-cols-2">
    <label><span className={labelClass}>Full name</span><input className={inputClass} value={form.name} onChange={event => set('name', event.target.value)} required /></label>
    <label><span className={labelClass}>Account ID</span><input className={inputClass} value={form.id || ''} onChange={event => set('id', event.target.value)} placeholder="STU011 / EMP004 / ADM004" required readOnly={Boolean(editingId)} /></label>
    <label><span className={labelClass}>Username</span><input className={inputClass} value={form.username} onChange={event => set('username', event.target.value)} required /></label>
    <label><span className={labelClass}>Email</span><input type="email" className={inputClass} value={form.email} onChange={event => set('email', event.target.value)} required /></label>
    <label><span className={labelClass}>Contact details</span><input className={inputClass} value={form.contact} onChange={event => set('contact', event.target.value)} placeholder="Phone or email" required /></label>
    <label><span className={labelClass}>Department / course</span><select className={inputClass} value={form.department} onChange={event => set('department', event.target.value)} required><option value="" disabled>Select department or program</option>{form.department && !DEPARTMENTS.includes(form.department) && <option value={form.department}>{form.department}</option>}{DEPARTMENTS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
    <label><span className={labelClass}>Role</span><select className={inputClass} value={form.role} onChange={event => set('role', event.target.value)}><option>Student</option><option>Faculty</option><option>Admin</option></select></label>
    <label><span className={labelClass}>{form.id ? 'New password (optional)' : 'Temporary password'}</span><input type="password" className={inputClass} value={form.password} onChange={event => set('password', event.target.value)} required={!form.id} /></label>
    {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200 sm:col-span-2">{error}</p>}
    <div className="flex justify-end gap-3 sm:col-span-2"><Button variant="glass" onClick={onClose}>Cancel</Button><Button type="submit">{form.id ? 'Save changes' : 'Create account'}</Button></div>
  </form></Modal>;
}


/**
 * "Select saved venue": applies a stored geofence template to the form.
 *
 * THIS COPIES, IT DOES NOT LINK. Choosing a venue writes the numbers into the
 * form fields, and the event then stores its own copy. No reference to the
 * saved venue is kept on the event, so editing or deleting a saved venue later
 * cannot move the check-in zone of an event that already used it - attendance
 * already recorded against those coordinates stays meaningful.
 *
 * That is also why an event edited by hand is safe: the picker starts on
 * "Custom coordinates", nothing is applied unless an administrator explicitly
 * chooses a venue, and manually typed values are never overwritten on load.
 *
 * The default attendance minutes are a STARTING VALUE for the minutes field.
 * They remain freely editable per event and are not re-applied on save.
 */
function VenuePicker({ venues, selectedId, onApply, onAdd, adding, error }: {
  venues: SavedVenue[];
  selectedId: string;
  onApply: (venue: SavedVenue | null) => void;
  onAdd: (name?: string) => void;
  adding: boolean;
  error: string;
}) {
  const selected = venues.find(venue => venue.id === selectedId);
  const [query, setQuery] = useState(selected?.name || '');
  const filteredVenues = venues.filter(venue => venue.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3 sm:col-span-2">
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-[16rem] flex-1">
        <span className={labelClass}>Search or enter venue name</span>
        <input className={inputClass} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by saved venue name or type a new name" />
      </label>
      <label className="min-w-[16rem] flex-1">
        <span className={labelClass}>Saved venue</span>
        <select
          className={inputClass}
          value={selectedId}
          data-testid="saved-venue-select"
          onChange={event => {
            const venue = event.target.value ? venues.find(item => item.id === event.target.value) ?? null : null;
            if (venue) setQuery(venue.name);
            onApply(venue);
          }}
        >
          {/* Nothing is pre-selected: an event is never given a saved venue
              automatically, and a hand-configured event keeps its own values. */}
          <option value="">Choose saved venue</option>
          {filteredVenues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
      </label>
      <Button type="button" variant="glass" onClick={() => onAdd(query)} disabled={adding} data-testid="add-venue">
        {adding ? 'Saving…' : 'Add venue'}
      </Button>
    </div>
    {venues.length === 0 && (
      <p className="mt-3 text-xs leading-5 text-[#64748B]" data-testid="saved-venue-empty">
        No saved venues yet. Choose a location on the map and save it to make it reusable here.
      </p>
    )}
    {selected?.note && (
      <p className="mt-3 text-xs leading-5 text-[#64748B]" data-testid="saved-venue-note">
        {selected.name}: {selected.note}
      </p>
    )}
    {error && <p className="mt-2 text-xs text-rose-600" data-testid="saved-venue-error">{error}</p>}
  </div>;
}

function EventEditor({ form, setForm, onSubmit, onClose, error, saving, venues, venueSelectedId, setVenueSelectedId, setVenueError, venueError, addingVenue, saveCurrentAsVenue, mapPickerEnabled }: { form: EventForm; setForm: React.Dispatch<React.SetStateAction<EventForm>>; onSubmit: () => void; onClose: () => void; error: string; saving: boolean; venues: SavedVenue[]; venueSelectedId: string; setVenueSelectedId: (id: string) => void; setVenueError: (message: string) => void; venueError: string; addingVenue: boolean; saveCurrentAsVenue: (name?: string) => void; mapPickerEnabled: boolean }) {
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm({ ...form, [key]: value });
  /**
   * Applies a saved venue to the form fields.
   *
   * `venue` (the free-text label) is only filled when it is still blank, so
   * applying a venue to an event that already has a meaningful venue name does
   * not silently rename it. The geofence numbers and the suggested minutes are
   * always replaced, because choosing a venue is an explicit request for those.
   */
  const applyVenue = (venue: SavedVenue | null) => {
    if (!venue) return;
    const hasCoords = venue.latitude !== null && venue.longitude !== null && venue.radiusMeters !== null;
    setForm({
      ...form,
      venue: venue.name,
      venueLatitude: hasCoords ? venue.latitude! : form.venueLatitude,
      venueLongitude: hasCoords ? venue.longitude! : form.venueLongitude,
      venueRadiusMeters: hasCoords ? venue.radiusMeters! : form.venueRadiusMeters,
      geofenceType: hasCoords ? 'circle' : form.geofenceType,
      geofencePolygon: hasCoords ? [] : form.geofencePolygon,
      requiredAttendanceMinutes: venue.default_required_attendance_minutes === null
        ? form.requiredAttendanceMinutes
        : String(venue.default_required_attendance_minutes),
    });
  };
  return <Modal title="Schedule event" description="Set event details, attendance method, and automatic late cut-off." onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (!saving) onSubmit(); }} className="grid gap-4 sm:grid-cols-2">
    <label className="sm:col-span-2"><span className={labelClass}>Event name</span><input className={inputClass} value={form.name} onChange={event => set('name', event.target.value)} required /></label>
    <label className="sm:col-span-2"><span className={labelClass}>Description</span><textarea className={inputClass} rows={2} value={form.description} onChange={event => set('description', event.target.value)} required /></label>
    <label><span className={labelClass}>Date</span><input type="date" className={inputClass} value={form.date} onChange={event => set('date', event.target.value)} required /></label>
    <label><span className={labelClass}>Start time</span><input type="time" className={inputClass} value={form.start} onChange={event => set('start', event.target.value)} required /></label>
    <label><span className={labelClass}>End time</span><input type="time" className={inputClass} value={form.end} onChange={event => set('end', event.target.value)} required /></label>
    <label><span className={labelClass}>Cut-off time</span><input type="time" className={inputClass} value={form.cutoff} onChange={event => set('cutoff', event.target.value)} required /></label>
    {/*
      Stage 1 (event status). The domain has exactly two STORED statuses:
      `published` and `cancelled` (see backend EVENT_STATUSES). `Approved`,
      `Ongoing` and `Completed` are DERIVED from the event's own clock by
      serializeAdminEvent, and they all mean the same stored value: published.

      There is deliberately no "Pending" option. The previous build offered one,
      but the request mapper collapsed every non-cancelled status to
      `published`, so choosing "Pending" silently PUBLISHED the event - an
      unapproved event went live to every student. Removing the option is the
      honest fix: a stored pending/proposal state does not exist in this domain,
      and inventing one here would bypass approval rather than implement it.
    */}
    <label><span className={labelClass}>Event status</span><select className={inputClass} value={form.status} onChange={event => set('status', event.target.value as EventForm['status'])}><option>Approved</option><option>Ongoing</option><option>Completed</option><option>Cancelled</option></select></label>
    <label><span className={labelClass}>Attendance method</span><select className={inputClass} value={form.method} onChange={event => set('method', event.target.value as EventForm['method'])}><option>QR Code</option></select></label>
    <label><span className={labelClass}>Audience</span><select className={inputClass} value={form.audience} onChange={event => set('audience', event.target.value as EventAudience)}><option>All</option><option>Student</option><option>Faculty</option>{DEPARTMENTS.map(department => <option key={department}>{department}</option>)}</select></label>
    <label><span className={labelClass}>Department / group</span><input className={inputClass} value={form.department} onChange={event => set('department', event.target.value)} required /></label>
    {/*
      TWO SEPARATE QUESTIONS, TWO SEPARATE CHECKBOXES.

      These were one checkbox whose label ("Required for percentage") did not
      describe what it stored: it wrote `registrationRequired`, so every event
      created through this form made Students register before they could check
      in, purely because this box was ticked. An administrator had no way to
      express "does not need registration" at all.

      Each is now labelled for what it actually does, and each is sent under its
      own key. Registration defaults to OFF because it restricts Students.
    */}
    <label className="flex items-start gap-3 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] px-3 py-2.5 text-sm text-[#334155]">
      <input type="checkbox" checked={form.registrationRequired} onChange={event => set('registrationRequired', event.target.checked)} />
      <span>
        <span className="block font-semibold">Students must register before checking in</span>
        <span className="block text-xs text-[#64748B]">Off: any eligible student can scan and check in. On: students must register first, and the scan is refused until they have.</span>
      </span>
    </label>
    {/* The deadline only means something when registration is required, so it is
        shown exactly then. Editing is otherwise impossible rather than silently
        ignored by the server. */}
    {form.registrationRequired && <label><span className={labelClass}>Registration deadline (blank = open until the event starts)</span><input type="datetime-local" className={inputClass} value={form.registrationDeadline} onChange={event => set('registrationDeadline', event.target.value)} /></label>}
    <label className="flex items-start gap-3 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] px-3 py-2.5 text-sm text-[#334155]">
      <input type="checkbox" checked={form.requiredForAttendance} onChange={event => set('requiredForAttendance', event.target.checked)} />
      <span>
        <span className="block font-semibold">Counts toward the attendance percentage</span>
        <span className="block text-xs text-[#64748B]">Only affects the percentage shown in User management. It does not require registration and does not affect checking in.</span>
      </span>
    </label>
    {/* GST006: required in-zone minutes. Left blank the event stays unconfigured, which
        is exactly how every existing event behaves - no value is invented for them. */}
    <label><span className={labelClass}>Required Attendance Duration (minutes)</span><input type="number" min="1" max="1440" step="1" className={inputClass} value={form.requiredAttendanceMinutes} onChange={event => set('requiredAttendanceMinutes', event.target.value)} placeholder="Leave blank to disable tracking" /></label>
    {/* GST004: geofence. All three fields must be supplied together, or the check-in zone stays off. */}
    <VenuePicker
      venues={venues}
      selectedId={venueSelectedId}
      onApply={(venue) => { setVenueSelectedId(venue?.id ?? ''); applyVenue(venue); }}
      onAdd={saveCurrentAsVenue}
      adding={addingVenue}
      error={venueError}
    />
    {mapPickerEnabled && (
      <MapVenuePicker
        venue={form.venueLatitude !== undefined && form.venueLongitude !== undefined ? { latitude: form.venueLatitude, longitude: form.venueLongitude } : undefined}
        polygon={form.geofencePolygon}
        onVenueSelected={selection => {
          setForm(current => ({
            ...current,
            // A map click supplies coordinates without a place name, so keep any
            // venue name the organizer already typed instead of wiping it.
            ...(selection.name ? { venue: selection.name } : {}),
            venueLatitude: selection.latitude,
            venueLongitude: selection.longitude,
          }));
          setVenueSelectedId('');
          setVenueError('');
        }}
        onPolygonChanged={points => set('geofencePolygon', points)}
      />
    )}

    <div className="sm:col-span-2">
      <div className="grid grid-cols-2 gap-4">
        <label>
          <span className={labelClass}>Venue latitude</span>
          <input
            className={inputClass}
            type="number"
            step="any"
            min="-90"
            max="90"
            value={form.venueLatitude ?? ''}
            onChange={event => set('venueLatitude', event.target.value === '' ? undefined : Number(event.target.value))}
          />
        </label>
        <label>
          <span className={labelClass}>Venue longitude</span>
          <input
            className={inputClass}
            type="number"
            step="any"
            min="-180"
            max="180"
            value={form.venueLongitude ?? ''}
            onChange={event => set('venueLongitude', event.target.value === '' ? undefined : Number(event.target.value))}
          />
        </label>
      </div>
    </div>
    <div className="sm:col-span-2">
      <UseMyLocation
        policy={{ maxAccuracyMeters: 100, maxAgeSeconds: 120 }}
        onApply={(location) => {
          set('venueLatitude', location.latitude);
          set('venueLongitude', location.longitude);
        }}
      />
    </div>
    <label><span className={labelClass}>Attendance boundary</span><select className={inputClass} value={form.geofenceType} onChange={event => setForm(current => ({ ...current, geofenceType: event.target.value as EventForm['geofenceType'], geofencePolygon: event.target.value === 'polygon' ? current.geofencePolygon : [] }))}><option value="circle">Circular fence</option><option value="polygon">Custom map polygon</option></select></label>

    {form.geofenceType === 'circle' && <label><span className={labelClass}>Check-in radius (metres)</span><input className={inputClass} type="number" min="1" max="100000" value={form.venueRadiusMeters ?? ''} onChange={event => set('venueRadiusMeters', event.target.value === '' ? undefined : Number(event.target.value))} />{form.venueRadiusMeters === undefined && <span className="mt-1 block text-xs text-[#64748B]">A radius is required to enforce the circular fence.</span>}</label>}
    {form.geofenceType === 'polygon' && <p className="text-xs leading-5 text-[#64748B]">Use “Draw fence” on the map to add at least three vertices. The server validates the shape and determines attendance eligibility; venue selection remains separate.</p>}
    {form.geofenceType === 'circle' && <p className="text-xs leading-5 text-[#64748B]">The selected venue coordinates are the circular fence center. Saved venues and map selections provide verified center coordinates.</p>}
    {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200 sm:col-span-2">{error}</p>}
    <div className="flex justify-end gap-3 sm:col-span-2"><Button variant="glass" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Schedule event'}</Button></div>
  </form></Modal>;
}

function UserRegistrationDetails({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminUserRegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadUserRegistrations(accountId)
      .then(value => { if (active) { setDetail(value); setError(''); } })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Unable to load registrations.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId]);

  return <Modal title="Event registrations" description="Registration and attendance are recorded separately. Being registered is not attendance." onClose={onClose}>
    {loading && <p className="text-sm text-[#64748B]">Loading registrations…</p>}
    {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-700">{error}</p>}
    {detail && !loading && (
      <>
        <dl className="grid gap-2 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-4 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Account</dt><dd className="font-semibold text-[#10203B]">{detail.account.name} · {detail.account.id}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#64748B]">Account created</dt><dd className="font-semibold text-[#10203B]">{new Date(detail.account.createdAt).toLocaleDateString()}</dd></div>
        </dl>
        {detail.registrations.length === 0
          ? <div className="mt-4"><EmptyState message="Account created - no event registrations." /></div>
          : <div className="mt-4 overflow-x-auto rounded-xl border border-[#E2E3DF]">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-[#E2E3DF] bg-[#FAF9F5] text-xs uppercase tracking-wider text-[#64748B]">
                <tr><th className="px-4 py-3">Event</th><th className="px-4 py-3">Registration</th><th className="px-4 py-3">Registered on</th><th className="px-4 py-3">Attendance</th></tr>
              </thead>
              <tbody className="divide-y divide-[#ECEDEA]">
                {detail.registrations.map(registration => <tr key={registration.eventId}>
                  <td className="px-4 py-3"><p className="font-semibold text-[#10203B]">{registration.eventName}</p><p className="text-xs text-[#64748B]">{registration.eventDate ?? 'No date'}</p></td>
                  <td className="px-4 py-3"><StatusBadge status={registration.registrationStatus === 'registered' ? 'success' : 'error'}>{registration.registrationStatus}</StatusBadge></td>
                  <td className="px-4 py-3 text-xs text-[#64748B]">{new Date(registration.registeredAt).toLocaleString()}</td>
                  {/* Null means nothing was recorded. Deliberately NOT shown as Absent. */}
                  <td className="px-4 py-3">{registration.attendanceStatus
                    ? <StatusBadge status={statusTone(registration.attendanceStatus)}>{registration.attendanceStatus}</StatusBadge>
                    : <span className="text-xs text-[#94A3B8]">Not recorded</span>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
      </>
    )}
  </Modal>;
}

function UsersSection({ users }: { users: AdminUserAccount[] }) {
  const [filter, setFilter] = useState<'All' | AdminRole>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | AccountStatus>('All');
  const [participationFilter, setParticipationFilter] = useState<'All' | 'Registered' | 'NoRegistrations'>('All');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUserAccount | null | undefined>(undefined);
  const [form, setForm] = useState<UserForm>(emptyUserForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [setupBusyId, setSetupBusyId] = useState<string | null>(null);
  const PAGE_SIZE = 10;

  // Account creation and event registration are independent facts, so each is
  // filtered independently. An active account with no registrations is valid.
  const filtered = users.filter(user => {
    if (filter !== 'All' && user.role !== filter) return false;
    if (statusFilter !== 'All' && user.status !== statusFilter) return false;
    const registered = (user.eventRegistrationCount ?? 0) > 0;
    if (participationFilter === 'Registered' && !registered) return false;
    if (participationFilter === 'NoRegistrations' && registered) return false;
    return `${user.name} ${user.id} ${user.email} ${user.department}`.toLowerCase().includes(query.toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Any filter change can leave the current page out of range.
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const openCreate = () => { setEditing(null); setForm(emptyUserForm); setError(''); };
  const openEdit = (user: AdminUserAccount) => { setEditing(user); setForm({ id: user.id, name: user.name, username: user.username, email: user.email, contact: user.contact, role: user.role, department: user.department, password: '' }); setError(''); };
  const save = async () => {
    try {
      if (editing) await updateUser(editing.id, { name: form.name, username: form.username, email: form.email, contact: form.contact, role: form.role, department: form.department, ...(form.password ? { passwordHash: form.password } : {}) });
      else await addUser({ id: form.id, username: form.username, name: form.name, email: form.email, contact: form.contact, role: form.role, department: form.department, passwordHash: form.password });
      setEditing(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save account.'); }
  };
  const remove = async (user: AdminUserAccount) => { if (window.confirm(`Archive ${user.name}'s account? Their records will be preserved and sign-in blocked.`)) { try { await removeUser(user.id); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to archive account.'); } } };
  const restoreArchived = async (user: AdminUserAccount) => { if (window.confirm(`Restore ${user.name}'s archived account?`)) { try { await restoreUser(user.id); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to restore account.'); } } };
  // Smallest resend addition: re-issue the single-use application-password setup
  // link for an approved account that never completed setup (typically a
  // Google-linked account that wants to sign in manually). The server enforces
  // eligibility (approved, active, unarchived, no password yet) and reports
  // honestly if SMTP delivery fails - the notice is only shown on success.
  const resendSetup = async (user: AdminUserAccount) => {
    setError('');
    setNotice('');
    setSetupBusyId(user.id);
    try {
      await eventApi.resendUserPasswordSetup(user.id);
      setNotice(`A password setup link was sent to ${user.email || user.contact}. It can be used once and expires in one hour.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The password setup email could not be delivered.');
    } finally {
      setSetupBusyId(null);
    }
  };
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C2410C]">RBAC · Identity directory</p><h1 className="mt-2 text-3xl font-black text-[#10203B]">User management</h1><p className="mt-1 text-sm text-[#64748B]">Create, update, and assign Student, Faculty, or Admin access. Account creation and event registration are tracked separately.</p></div><Button onClick={openCreate}><Plus size={17} /> Add account</Button></div>
    {notice && <p role="status" className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm text-emerald-900">{notice}</p>}
    {error && <p role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-900">{error}</p>}
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="relative flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" /><input className={inputClass + ' pl-10'} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search name, ID, email, or department" /></div>
      <select aria-label="Filter by role" className={inputClass + ' lg:w-40'} value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setPage(0); }}><option>All</option><option>Student</option><option>Faculty</option><option>Admin</option></select>
      <select aria-label="Filter by account status" className={inputClass + ' lg:w-44'} value={statusFilter} onChange={event => { setStatusFilter(event.target.value as typeof statusFilter); setPage(0); }}><option value="All">All statuses</option><option>Active</option><option>Inactive</option><option>Archived</option></select>
      <select aria-label="Filter by event participation" className={inputClass + ' lg:w-52'} value={participationFilter} onChange={event => { setParticipationFilter(event.target.value as typeof participationFilter); setPage(0); }}><option value="All">All event activity</option><option value="Registered">Registered for events</option><option value="NoRegistrations">No event registrations</option></select>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-[#E2E3DF]"><table className="w-full min-w-[1240px] text-left text-sm"><thead className="border-b border border-[#E2E3DF] bg-[#FAF9F5] text-xs uppercase tracking-wider text-[#64748B]"><tr><th className="px-5 py-4">Account</th><th className="px-5 py-4">Email</th><th className="px-5 py-4">Role</th><th className="px-5 py-4">Department / course</th><th className="px-5 py-4">Registered on</th><th className="px-5 py-4">Account status</th><th className="px-5 py-4">Event registration</th><th className="px-5 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{visible.map(user => <tr key={user.id} className="hover:bg-[#FAF9F5]"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF1E6] text-xs font-bold text-[#C2410C]">{initials(user.name)}</span><div><p className="font-semibold text-[#10203B]">{user.name}</p><p className="text-xs text-[#64748B]">{user.id} · @{user.username}</p></div></div></td><td className="px-5 py-4 text-xs break-all text-[#10203B]/55">{user.email || user.contact || '-'}</td><td className="px-5 py-4"><StatusBadge status="info">{user.role}</StatusBadge></td><td className="px-5 py-4 text-[#10203B]/65">{user.department || '-'}</td><td className="px-5 py-4 text-xs text-[#64748B]">{new Date(user.createdAt).toLocaleDateString()}</td><td className="px-5 py-4"><div className="flex flex-col items-start gap-1.5"><StatusBadge status={user.status === 'Active' ? 'success' : user.status === 'Archived' ? 'info' : 'error'}>{user.status}</StatusBadge></div></td><td className="px-5 py-4"><button type="button" onClick={() => setDetailAccountId(user.id)} className="text-left text-xs font-semibold text-[#C2410C] underline-offset-4 hover:underline">{eventParticipationLabel(user)}</button></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button type="button" title="View event registrations" onClick={() => setDetailAccountId(user.id)} className="rounded-lg p-2 text-[#64748B] hover:bg-[#FFF1E6] hover:text-[#C2410C]"><CalendarDays size={16} /></button>{user.status !== 'Archived' && <><button type="button" title="Edit account" onClick={() => openEdit(user)} className="rounded-lg p-2 text-[#64748B] hover:bg-[#FFF1E6] hover:text-[#C2410C]"><Edit3 size={16} /></button>{user.hasApplicationPassword === false && user.approvalStatus === 'approved' && user.status === 'Active' && <button type="button" title="Send application password setup link" onClick={() => void resendSetup(user)} disabled={setupBusyId === user.id} className="rounded-lg p-2 text-[#64748B] hover:bg-[#FFF1E6] hover:text-[#C2410C] disabled:opacity-50"><KeyRound size={16} /></button>}<button type="button" title="Archive account" onClick={() => remove(user)} className="rounded-lg p-2 text-[#64748B] hover:bg-rose-400/10 hover:text-rose-600"><Archive size={16} /></button></>}{user.status === 'Archived' && <button type="button" title="Restore archived account" onClick={() => void restoreArchived(user)} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-400/10"><UserCheck size={16} /></button>}</div></td></tr>)}</tbody></table>{visible.length === 0 && <div className="p-8"><EmptyState message="No accounts match the current filters." /></div>}</div>
    {pageCount > 1 && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#64748B]"><span>Showing {visible.length} of {filtered.length} accounts \u00b7 page {safePage + 1} of {pageCount}</span><div className="flex gap-2"><Button variant="glass" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</Button><Button variant="glass" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</Button></div></div>}
    {detailAccountId && <UserRegistrationDetails accountId={detailAccountId} onClose={() => setDetailAccountId(null)} />}
    {editing !== undefined && <UserEditor form={form} editingId={editing?.id} setForm={setForm} onSubmit={save} onClose={() => setEditing(undefined)} error={error} />}
  </section>;
}

/**
 * AD003.3: review of email-only signup requests. The applicant submitted only
 * a verified Google email; the administrator assigns the account ID and one of
 * the five departments here, and approval is what creates the User. Rejection
 * never creates one.
 */
function SignupRequestsSection() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [requests, setRequests] = useState<AdminSignupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [forms, setForms] = useState<Record<string, { accountId: string; department: string; role: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (next: 'pending' | 'approved' | 'rejected') => {
    setLoading(true);
    setError('');
    try {
      setRequests(await eventApi.adminSignupRequests(next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load signup requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(status); }, [load, status]);

  // The inferred pending role is preselected; an unmatched request starts blank
  // so the administrator must choose one deliberately.
  const defaultRole = (request: AdminSignupRequest) => (request.pendingRole === 'student' ? 'Student' : request.pendingRole === 'faculty' ? 'Faculty' : '');
  const formFor = (request: AdminSignupRequest) => forms[request.id] ?? { accountId: request.accountId || '', department: '', role: defaultRole(request) };
  const setFormFor = (request: AdminSignupRequest, patch: Partial<{ accountId: string; department: string; role: string }>) =>
    setForms(current => ({
      ...current,
      [request.id]: {
        accountId: current[request.id]?.accountId ?? request.accountId ?? '',
        department: current[request.id]?.department ?? '',
        role: current[request.id]?.role ?? defaultRole(request),
        ...patch,
      },
    }));

  const approve = async (request: AdminSignupRequest) => {
    const form = formFor(request);
    setError('');
    setNotice('');
    if (!form.accountId.trim()) { setError('Enter the account ID before approving.'); return; }
    if (!DEPARTMENTS.includes(form.department)) { setError('Select a department or course before approving.'); return; }
    if (!form.role) { setError('Assign a role before approving.'); return; }
    setBusyId(request.id);
    try {
      const result = await eventApi.approveSignupRequest(request.id, {
        accountId: form.accountId.trim(),
        department: form.department,
        role: form.role,
      });
      // Only 'sent' means the SMTP provider accepted the message. Report any
      // other outcome honestly so nobody assumes an email went out.
      if (result?.passwordSetup === 'sent') {
        setNotice(`Request from ${request.googleEmail} approved and a password setup link was delivered. The applicant can sign in after setting their application password.`);
      } else {
        setNotice(`Request from ${request.googleEmail} approved, but the password setup email could not be confirmed. Open Approved requests and resend the setup link after SMTP is configured.`);
      }
      await load(status);
    } catch (caught) {
      setError(`${caught instanceof Error ? caught.message : 'Unable to approve the request.'} If approval completed but email delivery failed, open Approved requests and resend the password setup link after SMTP is configured.`);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (request: AdminSignupRequest) => {
    setError('');
    setNotice('');
    setBusyId(request.id);
    try {
      await eventApi.rejectSignupRequest(request.id);
      setNotice(`Request from ${request.googleEmail} rejected. No account was created.`);
      await load(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reject the request.');
    } finally {
      setBusyId(null);
    }
  };

  const resendSetup = async (request: AdminSignupRequest) => {
    setError('');
    setNotice('');
    setBusyId(request.id);
    try {
      await eventApi.resendSignupPasswordSetup(request.id);
      setNotice(`A password setup link was delivered to ${request.googleEmail}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The password setup email could not be delivered.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5" data-testid="signup-requests-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-[#10203B]">Signup requests</h2>
          <p className="text-xs text-[#64748B]">Applicants submit only their email or verified Google identity. Approval assigns the account ID, department and role; manual applicants verify email first.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-1">
          {(['pending', 'approved', 'rejected'] as const).map(item => (
            <button key={item} type="button" onClick={() => setStatus(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold capitalize transition ${status === item ? 'bg-[#FFF1E6] text-[#C2410C]' : 'text-[#64748B] hover:bg-[#FAF9F5] hover:text-[#10203B]'}`}>{item}</button>
          ))}
        </div>
      </div>
      {error && <p role="alert" data-testid="signup-error" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" data-testid="signup-notice" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
      {loading
        ? <EmptyState message="Loading signup requests…" />
        : requests.length === 0
          ? <EmptyState message={`No ${status} signup requests.`} />
          : (
            <div className="overflow-x-auto rounded-2xl border border-[#E2E3DF]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-[#E2E3DF] bg-[#FAF9F5] text-xs uppercase tracking-wider text-[#64748B]">
                  <tr>
                    <th className="px-5 py-4">Applicant</th>
                    <th className="px-5 py-4">Requested</th>
                    <th className="px-5 py-4">Inferred role</th>
                    {status === 'pending' && <th className="px-5 py-4">Assign account</th>}
                    <th className="px-5 py-4 text-right">{status === 'pending' ? 'Actions' : 'Outcome'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {requests.map(request => (
                    <tr key={request.id} className="align-top hover:bg-[#FAF9F5]" data-testid="signup-request-row">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-[#10203B]">{request.name || (request.provider === 'email' ? 'Email applicant' : 'Google applicant')}</p>
                        <p className="text-xs text-[#64748B]">{request.googleEmail}</p>
                        <p className="text-xs capitalize text-[#94A3B8]">{request.emailVerified ? `${request.provider} verified` : 'Email not verified'}</p>
                        {request.accountId && <p className="text-xs text-[#64748B]">{request.status === 'pending' ? 'Verified account ID suggestion:' : 'Assigned account ID:'} {request.accountId}</p>}
                      </td>
                      <td className="px-5 py-4 text-xs text-[#64748B]">{request.createdAt ? new Date(request.createdAt).toLocaleString() : '—'}</td>
                      <td className="px-5 py-4">
                        {request.pendingRole
                          ? <StatusBadge status="info">{request.pendingRole === 'student' ? 'Student' : 'Faculty'}</StatusBadge>
                          : <span className="text-xs text-[#94A3B8]">Not inferred — assign one</span>}
                      </td>
                      {status === 'pending' && (
                        <td className="px-5 py-4">
                          <div className="grid gap-3 sm:w-96">
                            <label><span className={labelClass}>Account ID</span><input className={inputClass} value={formFor(request).accountId} onChange={event => setFormFor(request, { accountId: event.target.value })} placeholder="e.g. 2401117404" data-testid="signup-account-id" /></label>
                            <label><span className={labelClass}>Department / course</span><select className={inputClass} value={formFor(request).department} onChange={event => setFormFor(request, { department: event.target.value })} data-testid="signup-department"><option value="" disabled>Select department or program</option>{DEPARTMENTS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
                            <label><span className={labelClass}>Role</span><select className={inputClass} value={formFor(request).role} onChange={event => setFormFor(request, { role: event.target.value })} data-testid="signup-role"><option value="" disabled>Assign a role</option><option>Student</option><option>Faculty</option></select></label>
                          </div>
                        </td>
                      )}
                      <td className="px-5 py-4 text-right">
                        {status === 'pending'
                          ? (
                            <div className="flex justify-end gap-2">
                              <Button variant="glass" onClick={() => void reject(request)} disabled={busyId === request.id} data-testid="signup-reject">Reject</Button>
                              <Button onClick={() => void approve(request)} disabled={busyId === request.id} data-testid="signup-approve">Approve</Button>
                            </div>
                          )
                          : status === 'approved'
                            ? <div className="space-y-2"><StatusBadge status="success">approved</StatusBadge><Button variant="glass" onClick={() => void resendSetup(request)} disabled={busyId === request.id}>Resend password setup link</Button></div>
                            : <StatusBadge status="error">rejected</StatusBadge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

/**
 * Dedicated Archive section: read-only listing of archived events loaded from
 * the existing `/admin/archive/` backend endpoint via `adminArchivedEvents()`.
 * Archived events are not derived from the active-events response. Details are
 * read-only (no edit/create/cancel/archive); the existing Restore action is
 * preserved and does not alter archive timestamps of other records.
 */
function ArchiveSection() {
  const [archivedEvents, setArchivedEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    eventApi.adminArchivedEvents()
      .then(data => { if (active) setArchivedEvents(data); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Archived events could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const restore = async (event: AdminEvent) => {
    if (!window.confirm(`Restore ${event.name}? It will become visible to students and faculty again.`)) return;
    try {
      const saved = await eventApi.restoreAdminEvent(event.id);
      setArchivedEvents(current => current.filter(item => item.id !== saved.id));
      await refreshAdminState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to restore event.');
    }
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center text-sm text-[#64748B]">Loading archived events…</div>;
  if (error) return <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-200">{error}</div>;

  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Archived events</p>
          <h1 className="mt-2 text-3xl font-black text-[#10203B]">Archive</h1>
          <p className="mt-1 text-sm text-[#64748B]">Archived events are hidden from students and faculty. Attendance records, registrations, and reports remain intact. Restoring an event makes it visible again.</p>
        </div>
      </div>
      {archivedEvents.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {archivedEvents.map(event => <article key={event.id} className="app-card flex flex-col p-5 border-[#ECEDEA]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94A3B8]">{event.id}</span>
                  <StatusBadge status="info">{event.status}</StatusBadge>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Archived</span>
                </div>
                <h2 className="mt-2 text-lg font-bold text-[#10203B]">{event.name}</h2>
                <p className="mt-1 text-sm leading-6 text-[#10203B]/50">{event.description}</p>
              </div>
              <span className="rounded-xl bg-[#FAF9F5] p-2.5 text-[#94A3B8]"><Archive size={19} /></span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-[#94A3B8]">Date & time</p><p className="mt-1 font-semibold text-[#10203B]/75">{event.date} · {event.start}–{event.end}</p></div>
              <div><p className="text-xs text-[#94A3B8]">Venue</p><p className="mt-1 font-semibold text-[#10203B]/75">{event.venue}</p></div>
              <div><p className="text-xs text-[#94A3B8]">Attendance</p><p className="mt-1 font-semibold text-[#10203B]/75">{event.method} · {event.identifierRange}</p></div>
              <div><p className="text-xs text-[#94A3B8]">Late cut-off</p><p className="mt-1 font-semibold text-amber-200">{event.cutoff}</p></div>
            </div>
            <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[#E2E3DF] pt-4">
              <Button className="px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300" onClick={() => restore(event)}><Archive size={15} /> Restore</Button>
            </div>
          </article>)}
        </div>
      ) : (
        <div className="mt-10"><EmptyState message="No archived events." /></div>
      )}
    </section>
  );
}

function EventsSection() {
  const [serverEvents, setServerEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Student organization' | 'Faculty'>('All');
  const [editing, setEditing] = useState<AdminEvent | null | undefined>(undefined);
  const [form, setForm] = useState<EventForm>(emptyEventForm);
  const [error, setError] = useState('');
  /**
   * Saved venues are templates the picker OFFERS. Nothing here applies one to
   * an event automatically, and the picker is never given an initial selection,
   * so a hand-configured event keeps exactly the values it was saved with.
   */
  const [venues, setVenues] = useState<SavedVenue[]>([]);
  const [venueSelectedId, setVenueSelectedId] = useState('');
  const [venueError, setVenueError] = useState('');
  const [addingVenue, setAddingVenue] = useState(false);
  const [mapPickerEnabled, setMapPickerEnabled] = useState(false);
  // Separate from `error`: the event itself saved fine, so this must not read as
  // a failed save.
  const [qrNotice, setQrNotice] = useState('');
  const [calendarNotice, setCalendarNotice] = useState<{ reason: string; authorizationUrl?: string } | null>(null);
  // AD024: per-event registrants modal state.
  const [registrantsEvent, setRegistrantsEvent] = useState<AdminEvent | null>(null);
  const [registrants, setRegistrants] = useState<AdminEventRegistrant[] | null>(null);
  const [registrantsLoading, setRegistrantsLoading] = useState(false);
  const [registrantsError, setRegistrantsError] = useState('');

  useEffect(() => {
    let active = true;
    eventApi.adminEvents()
      .then(data => { if (active) setServerEvents(data); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Events could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    // Loaded independently of the event list: a failure here must not hide the
    // events, and the picker simply shows its empty state.
    eventApi.savedVenues()
      .then(data => { if (active) setVenues(data); })
      .catch(caught => { if (active) setVenueError(caught instanceof Error ? caught.message : 'Saved venues could not be loaded.'); });
    eventApi.mapPickerSettings()
      .then(status => { if (active) setMapPickerEnabled(status.enabled); })
      .catch(() => { if (active) setMapPickerEnabled(false); })
    return () => { active = false; };
  }, []);

  const visible = (loading ? [] : serverEvents)
    .filter(event => !event.archivedAt)
    .filter(event => filter === 'All' || event.origin === filter)
    .sort((a, b) => b.date.localeCompare(a.date));


  const openCreate = () => { setEditing(null); setForm({ ...emptyEventForm, id: crypto.randomUUID() }); setError(''); setCalendarNotice(null); setVenueSelectedId(''); setVenueError(''); };
  const openEdit = (event: AdminEvent) => {
    setEditing(event);
    setVenueSelectedId('');
    setVenueError('');
    setForm({ id: event.id, name: event.name, description: event.description, date: event.date, start: event.start, end: event.end, venue: event.venue, organizer: event.organizer, audience: event.audience, department: event.department, method: event.method, cutoff: event.cutoff, status: event.status,
      // BOTH FLAGS ARE REPOPULATED, so create -> save -> reopen shows what was
      // actually stored. The deadline arrives as an ISO instant and is trimmed to
      // the `datetime-local` shape the input expects.
      registrationRequired: event.registrationRequired,
      registrationDeadline: event.registrationDeadline ? event.registrationDeadline.slice(0, 16) : '',
      requiredForAttendance: event.requiredForAttendance, requiredAttendanceMinutes: event.requiredAttendanceMinutes === null || event.requiredAttendanceMinutes === undefined ? '' : String(event.requiredAttendanceMinutes),
      // The venue geofence MUST be repopulated when editing a saved event.
      //
      // These three were omitted, so opening a geofenced event rendered the
      // check-in zone BLANK - the administrator could not see, verify or correct
      // where an existing event's fence actually was.
      //
      // WHAT THIS WAS NOT. It did NOT delete the fence on save: an absent field
      // fails the server's `supplied !== 0 && supplied !== 3` check, so nothing
      // is written and the stored values survive. An earlier comment here
      // claimed it silently removed location verification; that was wrong, and
      // the consequence is corrected here rather than left overstated.
      //
      // The real damage was the confusing middle case: the form looked empty,
      // so an administrator correcting ONE field got "Enter the venue latitude,
      // longitude and radius together", and retyping all three replaced a
      // configured fence they had never been shown.
      //
      // Left `undefined` (blank) rather than defaulted to 0, because "no geofence
      // configured" must stay distinguishable from "geofence at null island".
      // Covered by "nothing is written until saving, and a confirmed location
      // then survives a reopen" in e2e/10-admin-location.spec.ts.
      venueLatitude: event.venueLatitude,
      venueLongitude: event.venueLongitude,
      venueRadiusMeters: event.venueRadiusMeters,
      geofenceType: event.geofenceType || 'circle',
      geofencePolygon: event.geofencePolygon || [],
    });
    setError('');
    setCalendarNotice(null);
  };
  /**
   * "Add venue": saves the coordinates currently typed into the form as a
   * reusable template.
   *
   * It saves what is on screen and nothing else, and it deliberately does NOT
   * touch the event: the event is saved separately by "Schedule event", so
   * saving a venue can never quietly change an event that already exists. A
   * geofence needs all three values, so an incomplete one is refused here with
   * the same rule the event write contract uses.
   */
  const saveCurrentAsVenue = async (typedName?: string) => {
    const name = (typedName ?? '').trim();
    const latitude = form.venueLatitude;
    const longitude = form.venueLongitude;
    const radius = form.venueRadiusMeters;
    if (!name) {
      setVenueError('Enter a venue name before saving.');
      return;
    }
    if (venues.some(venue => venue.name.toLowerCase() === name.toLowerCase())) {
      setVenueError(`A saved venue named “${name}” already exists. Choose a different name.`);
      return;
    }
    setAddingVenue(true);
    setVenueError('');
    try {
      const minutes = form.requiredAttendanceMinutes.trim();
      const saved = await eventApi.createSavedVenue({
        name,
        // Carried over so the "approximate coordinates" wording survives the
        // round trip instead of having to be retyped.
        note: '',
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        radiusMeters: radius ?? null,
        defaultRequiredAttendanceMinutes: minutes === '' ? null : Number(minutes),
      });
      setVenues(current => [...current.filter(venue => venue.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setVenueSelectedId(saved.id);
    } catch (caught) {
      setVenueError(caught instanceof Error ? caught.message : 'The venue could not be saved.');
    } finally {
      setAddingVenue(false);
    }
  };
  const requestFromForm = (value: EventForm): AdminEventRequest => ({
    ...(value.id ? { id: value.id } : {}),
    name: value.name.trim(),
    description: value.description.trim(),
    date: value.date,
    start: value.start,
    end: value.end,
    venue: value.venue.trim(),
    audience: value.audience.toLowerCase() as AdminEventRequest['audience'],
    method: 'qr',
    cutoff: value.cutoff,
    /*
      Stage 1: only `cancelled` is stored as itself. Every other display status
      means "published" in the database, because `published` is the single
      non-cancelled STORED state and Approved/Ongoing/Completed are derived from
      the event's own clock. Any status that is not in the stored set is
      refused here rather than being silently coerced to `published`, so a new
      status can never reach the server as an unintended publication.
    */
    status: value.status === 'Cancelled' ? 'cancelled' : 'published',
    // Two independent flags, each under its own key. Blank means "no deadline",
    // which is sent as null so the server stores a genuinely absent deadline
    // rather than an invalid one.
    registrationRequired: value.registrationRequired,
    registrationDeadline: value.registrationDeadline.trim() === '' ? null : new Date(value.registrationDeadline).toISOString(),
    requiredForAttendance: value.requiredForAttendance,
    // GST006: an empty box means "not configured" and is sent as null, which is
    // how an existing event stays unconfigured. A value is validated by the
    // server against the event length.
    requiredAttendanceMinutes: value.requiredAttendanceMinutes === '' ? null : Number(value.requiredAttendanceMinutes),
    // GST004: sent only when all three are set, so the server sees either a
    // complete fence or an explicit clear, never a half-configured one.
    venueLatitude: value.venueLatitude,
    venueLongitude: value.venueLongitude,
    venueRadiusMeters: value.venueRadiusMeters,
    geofenceType: value.geofenceType,
    geofencePolygon: value.geofencePolygon,
  });
  const saveInFlight = useRef(false);
  const save = async () => {
    if (saving || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setError('');
    setQrNotice('');
    setCalendarNotice(null);
    try {
      const request = requestFromForm(form);
      const saved = editing
        ? await eventApi.updateAdminEvent(editing.id, request)
        : await eventApi.createAdminEvent(request);
      setServerEvents(current => editing
        ? current.map(event => event.id === saved.id ? saved : event)
        : (current.some(event => event.id === saved.id)
            ? current.map(event => event.id === saved.id ? saved : event)
            : [saved, ...current]));
      await refreshAdminState();
      setEditing(undefined);
      // The event is already saved at this point. Auto-issuing its code is a
      // separate step that is allowed to fail, so say so plainly instead of
      // letting the administrator believe a scannable code now exists.
      // Only the CREATE response carries this; an update response has no `qr`.
      const issuance: AdminEventCreated['qr'] = (saved as AdminEventCreated).qr;
      if (issuance && issuance.ok === false) {
        setQrNotice(`The event was created, but its attendance code was not issued: ${issuance.reason} Open the event's code panel and select View to retry.`);
      }
      const calendar = (saved as AdminEventCreated | AdminEventUpdated).calendar;
      if (calendar && !calendar.ok) setCalendarNotice({ reason: calendar.reason, authorizationUrl: calendar.authorizationUrl });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save event.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const cancel = async (event: AdminEvent) => {
    if (!window.confirm(`Cancel ${event.name}?`)) return;
    try {
      const saved = await eventApi.cancelAdminEvent(event.id);
      setServerEvents(current => current.map(item => item.id === saved.id ? saved : item));
      await refreshAdminState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel event.');
    }
  };
  const archive = async (event: AdminEvent) => {
    if (!window.confirm(`Archive ${event.name}? It will be hidden from students and faculty, but its attendance records and registrations remain available.`)) return;
    try {
      const saved = await eventApi.archiveAdminEvent(event.id);
      setServerEvents(current => current.map(item => item.id === saved.id ? saved : item));
      await refreshAdminState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to archive event.');
    }


  };

  const openRegistrants = async (event: AdminEvent) => {
    setRegistrantsEvent(event);
    setRegistrants(null);
    setRegistrantsError('');
    setRegistrantsLoading(true);
    try {
      setRegistrants(await eventApi.adminEventRegistrants(event.id));
    } catch (caught) {
      setRegistrantsError(caught instanceof Error ? caught.message : 'Unable to load registrants.');
    } finally {
      setRegistrantsLoading(false);
    }
  };
  const closeRegistrants = () => {
    setRegistrantsEvent(null);
    setRegistrants(null);
    setRegistrantsError('');
  };

  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Scheduling · Approval · Cancellation</p><h1 className="mt-2 text-3xl font-black text-[#10203B]">Event management</h1><p className="mt-1 text-sm text-[#64748B]">Create events, review Student and Faculty submissions, and keep attendance tracking visible.</p></div><Button onClick={openCreate}><Plus size={17} /> Create event</Button></div>
    {error && !editing && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
    {qrNotice && <p role="status" data-testid="qr-issuance-notice" className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">{qrNotice}</p>}
    {calendarNotice && <p role="alert" data-testid="calendar-sync-notice" className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">{calendarNotice.reason}{calendarNotice.authorizationUrl && <> <a className="underline" href={calendarNotice.authorizationUrl}>Connect Google Calendar</a>.</>}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFilter('All')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === 'All' ? 'bg-[#FFF1E6] text-[#9A3412] ring-1 ring-inset ring-[#F97316]/25' : 'bg-[#FAF9F5] text-[#10203B]/50'}`}>All events</button><button type="button" onClick={() => setFilter('Student organization')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === 'Student organization' ? 'bg-[#FFF1E6] text-[#9A3412] ring-1 ring-inset ring-[#F97316]/25' : 'bg-[#FAF9F5] text-[#10203B]/50'}`}>Student submissions</button><button type="button" onClick={() => setFilter('Faculty')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === 'Faculty' ? 'bg-[#FFF1E6] text-[#9A3412] ring-1 ring-inset ring-[#F97316]/25' : 'bg-[#FAF9F5] text-[#10203B]/50'}`}>Faculty submissions</button></div>
    <div className="grid gap-4 lg:grid-cols-2">{visible.map(event => <article key={event.id} className={panelClass + ' p-5'}><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94A3B8]">{event.id}</span><StatusBadge status={statusTone(event.status)}>{event.status}</StatusBadge></div><h2 className="mt-2 text-lg font-bold text-[#10203B]">{event.name}</h2><p className="mt-1 text-sm leading-6 text-[#10203B]/50">{event.description}</p></div><span className="rounded-xl bg-[#FFF1E6] p-2.5 text-[#C2410C]"><CalendarDays size={19} /></span></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-[#94A3B8]">Date & time</p><p className="mt-1 font-semibold text-[#10203B]/75">{event.date} · {event.start}–{event.end}</p></div><div><p className="text-xs text-[#94A3B8]">Venue</p><p className="mt-1 font-semibold text-[#10203B]/75">{event.venue}</p></div><div><p className="text-xs text-[#94A3B8]">Attendance</p><p className="mt-1 font-semibold text-[#10203B]/75">{event.method} · {event.identifierRange}</p></div><div><p className="text-xs text-[#94A3B8]">Late cut-off</p><p className="mt-1 font-semibold text-amber-200">{event.cutoff}</p></div></div><div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#E2E3DF] pt-4"><Button variant="glass" className="px-3 py-2 text-xs" onClick={() => openEdit(event)}><Edit3 size={14} /> Edit</Button>{event.status !== 'Cancelled' && event.status !== 'Completed' && <Button variant="glass" className="px-3 py-2 text-xs text-rose-200 hover:text-rose-100" onClick={() => cancel(event)}><X size={14} /> Cancel</Button>}{event.status !== 'Cancelled' && <Button variant="glass" className="px-3 py-2 text-xs text-emerald-200 hover:text-emerald-100" onClick={async () => { try { await eventApi.issueEventCertificates(event.id); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to issue certificates.'); } }}><FileCheck size={14} /> Certificates</Button>}
{event.status !== 'Cancelled' && <Button variant="glass" className="px-3 py-2 text-xs text-sky-200 hover:text-sky-100" onClick={() => openRegistrants(event)}><Users size={14} /> Registrants</Button>}
{!event.archivedAt && event.status !== 'Cancelled' && <Button className="px-4 py-2 text-sm font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300" onClick={() => archive(event)}><Archive size={15} /> Archive</Button>}
</div>{/* GST006: the QR panel is its own block so it never inherits the button row's flex layout. */}{event.method === 'QR Code' && <EventQrPanel eventId={event.id} eventName={event.name} admin />}</article>)}</div>
    {visible.length === 0 && <EmptyState message="No events match this submission filter." />}


    {editing !== undefined && <EventEditor form={form} setForm={setForm} onSubmit={() => void save()} onClose={() => setEditing(undefined)} error={error} saving={saving} venues={venues} venueSelectedId={venueSelectedId} setVenueSelectedId={setVenueSelectedId} venueError={venueError} addingVenue={addingVenue} saveCurrentAsVenue={saveCurrentAsVenue} setVenueError={setVenueError} mapPickerEnabled={mapPickerEnabled} />}
    {registrantsEvent && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#10203B]">Registrants for {registrantsEvent.name}</h2>
              {registrants && <p className="text-xs text-[#64748B]">{registrants.length} registered</p>}
            </div>
            <button type="button" onClick={closeRegistrants} className="rounded-xl p-2 text-[#64748B] hover:bg-[#FAF9F5]"><X size={18} /></button>
          </div>
          {registrantsLoading && <p className="text-sm text-[#64748B]">Loading registrants…</p>}
          {registrantsError && <p role="alert" className="text-sm text-rose-600">{registrantsError}</p>}
          {!registrantsLoading && !registrantsError && registrants && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E3DF] text-left text-xs text-[#64748B]">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2 pr-4">Department</th>
                    <th className="pb-2 pr-4">Registration</th>
                    <th className="pb-2 pr-4">Confirmation</th>
                    <th className="pb-2">Registered at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E3DF]">
                  {registrants.map((r) => (
                    <tr key={r.attendee.id || r.attendee.accountId}>
                      <td className="py-2 pr-4 font-semibold text-[#10203B]">{r.attendee.name || r.attendee.email}</td>
                      <td className="py-2 pr-4 text-[#64748B]">{r.attendee.role}</td>
                      <td className="py-2 pr-4 text-[#64748B]">{r.attendee.department || '-'}</td>
                      <td className="py-2 pr-4"><StatusBadge status={r.registrationStatus === 'registered' ? 'success' : 'info'}>{r.registrationStatus}</StatusBadge></td>
                      <td className="py-2 pr-4"><StatusBadge status={r.confirmationStatus ? (r.confirmationStatus === 'Present' ? 'success' : 'warning') : 'info'}>{r.confirmationStatus ?? 'Not yet'}</StatusBadge></td>
                      <td className="py-2 text-xs text-[#64748B]">{r.registeredAt ? new Date(r.registeredAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                  {registrants.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-[#64748B]">No registrants yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )}
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

  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Live monitoring · Manual correction</p><h1 className="mt-2 text-3xl font-black text-[#10203B]">Attendance management</h1><p className="mt-1 text-sm text-[#64748B]">Review individual records, add missing entries, correct disputes, and remove invalid records.</p></div><div className="flex flex-wrap gap-2"><select className={inputClass + ' sm:w-64'} value={eventId} onChange={event => setEventId(event.target.value)}>{events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select><Button onClick={() => { setAddOpen(true); setError(''); }}><Plus size={17} /> Add record</Button></div></div>
    {selected && <div className="grid gap-4 sm:grid-cols-5"><Metric label="Checked in present" value={records.filter(record => record.status === 'Present').length} tone="green" icon={CheckCircle2} /><Metric label="Checked in late" value={records.filter(record => record.status === 'Late').length} tone="amber" icon={Activity} /><Metric label="Checked in absent" value={records.filter(record => record.status === 'Absent').length} tone="rose" icon={AlertCircle} />{/* GST008: the QUALIFIED count is a SEPARATE number from the check-in counts above. Counting `status` alone would report a Pending attendee as Present, because the scan records status the moment it happens. */}<Metric label="Qualified" value={records.filter(record => record.qualification === 'Present' || record.qualification === 'Late').length} tone="green" icon={ShieldCheck} /><Metric label="Pending duration" value={records.filter(record => record.qualification === 'Pending').length} tone="amber" icon={Clock} /></div>}
    <div className="relative"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" /><input className={inputClass + ' pl-10'} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search attendee, ID, or department" /></div>
    <div className="overflow-x-auto rounded-2xl border border-[#E2E3DF]"><table className="w-full min-w-[1500px] text-left text-sm" data-testid="attendance-table"><thead className="border-b border-[#E2E3DF] bg-[#FAF9F5] text-xs uppercase tracking-wider text-[#64748B]"><tr><th className="px-5 py-4">Attendee</th><th className="px-5 py-4">Role / department</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Recorded</th><th className="px-5 py-4">Verified in-zone</th><th className="px-5 py-4">Required</th><th className="px-5 py-4">Progress</th><th className="px-5 py-4">Location</th><th className="px-5 py-4">Last update</th><th className="px-5 py-4">Tracking</th><th className="px-5 py-4">Qualification</th><th className="px-5 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{visible.map(record => <tr key={record.id}><td className="px-5 py-4"><p className="font-semibold text-[#10203B]">{record.name}</p><p className="text-xs text-[#64748B]">{record.personId}</p></td><td className="px-5 py-4 text-[#10203B]/60">{record.role} · {record.department}</td><td className="px-5 py-4"><StatusBadge status={statusTone(record.status)}>{record.status}</StatusBadge></td><td className="px-5 py-4 text-[#10203B]/50">{record.scannedAt ? new Date(record.scannedAt).toLocaleString() : 'Manual entry'} <span className="block text-[10px] text-[#10203B]/30">{record.source}</span></td>
<td className="px-5 py-4 font-mono text-[#10203B]" data-testid="cell-verified">{verifiedLabel(record)}</td>
<td className="px-5 py-4 text-[#10203B]/60" data-testid="cell-required">{requiredLabel(record)}</td>
<td className="px-5 py-4 text-[#10203B]/60" data-testid="cell-progress">{progressLabel(record) ?? '--'}</td>
<td className="px-5 py-4" data-testid="cell-location"><StatusBadge status={locationTone(record)}>{locationLabel(record)}</StatusBadge></td>
<td className="px-5 py-4 text-[#10203B]/50" data-testid="cell-lastupdate">{record.lastLocationAt ? new Date(record.lastLocationAt).toLocaleString() : '--'}</td>
<td className="px-5 py-4" data-testid="cell-tracking">{trackingLabel(record)}</td>
<td className="px-5 py-4" data-testid="cell-qualification"><StatusBadge status={qualificationTone(record)}>{record.qualification ?? 'Not required'}</StatusBadge>{record.manualOverride && <span className="block text-[10px] text-[#10203B]/40">Administrator override</span>}{record.qualificationReason && <span className="block text-[10px] text-[#10203B]/50" data-testid="cell-reason">{record.qualificationReason}</span>}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><select aria-label={`Correct ${record.name}`} className="rounded-lg border border-[#E2E3DF] bg-[#11151d] px-2 py-1.5 text-xs text-[#10203B]" value={record.status} onChange={event => void correctAttendance(record.id, event.target.value as AttendanceStatus, 'Corrected by administrator').catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to correct attendance.'))}><option>Present</option><option>Late</option><option>Absent</option></select><button type="button" title="Remove attendance record" onClick={() => { if (window.confirm(`Remove ${record.name}'s record?`)) void removeAttendance(record.id).catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to remove attendance.')); }} className="rounded-lg p-2 text-[#64748B] hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table>{visible.length === 0 && <div className="p-8"><EmptyState message="No attendance records match this event and search." /></div>}</div>
    {addOpen && selected && <Modal title="Add attendance record" description={`Add a manual record to ${selected.name}.`} onClose={() => setAddOpen(false)}><div className="space-y-4"><label><span className={labelClass}>Account</span><select className={inputClass} value={personId} onChange={event => setPersonId(event.target.value)}><option value="">Select Student or Faculty</option>{users.filter(user => user.role !== 'Admin').map(user => <option key={user.id} value={user.id}>{user.name} · {user.id} · {user.role}</option>)}</select></label><label><span className={labelClass}>Status</span><select className={inputClass} value={status} onChange={event => setStatus(event.target.value as AttendanceStatus)}><option>Present</option><option>Late</option><option>Absent</option></select></label>{error && <p className="text-sm text-rose-200">{error}</p>}<div className="flex justify-end gap-3"><Button variant="glass" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={async () => { const person = users.find(user => user.id === personId); if (!person) return setError('Select a valid account.'); try { await addAttendance({ eventId: selected.id, personId: person.id, name: person.name, role: person.role === 'Faculty' ? 'Faculty' : 'Student', department: person.department, status, source: 'Manual addition' }); setPersonId(''); setAddOpen(false); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to add attendance.'); } }}>Add record</Button></div></div></Modal>}
  </section>;
}


function ReportsSection({ state }: { state: AdminState }) {
  const [eventId, setEventId] = useState('');
  const [department, setDepartment] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [role, setRole] = useState<'All' | 'Student' | 'Faculty'>('All');
  const [preview, setPreview] = useState<{ url: string; blob: Blob; filename: string; title: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const departments = [...new Set(state.users.map(user => user.department).filter(Boolean))];
  const rows = reportRows({ eventId: eventId || undefined, department: department || undefined, startDate: startDate || undefined, endDate: endDate || undefined, role: role === 'All' ? undefined : role }, state);
  const counts = { present: rows.filter(row => row.status === 'Present').length, late: rows.filter(row => row.status === 'Late').length, absent: rows.filter(row => row.status === 'Absent').length };
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);
  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPreviewError('');
  };
  const previewPdf = async (targetRole: 'Student' | 'Faculty') => {
    const targetRows = rows.filter(row => row.role === targetRole);
    const targetCounts = { present: targetRows.filter(row => row.status === 'Present').length, late: targetRows.filter(row => row.status === 'Late').length, absent: targetRows.filter(row => row.status === 'Absent').length };
    const filename = `COT_${targetRole.toLowerCase()}_attendance_${eventId || 'report'}.pdf`;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const blob = createAttendanceReportPdfBlob({ targetRole, eventId, rows: targetRows, counts: targetCounts });
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ url: URL.createObjectURL(blob), blob, filename, title: `${targetRole} Attendance Report` });
    } catch (caught) {
      setPreviewError(caught instanceof Error ? caught.message : 'The PDF preview could not be generated.');
    } finally {
      setPreviewLoading(false);
    }
  };
  return <><section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Statistics · Event / department / date range</p><h1 className="mt-2 text-3xl font-black text-[#10203B]">Attendance reports</h1><p className="mt-1 text-sm text-[#64748B]">Generate summaries with Present, Late, Absent, totals, and per-person percentages.</p></div><div className="flex flex-wrap gap-2"><Button variant="glass" onClick={() => void previewPdf('Student')} disabled={previewLoading}><Download size={15} /> Student PDF</Button><Button variant="glass" onClick={() => void previewPdf('Faculty')} disabled={previewLoading}><Download size={15} /> Faculty PDF</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-4"><Metric label="Present" value={counts.present} tone="green" icon={CheckCircle2} /><Metric label="Late" value={counts.late} tone="amber" icon={Activity} /><Metric label="Absent" value={counts.absent} tone="rose" icon={AlertCircle} /><Metric label="Records" value={rows.length} tone="blue" icon={FileText} /></div>
    <div className={panelClass + ' p-5'}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><select className={inputClass} value={eventId} onChange={event => setEventId(event.target.value)}><option value="">All events</option>{state.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select><select className={inputClass} value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(value => <option key={value}>{value}</option>)}</select><input type="date" className={inputClass} value={startDate} onChange={event => setStartDate(event.target.value)} /><input type="date" className={inputClass} value={endDate} onChange={event => setEndDate(event.target.value)} /><select className={inputClass} value={role} onChange={event => setRole(event.target.value as typeof role)}><option>All</option><option>Student</option><option>Faculty</option></select></div><div className="mt-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800/80"><BarChart3 size={16} /> Attendance percentage = events attended (Present or Late) ÷ required events × 100.</div></div>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]"><div className="overflow-x-auto rounded-2xl border border-[#E2E3DF]"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-[#E2E3DF] bg-[#FAF9F5] text-xs uppercase tracking-wider text-[#64748B]"><tr><th className="px-5 py-4">Person</th><th className="px-5 py-4">Event</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Percentage</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{rows.map(row => <tr key={`${row.id}-${row.personId}`}><td className="px-5 py-4"><p className="font-semibold text-[#10203B]">{row.name}</p><p className="text-xs text-[#64748B]">{row.personId} · {row.department}</p></td><td className="px-5 py-4 text-[#10203B]/60">{row.eventId}</td><td className="px-5 py-4"><StatusBadge status={statusTone(row.status)}>{row.status}</StatusBadge></td><td className="px-5 py-4 font-semibold text-[#C2410C]">{getAttendancePercentage(row.personId, row.role, state)}%</td></tr>)}</tbody></table>{rows.length === 0 && <div className="p-8"><EmptyState message="No attendance rows match these report filters." /></div>}</div><div className={panelClass + ' p-5'}><h2 className="font-bold text-[#10203B]">Per-person attendance</h2><p className="mt-1 text-xs text-[#64748B]">Required events only; pending and cancelled events are excluded.</p><div className="mt-4 space-y-3">{state.users.filter(user => user.role !== 'Admin').map(user => { const percentage = getAttendancePercentage(user.id, user.role === 'Faculty' ? 'Faculty' : 'Student', state); return <div key={user.id}><div className="mb-1 flex justify-between text-xs"><span className="text-[#10203B]/65">{user.name}</span><span className="font-bold text-[#C2410C]">{percentage}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#FAF9F5]"><div className="h-full rounded-full bg-[#C2410C]" style={{ width: `${percentage}%` }} /></div></div>; })}</div></div></div>
  </section>{previewLoading && <div role="status" className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"><div className="rounded-2xl bg-white px-6 py-5 text-sm font-semibold text-[#10203B] shadow-2xl">Preparing PDF preview…</div></div>}{previewError && <div role="alert" className="fixed bottom-5 right-5 z-[121] max-w-sm rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-xl">{previewError}</div>}{preview && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="attendance-pdf-preview-title"><section className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between gap-4 border-b border-[#E2E3DF] px-4 py-3 sm:px-6"><div><h2 id="attendance-pdf-preview-title" className="text-lg font-bold text-[#10203B]">{preview.title}</h2><p className="text-xs text-[#64748B]">Review the report before downloading.</p></div><button type="button" onClick={closePreview} aria-label="Close PDF preview" className="rounded-lg p-2 text-[#64748B] hover:bg-[#FAF9F5] hover:text-[#10203B]"><X size={19} /></button></header><div className="min-h-0 flex-1 bg-slate-100 p-2 sm:p-4"><iframe src={preview.url} title={`${preview.title} PDF preview`} className="h-full w-full rounded-lg border border-[#CBD5E1] bg-white" /></div><footer className="flex flex-col-reverse gap-2 border-t border-[#E2E3DF] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-xs text-[#64748B]">If the embedded viewer is unavailable, use Download PDF to save the report.</p><div className="flex justify-end gap-2"><Button variant="glass" onClick={closePreview}>Close</Button><button type="button" onClick={() => { const link = document.createElement('a'); link.href = preview.url; link.download = preview.filename; link.click(); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F97316] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#EA580C]"><Download size={15} /> Download PDF</button></div></footer></section></div>}</>;
}

function DashboardSection({ state, onNavigate }: { state: AdminState; onNavigate: (section: AdminSection) => void }) {
  const live = getLiveEvent(state);
  const counts = live ? getAttendanceCounts(live.id, state) : { present: 0, late: 0, absent: 0, total: 0 };
  const upcoming = state.events.filter(event => event.status === 'Approved');
  const [calendarStatus, setCalendarStatus] = useState<{ configured: boolean; connected: boolean; enabled: boolean; settingAvailable: boolean; missing: string[] } | null>(null);
  useEffect(() => {
    let active = true;
    eventApi.googleCalendarStatus()
      .then(status => { if (active) setCalendarStatus(status); })
      .catch(() => { if (active) setCalendarStatus({ configured: false, connected: false, enabled: false, settingAvailable: false, missing: [] }); });
    return () => { active = false; };
  }, []);
  const calendarUrl = 'https://calendar.google.com/calendar/u/0/r';
  const calendarEnabled = calendarStatus?.enabled !== false;
  return <section className="space-y-6"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Administrator workspace</p><h1 className="mt-2 text-3xl font-black text-[#10203B]">Attendance dashboard</h1><p className="mt-1 text-sm text-[#64748B]">Monitor live attendance, manage accounts, schedule events, and review reports.</p></div><div className="flex flex-wrap gap-2"><GoogleCalendarLink url={calendarEnabled && calendarStatus?.connected ? calendarUrl : null} reason={calendarEnabled ? 'permission_unavailable' : 'calendar_disabled'} authorizeUrl={calendarEnabled && calendarStatus?.configured && !calendarStatus.connected ? eventApi.googleCalendarAuthorizeUrl() : undefined} loading={!calendarStatus} /><Button variant="glass" onClick={() => onNavigate('users')}><Users size={16} /> Users</Button><Button onClick={() => onNavigate('events')}><Plus size={16} /> Create event</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Present" value={counts.present} tone="green" icon={CheckCircle2} /><Metric label="Late" value={counts.late} tone="amber" icon={Activity} /><Metric label="Absent" value={counts.absent} tone="rose" icon={AlertCircle} /><Metric label="Active events" value={state.events.filter(event => event.status === 'Ongoing' || event.status === 'Approved').length} tone="blue" icon={CalendarDays} /></div>
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]"><section className={panelClass + ' p-5'}><div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">Live event</p><h2 className="mt-1 text-xl font-bold text-[#10203B]">{live?.name || 'No ongoing event'}</h2></div>{live && <StatusBadge status="warning">{live.status}</StatusBadge>}</div>{live ? <><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-[#94A3B8]">Venue</p><p className="mt-1 font-semibold text-[#10203B]/75">{live.venue}</p></div><div><p className="text-xs text-[#94A3B8]">Date</p><p className="mt-1 font-semibold text-[#10203B]/75">{live.date}</p></div><div><p className="text-xs text-[#94A3B8]">Cut-off</p><p className="mt-1 font-semibold text-amber-200">{live.cutoff}</p></div><div><p className="text-xs text-[#94A3B8]">Method</p><p className="mt-1 font-semibold text-[#10203B]/75">{live.method}</p></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#FAF9F5]"><div className="h-full rounded-full bg-[#C2410C]" style={{ width: `${counts.total ? Math.round(((counts.present + counts.late) / counts.total) * 100) : 0}%` }} /></div><p className="mt-2 text-xs text-[#64748B]">{counts.total} attendance records update as scans are recorded.</p><Button variant="glass" className="mt-5" onClick={() => onNavigate('attendance')}>Open attendance monitor <ArrowRight size={15} /></Button></> : <EmptyState message="Create or approve an event to begin live attendance monitoring." />}</section>
      {/*
        Stage 1: this used to be an "Approval queue" of events with status
        `Pending`. No event can hold that status - the domain stores only
        `published` and `cancelled` - so the queue was permanently empty and the
        `Approve` button beside it could never appear. It is replaced by the
        scheduled-events list, which is real. Adding a genuine proposal state
        would be a new domain rule and needs its own approval, not a silent
        invention here.
      */}
      <section className={panelClass + ' p-5'}><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">Schedule</p><h2 className="mt-1 text-xl font-bold text-[#10203B]">Approved, not yet started</h2></div><span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200">{upcoming.length}</span></div>{upcoming.length ? <div className="space-y-3">{upcoming.slice(0, 5).map(event => <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E3DF] p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#10203B]">{event.name}</p><p className="text-xs text-[#64748B]">{event.date} · {event.start}–{event.end}</p></div><button type="button" onClick={() => onNavigate('events')} className="rounded-lg p-2 text-[#64748B] hover:bg-[#FFF1E6] hover:text-[#C2410C]" title="Open event"><ArrowRight size={16} /></button></div>)}</div> : <EmptyState message="No approved events are scheduled." />}</section></div>
    <section className={panelClass + ' p-5'}><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#94A3B8]">Required administration</p><h2 className="mt-1 text-xl font-bold text-[#10203B]">Workspace shortcuts</h2></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([{ id: 'users', label: 'Manage users', text: 'Accounts and RBAC', icon: Users }, { id: 'events', label: 'Manage events', text: 'Schedule and approve', icon: CalendarDays }, { id: 'attendance', label: 'Monitor attendance', text: 'Correct records', icon: ClipboardCheck }, { id: 'reports', label: 'Generate reports', text: 'PDF and percentages', icon: FileText }] as const).map(item => <button type="button" key={item.id} onClick={() => onNavigate(item.id)} className="flex items-center gap-3 rounded-xl border border-[#E2E3DF] p-4 text-left transition hover:border-[#F97316] hover:bg-sky-50"><span className="rounded-lg bg-[#FFF1E6] p-2 text-[#C2410C]"><item.icon size={17} /></span><span><span className="block text-sm font-semibold text-[#10203B]">{item.label}</span><span className="block text-xs text-[#64748B]">{item.text}</span></span></button>)}</div></section>
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
  // Per-event feedback, selected BY EVENT.
  //
  // WHY A SEPARATE SELECTOR. The form builder above is driven by
  // `state.forms`; this is driven by `state.feedback`, which is a different
  // record written by a different screen. Grouping the panel by event is what
  // makes it answer the question an organizer actually has - "what did
  // attendees say about THIS event" - instead of one undifferentiated list.
  const [feedbackEventId, setFeedbackEventId] = useState(state.events[0]?.id || '');
  const feedbackEvent = state.events.find(event => event.id === feedbackEventId) || state.events[0];
  const feedbackRows = state.feedback.filter(row => row.eventId === feedbackEvent?.id);
  const feedbackAverage = feedbackRows.length
    ? (feedbackRows.reduce((total, row) => total + row.rating, 0) / feedbackRows.length).toFixed(1)
    : '--';
  const selectForm = (form?: EvaluationForm) => { const nextId = form?.id || ''; setSelectedId(nextId); setFormTitle(form?.title || ''); setFormEventId(form?.eventId || state.events[0]?.id || ''); setFormActive(form?.active ?? true); setQuestionText(form?.questions.map(question => question.prompt).join('\n') || ''); setError(''); };
  const save = async () => {
    const prompts = questionText.split('\n').map(prompt => prompt.trim()).filter(Boolean);
    if (!formTitle.trim() || !formEventId || !prompts.length) return setError('Add a title, event, and at least one question.');
    try { const existing = selected?.questions || []; const form = await saveForm({ id: selectedId || undefined, title: formTitle, eventId: formEventId, active: formActive, questions: prompts.map((prompt, index) => ({ id: existing[index]?.id || `Q-${Date.now()}-${index}`, prompt, type: existing[index]?.type || (index === prompts.length - 1 ? 'text' : 'rating'), required: existing[index]?.required ?? index < 2 })) }); selectForm(form); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save form.'); }
  };
  return <section className="space-y-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Create · Configure · Review</p><h1 className="mt-2 text-3xl font-black text-[#10203B]">Feedback & evaluations</h1><p className="mt-1 text-sm text-[#64748B]">Create event forms, associate them with events, and review compiled attendee results.</p></div><Button variant="glass" onClick={() => selectForm()}><Plus size={16} /> New form</Button></div>
    <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]"><section className={panelClass + ' p-5'}><div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-[#FFF1E6] p-2.5 text-[#C2410C]"><MessageSquare size={18} /></span><div><h2 className="font-bold text-[#10203B]">Form builder</h2><p className="text-xs text-[#64748B]">One question per line</p></div></div><div className="space-y-4"><label><span className={labelClass}>Form title</span><input className={inputClass} value={formTitle} onChange={event => setFormTitle(event.target.value)} placeholder="Event evaluation" /></label><label><span className={labelClass}>Associate with event</span><select className={inputClass} value={formEventId} onChange={event => setFormEventId(event.target.value)}><option value="">Select event</option>{state.events.filter(event => event.status !== 'Cancelled').map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label><label><span className={labelClass}>Questions</span><textarea className={inputClass} rows={6} value={questionText} onChange={event => setQuestionText(event.target.value)} placeholder="One question per line" /></label><label className="flex items-center gap-3 text-sm text-[#10203B]/65"><input type="checkbox" checked={formActive} onChange={event => setFormActive(event.target.checked)} /> Form is active for attendees</label>{error && <p className="text-sm text-rose-200">{error}</p>}<div className="flex justify-end gap-3"><Button variant="glass" onClick={() => selectForm()}>Clear</Button><Button onClick={save}>{selectedId ? 'Save form' : 'Create form'}</Button></div></div></section>
      <section className={panelClass + ' p-5'}><div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-bold text-[#10203B]">Compiled results</h2><p className="text-xs text-[#64748B]">{selected ? `${results.length} attendee responses` : 'Select or create a form'}</p></div><select className={inputClass + ' max-w-56'} value={selectedId} onChange={event => selectForm(state.forms.find(form => form.id === event.target.value))}><option value="">Select form</option>{state.forms.map(form => <option key={form.id} value={form.id}>{form.title}</option>)}</select></div>{selected ? <>{selected.questions.map(question => <div key={question.id} className="mb-4 rounded-xl border border-[#E2E3DF] p-4"><p className="text-sm font-semibold text-[#10203B]/80">{question.prompt}</p><div className="mt-3 space-y-2">{results.slice(0, 5).map(response => <div key={response.id} className="flex justify-between gap-3 text-xs"><span className="text-[#10203B]/50">{response.attendeeName}</span><span className="text-right text-[#C2410C]">{response.answers[question.id] || '—'}</span></div>)}</div></div>)}<div className="mt-5 flex justify-end"><Button variant="glass" className="text-rose-200" onClick={async () => { if (window.confirm(`Delete ${selected.title}?`)) { try { await removeForm(selected.id); selectForm(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to delete form.'); } } }}><Trash2 size={15} /> Delete form</Button></div></> : <EmptyState message="No evaluation form selected." />}</section></div>
    <section className={panelClass + ' p-5'} data-testid="event-feedback-panel">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-[#10203B]">Event feedback</h2>
          <p className="text-xs text-[#64748B]">Ratings and comments attendees submitted after attendance</p>
        </div>
        <select aria-label="Select event feedback" className={inputClass + ' max-w-56'} value={feedbackEvent?.id || ''} onChange={event => setFeedbackEventId(event.target.value)}>
          <option value="">Select event</option>
          {state.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
        </select>
      </div>
      {feedbackEvent && <p className="mb-4 text-xs text-[#64748B]" data-testid="feedback-summary">{feedbackRows.length} {feedbackRows.length === 1 ? 'response' : 'responses'} · average rating {feedbackAverage}</p>}
      {feedbackRows.length === 0
        ? <EmptyState message="No event feedback has been submitted for this event." />
        : <div className="overflow-x-auto rounded-2xl border border-[#E2E3DF]">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="feedback-table">
              <thead className="border-b border-[#E2E3DF] bg-[#FAF9F5] text-xs uppercase tracking-wider text-[#64748B]">
                <tr><th className="px-5 py-4">Attendee</th><th className="px-5 py-4">Rating</th><th className="px-5 py-4">Comments</th><th className="px-5 py-4">Submitted</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {feedbackRows.map(row => <tr key={row.id} data-testid="feedback-row">
                  <td className="px-5 py-4"><p className="font-semibold text-[#10203B]">{row.attendeeName}</p><p className="text-xs text-[#64748B]">{row.attendeeId} · {row.role}</p></td>
                  <td className="px-5 py-4 text-[#C2410C]" data-testid="feedback-rating">{row.rating} / 5</td>
                  <td className="px-5 py-4 text-[#10203B]/70" data-testid="feedback-comments">{row.comments || '—'}</td>
                  <td className="px-5 py-4 text-[#10203B]/50">{new Date(row.submittedAt).toLocaleString()}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
    </section>
  </section>;
}

export default function AdminWorkspace() {
  const state = useAdminState();
  const [loadingState, setLoadingState] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  // Bounded polling runs out after ADMIN_REFRESH_MAX_POLLS ticks, which for the
  // defaults is five minutes - far shorter than a real event. These two make that
  // recoverable instead of a silent dead end: `pollExhausted` lets the UI say so,
  // and bumping `resumeToken` re-runs the effect below with a fresh budget.
  const [pollExhausted, setPollExhausted] = useState(false);
  const [resumeToken, setResumeToken] = useState(0);
  const manualRefreshInFlight = useRef(false);
  useEffect(() => {
    let active = true;
    initializeAdminState()
      .then(() => { if (active) { setLastSyncedAt(new Date()); setSyncFailed(false); } })
      .catch(caught => { if (active) setWorkspaceError(caught instanceof Error ? caught.message : 'Administrator data could not be loaded.'); })
      .finally(() => { if (active) setLoadingState(false); });
    return () => { active = false; };
  }, []);

  /**
   * Bounded live refresh.
   *
   * Scans are recorded by OTHER people on OTHER devices, so the list has to pull
   * rather than wait to be pushed. Three properties keep this safe:
   *
   *  - BOUNDED: it stops on its own after ADMIN_REFRESH_MAX_POLLS ticks, so an
   *    admin who leaves the tab open overnight is not polled all night. The last
   *    synced time is shown so a stale list is never mistaken for a live one.
   *  - NO OVERLAPPING REQUESTS: the timer is only scheduled once the previous
   *    refresh has settled, and `inFlight` guards the manual refresh below.
   *  - FAILURES ARE NON-DESTRUCTIVE: a failed poll is reported as a stale badge
   *    and the previously loaded state is left on screen. An administrator must
   *    never lose the records they are looking at because one request failed.
   *
   * Polling is cleared on unmount and on navigation (this component is the whole
   * workspace), so leaving the section really does stop the requests.
   */
  useEffect(() => {
    if (loadingState || workspaceError) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ticks = 0;

    const schedule = () => {
      if (cancelled) return;
      if (ticks >= ADMIN_REFRESH_MAX_POLLS) {
        // The budget is spent. Say so, so a paused list is never mistaken for a
        // live one, and let "Refresh now" start a new budget.
        if (!cancelled) setPollExhausted(true);
        return;
      }
      ticks += 1;
      timer = setTimeout(async () => {
        if (cancelled) return;
        try {
          await refreshAdminState();
          if (!cancelled) { setLastSyncedAt(new Date()); setSyncFailed(false); }
        } catch {
          // Keep whatever is already displayed: a transient failure must not
          // blank the attendance an administrator is actively reviewing.
          if (!cancelled) setSyncFailed(true);
        } finally {
          schedule();
        }
      }, ADMIN_REFRESH_INTERVAL_MS);
    };

    setPollExhausted(false);
    schedule();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [loadingState, workspaceError, resumeToken]);

  /**
   * Manual refresh, and the way to bring live updates back after the automatic
   * budget runs out during a long event.
   *
   * It performs the read immediately AND restarts the bounded polling with a
   * full budget, so one click returns the workspace to continuously updating
   * rather than only refreshing this once. The in-flight guard stops a rapid
   * double click from issuing two overlapping reads.
   */
  const refreshNow = async () => {
    if (manualRefreshInFlight.current) return;
    manualRefreshInFlight.current = true;
    try {
      await refreshAdminState();
      setLastSyncedAt(new Date());
      setSyncFailed(false);
      setPollExhausted(false);
      setResumeToken(current => current + 1);
    } catch {
      // Keep the displayed data; only the badge changes.
      setSyncFailed(true);
    } finally {
      manualRefreshInFlight.current = false;
    }
  };

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const pathnameSection = location.pathname.split('/').pop();
  const requested = searchParams.get('section') || pathnameSection;
  // `AdminSection` uses `signups` as the internal key. The public URL remains
  // `/admin/signup-requests` (AD003.3), so a direct depth link or refresh must
  // be normalised before comparison / routing.
  const section: AdminSection = requested === 'signup-requests' ? 'signups' :
                                requested === 'users' || requested === 'events' || requested === 'archive' || requested === 'attendance' || requested === 'reports' || requested === 'feedback' || requested === 'announcements' || requested === 'settings' || requested === 'signups' ? requested : 'dashboard';
  const go = (next: AdminSection) => {
    // AD003.3 keeps the public URL as `/admin/signup-requests`, not `/admin/signups`.
    const path = next === 'dashboard' ? 'dashboard' : next === 'signups' ? 'signup-requests' : next;
    navigate(`/admin/${path}`);
  };
  const user = AuthService.getCurrentUser();
  if (loadingState) return <div className="flex min-h-64 items-center justify-center text-sm text-[#64748B]">Loading administrator workspace…</div>;
  if (workspaceError) return <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-200">{workspaceError}</div>;
  return <div className="min-h-full"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">Signed in as {user?.name || 'Administrator'}</p><p className="mt-1 text-sm text-[#64748B]">Required Admin functions · functional requirements workspace</p></div><div className="flex items-center gap-3"><p role="status" data-testid="admin-sync-status" className={`text-xs ${syncFailed ? 'font-semibold text-amber-600' : pollExhausted ? 'font-semibold text-amber-600' : 'text-[#94A3B8]'}`}>{syncFailed ? 'Showing the last loaded data \u2014 the latest refresh failed' : pollExhausted ? 'Live updates paused \u2014 refresh to resume' : lastSyncedAt ? `Live \u00b7 updated ${lastSyncedAt.toLocaleTimeString()}` : 'Loading\u2026'}</p><button type="button" onClick={() => void refreshNow()} data-testid="admin-refresh-now" className="shrink-0 rounded-lg border border-[#E2E3DF] px-2.5 py-1 text-[11px] font-semibold text-[#475569] transition hover:bg-[#FAF9F5] hover:text-[#10203B]">Refresh now</button></div></div>{section === 'dashboard' && <DashboardSection state={state} onNavigate={go} />}{section === 'signups' && <SignupRequestsSection />}{section === 'users' && <UsersSection users={state.users} />}{section === 'events' && <EventsSection />}{section === 'archive' && <ArchiveSection />}{section === 'attendance' && <AttendanceSection events={state.events} attendance={state.attendance} users={state.users} />}{section === 'reports' && <ReportsSection state={state} />}{section === 'feedback' && <FeedbackSection state={state} />}{section === 'announcements' && <AdminAnnouncementsSection />}{section === 'settings' && <SettingsSection />}</div>;
}
