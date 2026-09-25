
import { useSyncExternalStore } from 'react';

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

const STORAGE_KEY = 'cot-admin-requirements-v1';
const listeners = new Set<() => void>();
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const initialUsers = (): AdminUserAccount[] => [
  { id: 'STU001', username: 'student', passwordHash: 'student123', name: 'Alice Johnson', email: 'student@cot.edu', contact: 'student@cot.edu', role: 'Student', department: 'Information Technology', year: 3, status: 'Active', createdAt: '2024-01-15T10:00:00Z' },
  { id: 'STU002', username: 'bob.smith', passwordHash: 'student123', name: 'Bob Smith', email: 'bob.smith@cot.edu', contact: 'bob.smith@cot.edu', role: 'Student', department: 'Information Technology', year: 2, status: 'Active', createdAt: '2024-01-15T10:00:00Z' },
  { id: 'FAC001', username: 'faculty', passwordHash: 'faculty123', name: 'Dr. Sarah Johnson', email: 'faculty@cot.edu', contact: 'faculty@cot.edu', role: 'Faculty', department: 'College of Technologies', status: 'Active', createdAt: '2024-01-15T10:00:00Z' },
  { id: 'ADM001', username: 'admin', passwordHash: 'admin123', name: 'System Administrator', email: 'admin@cot.edu', contact: 'admin@cot.edu', role: 'Admin', department: 'Administration', status: 'Active', createdAt: '2024-01-01T00:00:00Z' },
];


const now = () => new Date().toISOString();
const today = '2026-09-24';

const initialEvents = (): AdminEvent[] => [
  { id: 'EVT-001', name: 'Technology Innovation Summit', description: 'Annual College of Technologies showcase.', date: '2026-09-18', start: '08:00', end: '16:00', venue: 'Innovation Hall', organizer: 'College of Technologies', origin: 'Admin', audience: 'All', department: 'College of Technologies', method: 'QR Code', identifierRange: 'All active students and faculty', cutoff: '08:15', status: 'Approved', requiredForAttendance: true, createdAt: '2026-09-01T08:00:00Z' },
  { id: 'EVT-002', name: 'Student Developers Meetup', description: 'A student organization event for project demonstrations and technical networking.', date: today, start: '10:00', end: '13:00', venue: 'Innovation Lab 2', organizer: 'COT Student Organization', origin: 'Student organization', audience: 'Student', department: 'BSIT', method: 'QR Code', identifierRange: 'BSIT and BSEMC students', cutoff: '10:15', status: 'Ongoing', requiredForAttendance: true, createdAt: '2026-09-02T09:00:00Z' },
  { id: 'EVT-003', name: 'COT Faculty Research Colloquium', description: 'Faculty-led presentations and collaborative discussion.', date: '2026-09-11', start: '14:00', end: '17:00', venue: 'COT Conference Room', organizer: 'COT Faculty', origin: 'Faculty', audience: 'Faculty', department: 'College of Technologies', method: 'ID range', identifierRange: 'COT faculty', cutoff: '14:15', status: 'Completed', requiredForAttendance: true, organizerId: 'EMP001', createdAt: '2026-09-01T10:00:00Z' },
  { id: 'EVT-004', name: 'Student Organization Election Briefing', description: 'Briefing submitted by the COT Student Organization for approval.', date: '2026-10-03', start: '09:00', end: '11:00', venue: 'Main Auditorium', organizer: 'COT Student Organization', origin: 'Student organization', audience: 'Student', department: 'All COT programs', method: 'Barcode', identifierRange: 'Registered student voters', cutoff: '09:15', status: 'Pending', requiredForAttendance: false, createdAt: '2026-09-20T07:30:00Z' },
  { id: 'EVT-005', name: 'Faculty Research Methodology Workshop', description: 'Faculty proposal awaiting administrator approval.', date: '2026-10-05', start: '13:00', end: '16:00', venue: 'Innovation Hall', organizer: 'COT Faculty', origin: 'Faculty', audience: 'Faculty', department: 'College of Technologies', method: 'QR Code', identifierRange: 'COT faculty', cutoff: '13:15', status: 'Pending', requiredForAttendance: true, createdAt: '2026-09-21T11:00:00Z' },
];

