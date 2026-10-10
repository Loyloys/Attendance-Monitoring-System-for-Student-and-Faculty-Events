import { useSyncExternalStore } from 'react';
import { eventApi } from './eventApi';

export type AdminRole = 'Admin' | 'Faculty' | 'Student';
export type AccountStatus = 'Active' | 'Inactive';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type EventAudience = 'All' | 'Student' | 'Faculty';
/**
 * Display statuses only. The STORED statuses are just `published` and
 * `cancelled` (backend EVENT_STATUSES); `Approved`, `Ongoing` and `Completed`
 * are derived by the server from the event's own clock. `Pending` was removed
 * because no event can hold it, and offering it published the event silently.
 */
export type EventStatus = 'Approved' | 'Ongoing' | 'Completed' | 'Cancelled';
export type AttendanceStatus = 'Present' | 'Late' | 'Absent';
export type EventOrigin = 'Admin' | 'Student organization' | 'Faculty';

export interface AdminUserAccount {
  id: string;
  username: string;
  name: string;
  email: string;
  contact: string;
  role: AdminRole;
  department: string;
  status: AccountStatus;
  /** Administrator-controlled access state. New registrations are `approved` at once. */
  approvalStatus: ApprovalStatus;
  signedUpViaGoogle?: boolean;
  createdAt: string;
  /**
   * How many events this person has a CURRENT (`registered`) event registration
   * for. Zero means "account created, no event registrations", which is a
   * different thing from the account being inactive.
   */
  eventRegistrationCount?: number;
  /** Attendance records, counted separately: registering is not attending. */
  attendanceCount?: number;
  year?: number;
  passwordHash?: string;
  legacyRole?: AdminRole;
  legacyId?: string;
}

/**
 * One user's event registrations, with attendance reported independently.
 *
 * `attendanceStatus` is null when no attendance record exists for that event,
 * which is deliberately different from `absent`: "registered but nothing recorded"
 * and "marked absent" are different states and must not be conflated.
 */
export interface AdminUserRegistration {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  eventStatus: string | null;
  registrationStatus: 'registered' | 'cancelled';
  registeredAt: string;
  attendanceStatus: AttendanceStatus | null;
  checkedInAt: string | null;
}

export interface AdminUserRegistrationDetail {
  account: {
    id: string;
    name: string;
    email: string;
    role: 'student' | 'faculty' | 'admin';
    department: string;
    status: AccountStatus;
    approvalStatus: ApprovalStatus;
    createdAt: string;
  };
  registrations: AdminUserRegistration[];
}

export interface AdminEvent {
  id: string;
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
  method: 'QR Code' | 'Barcode' | 'ID range' | 'Manual attendance';
  identifierRange: string;
  cutoff: string;
  status: EventStatus;
  /**
   * Whether Students must register before checking in. Reported under its own
   * name so the editor can show and edit it as the distinct question it is.
   */
  registrationRequired: boolean;
  /** No deadline when null: registration, if required, stays open until start. */
  registrationDeadline: string | null;
  /** Whether this event counts toward a person's attendance percentage. */
  requiredForAttendance: boolean;
  /**
   * Null when the stored record has no usable creation timestamp. That is a real
   * state, not a placeholder: the server reports "unknown" rather than inventing
   * a date, so a malformed record is visible instead of failing the whole list.
   */
  createdAt: string | null;
  organizerId?: string;
  /**
   * GST004: the venue geofence, named exactly as the server sends it.
   *
   * These were previously declared as `latitude` / `longitude` / `radiusMeters`,
   * which is the naming `SavedVenue` uses but NOT the naming an event uses, so
   * the three fields were dead: nothing populated them and nothing read them.
   * The editor's `openEdit` therefore had no typed way to reach a saved event's
   * stored fence, which is how reopening a geofenced event showed a blank zone.
   *
   * `undefined` (blank) is a real state, not a placeholder: it means the event
   * has no geofence configured, and must stay distinguishable from 0, which is a
   * genuine coordinate at null island. See Workspace.tsx `openEdit`.
   */
  venueLatitude?: number;
  venueLongitude?: number;
  venueRadiusMeters?: number;
  targetPrograms?: string[];
  qrExpiresAt?: string;
  /** GST006: required in-zone minutes. Null/undefined means "not configured" - it
   * is never backfilled, so existing events keep tracking switched off. */
  requiredAttendanceMinutes?: number | null;
  checkInOpensAt?: string;
  minStayMinutes?: number;
  checkOutRequired?: boolean;
}

export interface AdminAttendanceRecord {
  id: string;
  eventId: string;
  personId: string;
  name: string;
  role: 'Student' | 'Faculty';
  department: string;
  status: AttendanceStatus;
  scannedAt?: string;
  source: 'Scan' | 'Manual addition' | 'Manual correction';
  note?: string;
  correctedAt?: string;
  checkInAt?: string;
  checkOutAt?: string;
  minutesStayed?: number;
  requiredMinutes?: number;
  eventDate?: string;

