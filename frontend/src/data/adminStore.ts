import { useSyncExternalStore } from 'react';
import { eventApi } from './eventApi';

export type AdminRole = 'Admin' | 'Faculty' | 'Student';
export type AccountStatus = 'Active' | 'Inactive';
export type EventAudience = 'All' | 'Student' | 'Faculty';
export type EventStatus = 'Pending' | 'Approved' | 'Ongoing' | 'Completed' | 'Cancelled';
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
  createdAt: string;
  year?: number;
  passwordHash?: string;
  legacyRole?: AdminRole;
  legacyId?: string;
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
  requiredForAttendance: boolean;
  createdAt: string;
  organizerId?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  registrationRequired?: boolean;
  targetPrograms?: string[];
  qrExpiresAt?: string;
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

export interface AdminState {
  version: 1;
  users: AdminUserAccount[];
  events: AdminEvent[];
  attendance: AdminAttendanceRecord[];
  forms: EvaluationForm[];
  responses: EvaluationResponse[];
  revokedIdentifiers: string[];
}

const emptyState: AdminState = {
  version: 1,
  users: [],
  events: [],
  attendance: [],
  forms: [],
  responses: [],
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
  const requiredEvents = target.events.filter(event => event.requiredForAttendance && event.status !== 'Pending' && event.status !== 'Cancelled' && (event.audience === 'All' || event.audience === role) && (!person || eventCoversDepartment(event.department, person.department)));
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


export async function addUser(input: Omit<AdminUserAccount, 'id' | 'createdAt' | 'status' | 'legacyRole'> & { id?: string; status?: AccountStatus }) {
  if (!input.id) throw new Error('Account ID is required.');
  const created = await eventApi.createAdminUser({
    ...input,
    id: input.id,
    passwordHash: input.passwordHash,
  });
  await refreshAdminState();
  return created;
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