const initialAttendance = (): AdminAttendanceRecord[] => [
  { id: 'ATT-001', eventId: 'EVT-002', personId: 'STU001', name: 'Alice Johnson', role: 'Student', department: 'BSIT', status: 'Present', scannedAt: `${today}T10:04:00Z`, source: 'Scan' },
  { id: 'ATT-002', eventId: 'EVT-002', personId: 'STU002', name: 'Bob Smith', role: 'Student', department: 'BSIT', status: 'Late', scannedAt: `${today}T10:21:00Z`, source: 'Scan' },
  { id: 'ATT-003', eventId: 'EVT-002', personId: 'STU003', name: 'Charlie Brown', role: 'Student', department: 'BSAT', status: 'Absent', source: 'Manual addition' },
  { id: 'ATT-004', eventId: 'EVT-002', personId: 'STU005', name: 'Diana Wilson', role: 'Student', department: 'BSET', status: 'Present', scannedAt: `${today}T10:08:00Z`, source: 'Scan' },
  { id: 'ATT-005', eventId: 'EVT-001', personId: 'STU001', name: 'Alice Johnson', role: 'Student', department: 'BSIT', status: 'Present', scannedAt: '2026-09-18T08:03:00Z', source: 'Scan' },
  { id: 'ATT-006', eventId: 'EVT-001', personId: 'STU002', name: 'Bob Smith', role: 'Student', department: 'BSIT', status: 'Late', scannedAt: '2026-09-18T08:19:00Z', source: 'Scan' },
  { id: 'ATT-007', eventId: 'EVT-001', personId: 'STU005', name: 'Diana Wilson', role: 'Student', department: 'BSET', status: 'Present', scannedAt: '2026-09-18T08:11:00Z', source: 'Scan' },
  { id: 'ATT-008', eventId: 'EVT-001', personId: 'EMP001', name: 'Dr. Sarah Johnson', role: 'Faculty', department: 'Information Technology', status: 'Present', scannedAt: '2026-09-18T08:05:00Z', source: 'Scan' },
  { id: 'ATT-009', eventId: 'EVT-001', personId: 'EMP002', name: 'Prof. Michael Brown', role: 'Faculty', department: 'Mathematics', status: 'Absent', source: 'Manual addition' },
  { id: 'ATT-010', eventId: 'EVT-003', personId: 'EMP001', name: 'Dr. Sarah Johnson', role: 'Faculty', department: 'Information Technology', status: 'Present', scannedAt: '2026-09-11T14:03:00Z', source: 'Scan' },
  { id: 'ATT-011', eventId: 'EVT-003', personId: 'EMP002', name: 'Prof. Michael Brown', role: 'Faculty', department: 'Mathematics', status: 'Late', scannedAt: '2026-09-11T14:21:00Z', source: 'Scan' },
];

const initialForms = (): EvaluationForm[] => [
  {
    id: 'FORM-001', title: 'Technology Innovation Summit evaluation', eventId: 'EVT-001', active: true,
    createdAt: '2026-09-01T08:00:00Z', updatedAt: '2026-09-01T08:00:00Z',
    questions: [
      { id: 'Q-001', prompt: 'How would you rate the event?', type: 'rating', required: true },
      { id: 'Q-002', prompt: 'Was the event organized well?', type: 'rating', required: true },
      { id: 'Q-003', prompt: 'What can be improved?', type: 'text', required: false },
    ],
  },
];