  // --- Duration-based qualification (GST008) ------------------------------
  //
  // SEPARATE from `status` on purpose. `status` is what the scan recorded and is
  // never rewritten by the rule; `qualification` is whether the required
  // verified in-zone time has been served.
  //
  // `undefined` means "this event requires no verified duration", which is NOT
  // the same as 'Pending'. The table must say "Not required" rather than show an
  // unqualified record, so the two can never be confused.
  qualification?: 'Pending' | 'Present' | 'Late' | 'Absent';
  /** Why the record is not qualified, when there is a reason to give. */
  qualificationReason?: string;
  /** Server-owned verified in-zone seconds. Shown, never recomputed. */
  verifiedSeconds?: number;
  requiredAttendanceMinutes?: number;
  locationState?: 'inside' | 'outside';
  lastLocationAt?: string;
  trackingState?: 'tracking' | 'paused' | 'ended';
  /** A person decided this row; the automatic rule must never overwrite it. */
  manualOverride?: boolean;
}

export interface EvaluationQuestion {
  id: string;
  prompt: string;
  type: 'rating' | 'text';
  required: boolean;
}

export interface EvaluationForm {
  id: string;
  title: string;
  eventId: string;
  questions: EvaluationQuestion[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationResponse {
  id: string;
  formId: string;
  eventId: string;
  attendeeId: string;
  attendeeName: string;
  role: 'Student' | 'Faculty';
  answers: Record<string, string>;
  submittedAt: string;
}

/**
 * One per-event feedback response a student or faculty member submitted after
 * attendance (`POST /api/events/:id/feedback/`).
 *
 * A SEPARATE RECORD FROM `EvaluationResponse`. The evaluation form and its
 * compiled answers are one mechanism; this is the rating-and-comments the
 * Portal's "Event feedback" screen posts, which historically no administrator
 * route could read. Both are exposed because attendees can do both.
 *
 * Attributed, like an evaluation response: the public account id, the display
 * name and the role. The person's internal database id is never published.
 */
export interface EventFeedbackRecord {
  id: string;
  eventId: string;
  attendeeId: string;
  attendeeName: string;
  role: 'Student' | 'Faculty';
  rating: number;
  comments: string;
  submittedAt: string;
}

export interface AdminState {
  version: 1;
  users: AdminUserAccount[];
  events: AdminEvent[];
  attendance: AdminAttendanceRecord[];
  forms: EvaluationForm[];
  responses: EvaluationResponse[];
  feedback: EventFeedbackRecord[];
  revokedIdentifiers: string[];
}

const emptyState: AdminState = {
  version: 1,
  users: [],
  events: [],
  attendance: [],
  forms: [],
  responses: [],
  feedback: [],
  revokedIdentifiers: [],
};

let state = emptyState;
let loading: Promise<AdminState> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const setState = (next: AdminState) => { state = next; emit(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useAdminState() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getAdminState() {
  return state;
}

const LEGACY_ADMIN_STORAGE_KEY = 'cot-admin-requirements-v1';

async function archiveLegacyAdminState() {
  const raw = localStorage.getItem(LEGACY_ADMIN_STORAGE_KEY);
  if (!raw) return;
  const payload = JSON.parse(raw) as AdminState;
  await eventApi.importLegacyBrowserState(payload);
  localStorage.removeItem(LEGACY_ADMIN_STORAGE_KEY);
}

export async function initializeAdminState() {
  await archiveLegacyAdminState();
  return refreshAdminState();
}

export function refreshAdminState() {
  if (!loading) {
    loading = eventApi.adminState()
      .then((next) => { setState(next); return next; })
      .finally(() => { loading = null; });
  }
  return loading;
}

export const getLiveEvent = (target: AdminState = state) => target.events.find(event => event.status === 'Ongoing') || null;
export const getEventAttendance = (eventId: string, target: AdminState = state) => target.attendance.filter(record => record.eventId === eventId);

export const getAttendanceCounts = (eventId: string, target: AdminState = state) => {
  const records = getEventAttendance(eventId, target);
  return {
    present: records.filter(record => record.status === 'Present').length,
    late: records.filter(record => record.status === 'Late').length,
    absent: records.filter(record => record.status === 'Absent').length,
    total: records.length,
  };
};

const eventCoversDepartment = (eventDepartment: string, userDepartment: string) => {
  const eventValue = eventDepartment.trim().toLowerCase();
  const userValue = userDepartment.trim().toLowerCase();
  return !eventValue || eventValue === 'all' || eventValue === 'all cot programs' || eventValue === 'college of technologies' || eventValue === userValue || eventValue.includes(userValue) || userValue.includes(eventValue);
};

export const getExpectedAttendeeIds = (eventId: string, target: AdminState = state) => {
  const event = target.events.find(item => item.id === eventId);
  if (!event) return [] as string[];
  return target.users.filter(user => user.status === 'Active' && user.role !== 'Admin' && (event.audience === 'All' || event.audience === user.role) && eventCoversDepartment(event.department, user.department)).map(user => user.id);
};

export const getAttendanceCountsWithExpected = (eventId: string, target: AdminState = state) => {
  const counts = getAttendanceCounts(eventId, target);
  const expected = getExpectedAttendeeIds(eventId, target);
  const presentOrLate = counts.present + counts.late;
  return { ...counts, absent: Math.max(counts.absent, expected.length - presentOrLate), total: Math.max(counts.total, expected.length) };
};

export const getAttendancePercentage = (personId: string, role: 'Student' | 'Faculty', target: AdminState = state) => {
  const person = target.users.find(user => user.id === personId || user.legacyId === personId);
  // `Pending` is no longer excluded because it can no longer occur: the stored
  // statuses are only published/cancelled and the rest are derived. Cancelled
  // events are still excluded, since a cancelled event is not attendance-bearing.
  const requiredEvents = target.events.filter(event => event.requiredForAttendance && event.status !== 'Cancelled' && (event.audience === 'All' || event.audience === role) && (!person || eventCoversDepartment(event.department, person.department)));
  if (!requiredEvents.length) return 0;
  const attended = requiredEvents.filter(event => target.attendance.some(record => record.eventId === event.id && record.personId === personId && (record.status === 'Present' || record.status === 'Late'))).length;
  return Math.round((attended / requiredEvents.length) * 100);
};

export const isAfterCutoff = (event: Pick<AdminEvent, 'cutoff'>, scannedAt: string) => {
  const date = new Date(scannedAt);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return time > event.cutoff;
};

export const reportRows = (filters: { eventId?: string; department?: string; startDate?: string; endDate?: string; role?: 'Student' | 'Faculty' }, target: AdminState = state) => {
  const eventById = new Map(target.events.map(event => [event.id, event]));
  return target.attendance.filter(record => {
    const event = eventById.get(record.eventId);
    if (!event) return false;
    return (!filters.eventId || record.eventId === filters.eventId)
      && (!filters.department || record.department === filters.department)
      && (!filters.role || record.role === filters.role)
      && (!filters.startDate || event.date >= filters.startDate)
      && (!filters.endDate || event.date <= filters.endDate);
  });
};


// `approvalStatus` is excluded: an administrator-created account is approved by
// the act of creating it. Only Google self-registrations arrive as `pending`.
export async function addUser(input: Omit<AdminUserAccount, 'id' | 'createdAt' | 'status' | 'legacyRole' | 'approvalStatus' | 'signedUpViaGoogle'> & { id?: string; status?: AccountStatus }) {
  if (!input.id) throw new Error('Account ID is required.');
  const created = await eventApi.createAdminUser({
    ...input,
    id: input.id,
    passwordHash: input.passwordHash,
  });
  await refreshAdminState();
  return created;
}

/**
 * How this account is described on the User Management screen.
 *
 * Account creation and event registration are separate facts and are labelled
 * separately. An active account with no registrations is a normal state, not a
 * problem, so it is never presented as if something were missing.
 */
export const eventParticipationLabel = (user: AdminUserAccount) => {
  const count = user.eventRegistrationCount ?? 0;
  if (count === 0) return 'Account created - no event registrations';
  return `Registered for ${count} event${count === 1 ? '' : 's'}`;
};

/**
 * Registrations for one user. Loaded on demand by the administrator screen
 * rather than being part of the shared state, so it is never fetched for
 * anyone who cannot already administer accounts.
 */
export async function loadUserRegistrations(id: string) {
  return eventApi.adminUserRegistrations(id);
}

export async function updateUser(id: string, patch: Partial<Omit<AdminUserAccount, 'createdAt' | 'legacyRole'>>) {
  const updated = await eventApi.updateAdminUser(id, patch);
  await refreshAdminState();
  return updated;
}

export async function setUserStatus(id: string, status: AccountStatus) {
  return updateUser(id, { status });
}

export async function removeUser(id: string) {
  await eventApi.deleteAdminUser(id);
  await refreshAdminState();
}

export async function addAttendance(input: Omit<AdminAttendanceRecord, 'id'>) {
  const created = await eventApi.createAdminAttendance({
    eventId: input.eventId,
    personId: input.personId,
    status: input.status,
    note: input.note,
  });
  await refreshAdminState();
  return created;
}

export async function correctAttendance(id: string, status: AttendanceStatus, note: string) {
  const updated = await eventApi.updateAdminAttendance(id, { status, note });
  await refreshAdminState();
  return updated;
}

export async function removeAttendance(id: string) {
  await eventApi.deleteAdminAttendance(id);
  await refreshAdminState();
}

export async function saveForm(input: Omit<EvaluationForm, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const saved = await eventApi.saveAdminForm(input);
  await refreshAdminState();
  return saved;
}

export async function removeForm(id: string) {
  await eventApi.deleteAdminForm(id);
  await refreshAdminState();
}

export const getFormResults = (formId: string) => state.responses.filter(response => response.formId === formId);