const initialResponses = (): EvaluationResponse[] => [
  { id: 'RES-001', formId: 'FORM-001', eventId: 'EVT-001', attendeeId: 'STU001', attendeeName: 'Alice Johnson', role: 'Student', answers: { 'Q-001': 'Excellent', 'Q-002': 'Good', 'Q-003': 'More hands-on demonstrations.' }, submittedAt: '2026-09-18T16:15:00Z' },
  { id: 'RES-002', formId: 'FORM-001', eventId: 'EVT-001', attendeeId: 'STU002', attendeeName: 'Bob Smith', role: 'Student', answers: { 'Q-001': 'Good', 'Q-002': 'Excellent', 'Q-003': 'Keep the same schedule next year.' }, submittedAt: '2026-09-18T16:18:00Z' },
  { id: 'RES-003', formId: 'FORM-001', eventId: 'EVT-001', attendeeId: 'STU005', attendeeName: 'Diana Wilson', role: 'Student', answers: { 'Q-001': 'Excellent', 'Q-002': 'Excellent', 'Q-003': 'No major issues.' }, submittedAt: '2026-09-18T16:20:00Z' },
];

const createInitialState = (): AdminState => ({
  version: 1,
  users: initialUsers(),
  events: initialEvents(),
  attendance: initialAttendance(),
  forms: initialForms(),
  responses: initialResponses(),
  revokedIdentifiers: [],
});



const isAdminState = (value: unknown): value is AdminState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AdminState>;
  return candidate.version === 1 && Array.isArray(candidate.users) && Array.isArray(candidate.events) && Array.isArray(candidate.attendance) && Array.isArray(candidate.forms) && Array.isArray(candidate.responses) && Array.isArray(candidate.revokedIdentifiers);
};

const readState = (): AdminState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isAdminState(parsed)) return parsed;
    }
  } catch {
    // Use the in-memory seed when browser storage is unavailable or corrupt.
  }
  return createInitialState();
};

let state = readState();
const getSnapshot = () => state;

const persist = (next: AdminState) => {
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage may be restricted */ }
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useAdminState = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
export const getAdminState = () => state;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) state = readState();
    listeners.forEach(listener => listener());
  });
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

export const addUser = (input: Omit<AdminUserAccount, 'id' | 'createdAt' | 'status' | 'legacyRole'> & { id?: string; status?: AccountStatus }) => {
  const id = (input.id || makeId(input.role.slice(0, 3).toUpperCase())).trim();
  const username = input.username.trim().toLowerCase();
  if (!input.name.trim() || !username || !input.email.trim() || !input.contact.trim() || !input.department.trim() || !input.passwordHash) throw new Error('Name, username, email, contact, department, and password are required.');
  if (state.users.some(user => user.id.toLowerCase() === id.toLowerCase() || user.username.toLowerCase() === username || user.email.toLowerCase() === input.email.trim().toLowerCase())) throw new Error('Account ID, username, or email already exists.');
  const user: AdminUserAccount = { ...input, id, username, name: input.name.trim(), email: input.email.trim(), contact: input.contact.trim(), department: input.department.trim(), status: input.status || 'Active', createdAt: now() };
  persist({ ...state, users: [...state.users, user] });
  return user;
};

export const updateUser = (id: string, patch: Partial<Omit<AdminUserAccount, 'createdAt' | 'legacyRole'>>) => {
  const currentUser = state.users.find(user => user.id === id);
  if (!currentUser) throw new Error('Account not found.');
  const nextId = (patch.id || currentUser.id).trim();
  const nextRole = patch.role || currentUser.role;
  const nextStatus = patch.status || currentUser.status;
  if (!nextId) throw new Error('Account ID is required.');
  if (currentUser.role === 'Admin' && (nextRole !== 'Admin' || nextStatus !== 'Active') && state.users.filter(user => user.role === 'Admin' && user.status === 'Active').length <= 1) throw new Error('At least one active Admin account is required.');
  const nextUsername = (patch.username || currentUser.username).trim().toLowerCase();
  const nextEmail = (patch.email || currentUser.email).trim().toLowerCase();
  if (state.users.some(user => user.id !== id && (user.id.toLowerCase() === nextId.toLowerCase() || user.username.toLowerCase() === nextUsername || user.email.toLowerCase() === nextEmail))) throw new Error('Account ID, username, or email is already in use.');
  const identityChanged = nextId !== id || nextUsername !== currentUser.username || nextEmail !== currentUser.email;
  const revokedIdentifiers = identityChanged ? [...new Set([...state.revokedIdentifiers, id, currentUser.username, currentUser.email])] : state.revokedIdentifiers;
  const updated: AdminUserAccount = { ...currentUser, ...patch, id: nextId, username: nextUsername, email: nextEmail, createdAt: currentUser.createdAt };
  const canCascadeRole = currentUser.role !== 'Admin' && nextRole !== 'Admin';
  const updatedRole: 'Student' | 'Faculty' = nextRole === 'Faculty' ? 'Faculty' : 'Student';
  const users = state.users.map(user => user.id === id ? updated : user);
  const events = nextId === id ? state.events : state.events.map(event => event.organizerId === id ? { ...event, organizerId: nextId } : event);
  const attendance = canCascadeRole ? state.attendance.map(record => record.personId === id ? { ...record, personId: nextId, name: updated.name, role: updatedRole, department: updated.department } : record) : state.attendance;
  const responses = canCascadeRole ? state.responses.map(response => response.attendeeId === id ? { ...response, attendeeId: nextId, attendeeName: updated.name, role: updatedRole } : response) : state.responses;
  persist({ ...state, users, events, attendance, responses, revokedIdentifiers });
  return updated;
};

export const setUserStatus = (id: string, status: AccountStatus) => updateUser(id, { status });
export const removeUser = (id: string) => {
  const user = state.users.find(item => item.id === id);
  if (!user) throw new Error('Account not found.');
  if (user.role === 'Admin' && user.status === 'Active' && state.users.filter(item => item.role === 'Admin' && item.status === 'Active').length <= 1) throw new Error('At least one active Admin account is required.');
  persist({ ...state, users: state.users.filter(item => item.id !== id), revokedIdentifiers: [...new Set([...state.revokedIdentifiers, user.username.toLowerCase(), user.id.toLowerCase(), user.email.toLowerCase(), user.legacyId?.toLowerCase()].filter(Boolean) as string[])] });
};

export const addEvent = (input: Omit<AdminEvent, 'id' | 'createdAt'>) => {
  const event: AdminEvent = { ...input, id: makeId('EVT'), name: input.name.trim(), venue: input.venue.trim(), organizer: input.organizer.trim(), createdAt: now() };
  persist({ ...state, events: [event, ...state.events] });
  return event;
};

export const updateEvent = (id: string, patch: Partial<Omit<AdminEvent, 'id' | 'createdAt'>>) => {
  let updated: AdminEvent | undefined;
  const events = state.events.map(event => {
    if (event.id !== id) return event;
    updated = { ...event, ...patch, id: event.id, createdAt: event.createdAt };
    return updated;
  });
  if (!updated) throw new Error('Event not found.');
  persist({ ...state, events });
  return updated;
};

export const approveEvent = (id: string) => updateEvent(id, { status: 'Approved' });
export const cancelEvent = (id: string) => updateEvent(id, { status: 'Cancelled' });


export const addAttendance = (input: Omit<AdminAttendanceRecord, 'id'>) => {
  const account = state.users.find(user => user.id === input.personId || user.legacyId === input.personId);
  if (account?.status === 'Inactive') throw new Error('Attendance cannot be added for an inactive account.');
  if (state.attendance.some(record => record.eventId === input.eventId && record.personId === input.personId)) throw new Error('An attendance record already exists for this person and event.');
  const record: AdminAttendanceRecord = { ...input, id: makeId('ATT') };
  persist({ ...state, attendance: [record, ...state.attendance] });
  return record;
};

export const recordScan = (eventId: string, personId: string, name: string, role: 'Student' | 'Faculty', department: string, scannedAt = now()) => {
  const event = state.events.find(item => item.id === eventId);
  if (!event) throw new Error('Event not found.');
  if (event.status !== 'Ongoing') throw new Error('Attendance can only be recorded for an ongoing event.');
  const account = state.users.find(user => user.id === personId || user.legacyId === personId);
  if (account?.status === 'Inactive') throw new Error('Attendance cannot be recorded for an inactive account.');
  if (event.audience !== 'All' && event.audience !== role) throw new Error('This event is not open to the selected attendee role.');
  if (account && !eventCoversDepartment(event.department, account.department)) throw new Error('This event is not assigned to the selected department.');
  const existing = state.attendance.find(record => record.eventId === eventId && record.personId === personId);
  const record: AdminAttendanceRecord = { id: existing?.id || makeId('ATT'), eventId, personId, name, role, department, status: isAfterCutoff(event, scannedAt) ? 'Late' : 'Present', scannedAt, source: 'Scan' };
  persist({ ...state, attendance: existing ? state.attendance.map(item => item.id === existing.id ? record : item) : [record, ...state.attendance] });
  return record;
};

export const correctAttendance = (id: string, status: AttendanceStatus, note: string) => {
  if (!state.attendance.some(record => record.id === id)) throw new Error('Attendance record not found.');
  persist({ ...state, attendance: state.attendance.map(record => record.id === id ? { ...record, status, note: note.trim() || undefined, source: 'Manual correction', correctedAt: now() } : record) });
};

export const removeAttendance = (id: string) => {
  if (!state.attendance.some(record => record.id === id)) throw new Error('Attendance record not found.');
  persist({ ...state, attendance: state.attendance.filter(record => record.id !== id) });
};

export const saveForm = (input: Omit<EvaluationForm, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
  const timestamp = now();
  if (input.id) {
    const existing = state.forms.find(form => form.id === input.id);
    if (!existing) throw new Error('Evaluation form not found.');
    const form: EvaluationForm = { ...input, id: input.id, createdAt: existing.createdAt, updatedAt: timestamp };
    persist({ ...state, forms: state.forms.map(item => item.id === form.id ? form : item) });
    return form;
  }
  const form: EvaluationForm = { ...input, id: makeId('FORM'), createdAt: timestamp, updatedAt: timestamp };
  persist({ ...state, forms: [...state.forms, form] });
  return form;
};

export const addEvaluationResponse = (input: Omit<EvaluationResponse, 'id' | 'submittedAt'>) => {
  if (!state.forms.some(form => form.id === input.formId)) throw new Error('Evaluation form not found.');
  const response: EvaluationResponse = { ...input, id: makeId('RES'), submittedAt: now() };
  persist({ ...state, responses: [response, ...state.responses] });
  return response;
};

export const removeForm = (id: string) => persist({ ...state, forms: state.forms.filter(form => form.id !== id), responses: state.responses.filter(response => response.formId !== id) });
export const getFormResults = (formId: string) => state.responses.filter(response => response.formId === formId);

export const isRevokedIdentifier = (identifier: string) => state.revokedIdentifiers.includes(identifier.trim().toLowerCase());

export const findManagedAccount = (identifier: string) => {
  const normalized = identifier.trim().toLowerCase();
  return state.users.find(user => user.username.toLowerCase() === normalized || user.id.toLowerCase() === normalized || user.email.toLowerCase() === normalized) || null;
};

export const authenticateManagedUser = (identifier: string, password: string, requestedRole: AdminRole) => {
  const user = findManagedAccount(identifier);
  if (!user || isRevokedIdentifier(identifier) || user.status !== 'Active' || user.role !== requestedRole) return null;
  return user.passwordHash === password ? user : null;
};

export const resetAdminDemo = () => persist({ version: 1, users: initialUsers(), events: initialEvents(), attendance: initialAttendance(), forms: initialForms(), responses: initialResponses(), revokedIdentifiers: [] });


