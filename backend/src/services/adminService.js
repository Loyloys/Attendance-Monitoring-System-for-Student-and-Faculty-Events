import crypto from 'node:crypto';
import {
  AttendanceCode,
  AuditLog,
  Event,
  EventAttendance,
  EventCertificate,
  EventFeedback,
  EventRegistration,
  EvaluationForm,
  EvaluationResponse,
  RevokedIdentifier,
  User,
  UserProfile,
} from '../models/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { nextNumericId } from '../utils/ids.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { createDjangoPassword } from '../utils/passwords.js';
import { effectiveEventStatus } from '../utils/events.js';
import { serializeAdminEvents } from './eventService.js';
import { serializeAdminAttendance, serializeAdminUser } from './adminSerializer.js';
import { serializeEvaluationForm, serializeEvaluationResponse } from './evaluationSerializer.js';

const roleMap = { Student: 'student', Faculty: 'faculty', Admin: 'admin' };
const adminRoleMap = { student: 'Student', faculty: 'Faculty', admin: 'Admin' };

async function usersWithProfiles(query = {}) {
  const users = await User.find(query).sort({ accountIdNormalized: 1 }).lean();
  const profiles = await UserProfile.find({ userId: { $in: users.map((user) => user._id) } }).lean();
  const byUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
  return users.map((user) => ({ ...user, profile: byUser.get(String(user._id)) })).filter((user) => user.profile);
}

async function activeAdminCount(excludeId = null) {
  const admins = await UserProfile.find({ role: 'admin' }).lean();
  return User.countDocuments({
    _id: { $in: admins.map((profile) => profile.userId), ...(excludeId ? { $ne: excludeId } : {}) },
    isActive: true,
  });
}

async function assertUniqueIdentity({ accountId, username, email, excludeId = null }) {
  const conflict = await User.findOne({
    _id: excludeId ? { $ne: excludeId } : undefined,
    $or: [
      { accountIdNormalized: stableCaseInsensitive(accountId) },
      { usernameNormalized: stableCaseInsensitive(username) },
      { emailNormalized: stableCaseInsensitive(email) },
    ],
  }).lean();
  if (conflict) throw new ConflictError('Account ID, username, or email is already in use.');
}

async function findUserByAccountId(accountId) {
  const user = await User.findOne({ accountIdNormalized: stableCaseInsensitive(accountId) }).select('+passwordHash');
  if (!user) throw new NotFoundError('Account not found.');
  const profile = await UserProfile.findOne({ userId: user._id });
  if (!profile) throw new NotFoundError('Account profile not found.');
  return { user, profile };
}

export async function listAdminUsers() {
  return (await usersWithProfiles()).map(serializeAdminUser);
}

/**
 * Appends an audit entry. Failures are swallowed on purpose: the account change
 * has already been committed, and losing the audit row must not turn a
 * successful administrator action into a failed request.
 */
async function recordAudit(actor, action, target, detail) {
  if (!actor?._id) return;
  await AuditLog.create({
    actorId: actor._id,
    actorName: actor.profile?.displayName || actor.accountId || '',
    action,
    targetUserId: target.userId,
    targetAccountId: target.accountId || '',
    detail: detail || '',
  }).catch(() => {});
}

export async function createAdminUser(data, actor) {
  const accountId = String(data.id || '').trim();
  const username = String(data.username || '').trim();
  const name = String(data.name || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const contact = String(data.contact || '').trim();
  const department = String(data.department || '').trim();
  const role = roleMap[data.role];
  const password = String(data.passwordHash || data.password || '');
  if (!accountId || !username || !name || !email || !contact || !department || !role || !password) {
    throw new ValidationError({ detail: 'Name, username, email, contact, department, role, and password are required.' });
  }
  await assertUniqueIdentity({ accountId, username, email });
  const user = await User.create({
    accountId,
    accountIdNormalized: stableCaseInsensitive(accountId),
    username,
    usernameNormalized: stableCaseInsensitive(username),
    passwordHash: createDjangoPassword(password),
    email,
    emailNormalized: email,
    isActive: data.status !== 'Inactive',
    isStaff: role === 'admin',
    isSuperuser: false,
    dateJoined: new Date(),
    dataSource: 'managed',
  });
  const profile = await UserProfile.create({
    userId: user._id,
    role,
    displayName: name,
    phone: contact,
    department,
    cardIdentifier: null,
  });
  await recordAudit(actor, 'account_created', { userId: user._id, accountId }, `Created as ${role}`);
  return serializeAdminUser({ ...user.toObject(), profile: profile.toObject() });
}

export async function updateAdminUser(accountId, data, actor) {
  const { user, profile } = await findUserByAccountId(accountId);
  const nextRole = data.role ? roleMap[data.role] : profile.role;
  const nextActive = data.status ? data.status === 'Active' : user.isActive;
  // Captured before any mutation so the audit entry can state the real before/after.
  const previousRole = profile.role;
  const roleChanged = nextRole !== previousRole;
  const statusChanged = nextActive !== user.isActive;
  if (profile.role === 'admin' && (nextRole !== 'admin' || !nextActive) && await activeAdminCount(user._id) === 0) {
    throw new ValidationError('At least one active Admin account is required.');
  }
  const nextAccountId = String(data.id || user.accountId).trim();
  const nextUsername = String(data.username || user.username).trim();
  const nextEmail = String(data.email || user.email).trim().toLowerCase();
  const nextName = String(data.name || profile.displayName).trim();
  const nextContact = String(data.contact ?? profile.phone).trim();
  const nextDepartment = String(data.department || profile.department).trim();
  const password = data.passwordHash || data.password;
  if (!nextAccountId || !nextUsername || !nextName || !nextDepartment) throw new ValidationError('Account ID, username, name, and department are required.');
  await assertUniqueIdentity({ accountId: nextAccountId, username: nextUsername, email: nextEmail, excludeId: user._id });

  const oldIdentifiers = [user.accountId, user.username, user.email].filter(Boolean);
  const identityChanged = [nextAccountId, nextUsername, nextEmail].some((value, index) => stableCaseInsensitive(value) !== stableCaseInsensitive(oldIdentifiers[index]));
  if (identityChanged) {
    await RevokedIdentifier.insertMany(oldIdentifiers.map((identifier) => ({
      _id: `${stableCaseInsensitive(identifier)}:${user._id}`,
      userId: user._id,
      reason: 'Identity changed by administrator',
      revokedAt: new Date(),
    })), { ordered: false }).catch((error) => { if (error.code !== 11000) throw error; });
  }
  user.accountId = nextAccountId;
  user.accountIdNormalized = stableCaseInsensitive(nextAccountId);
  user.username = nextUsername;
  user.usernameNormalized = stableCaseInsensitive(nextUsername);
  user.email = nextEmail;
  user.emailNormalized = nextEmail;
  user.isActive = nextActive;
  user.isStaff = nextRole === 'admin';
  if (password) user.passwordHash = createDjangoPassword(String(password));
  await user.save();
  profile.role = nextRole;
  profile.displayName = nextName;
  profile.phone = nextContact;
  profile.department = nextDepartment;
  await profile.save();

  // AD003: record what actually changed, so a role change is traceable.
  const auditTarget = { userId: user._id, accountId: user.accountId };
  if (roleChanged) {
    await recordAudit(actor, 'role_changed', auditTarget, `Role changed from ${previousRole} to ${nextRole}`);
  } else if (statusChanged) {
    await recordAudit(actor, nextActive ? 'account_reactivated' : 'account_deactivated', auditTarget, nextActive ? 'Reactivated' : 'Deactivated');
  } else {
    await recordAudit(actor, 'account_updated', auditTarget, 'Account details updated');
  }

  return serializeAdminUser({ ...user.toObject(), profile: profile.toObject() });
}

export async function deleteAdminUser(accountId, actor) {
  const { user, profile } = await findUserByAccountId(accountId);
  if (profile.role === 'admin' && user.isActive && await activeAdminCount(user._id) === 0) {
    throw new ValidationError('At least one active Admin account is required.');
  }
  const [organized, issued, codes] = await Promise.all([
    Event.countDocuments({ organizerId: user._id }),
    EventCertificate.countDocuments({ issuedById: user._id }),
    AttendanceCode.countDocuments({ createdById: user._id }),
  ]);
  if (organized || issued || codes) throw new ConflictError('This account is referenced by event, certificate, or attendance-code records and cannot be deleted. Deactivate it instead.');
  await Promise.all([
    EventRegistration.deleteMany({ attendeeId: user._id }),
    EventAttendance.deleteMany({ attendeeId: user._id }),
    EventFeedback.deleteMany({ attendeeId: user._id }),
    EventCertificate.deleteMany({ studentId: user._id }),
    EvaluationResponse.deleteMany({ attendeeId: user._id }),
  ]);
  await Promise.all([UserProfile.deleteOne({ userId: user._id }), User.deleteOne({ _id: user._id })]);
  await RevokedIdentifier.create({
    _id: `${stableCaseInsensitive(accountId)}:${user._id}:deleted`,
    userId: null,
    reason: 'Account deleted',
    revokedAt: new Date(),
  });
  await recordAudit(actor, 'account_deleted', { userId: user._id, accountId: user.accountId }, 'Account permanently deleted');
}

export async function listAttendance() {
  const records = await EventAttendance.find().sort({ recordedAt: -1 }).lean();
  const events = await Event.find({ _id: { $in: records.map((record) => record.eventId) } }).lean();
  const users = await usersWithProfiles();
  const eventById = new Map(events.map((event) => [event._id, event]));
  const userById = new Map(users.map((user) => [String(user._id), user]));
  return records
    .filter((record) => eventById.has(record.eventId) && userById.has(String(record.attendeeId)))
    .map((record) => serializeAdminAttendance(record, userById.get(String(record.attendeeId)), eventById.get(record.eventId)));
}

async function findUserById(userId) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('Account not found.');
  const profile = await UserProfile.findOne({ userId: user._id });
  if (!profile) throw new NotFoundError('Account profile not found.');
  return { user, profile };
}

/** AD003: recent role and account changes, newest first, for the admin workspace. */
export async function listAuditLog(limit = 50) {
  const entries = await AuditLog.find().sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  return entries.map((entry) => ({
    id: entry._id,
    action: entry.action,
    detail: entry.detail,
    actor: entry.actorName || 'Administrator',
    targetAccountId: entry.targetAccountId,
    at: new Date(entry.createdAt).toISOString(),
  }));
}

function normalizeUuid(value) {
  const raw = String(value || '').toLowerCase();
  const compact = raw.replaceAll('-', '');
  return /^[0-9a-f]{32}$/.test(compact)
    ? `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
    : null;
}

export async function addAttendance(data) {
  const eventId = normalizeUuid(data.eventId);
  const event = eventId ? await Event.findById(eventId) : null;
  if (!event) throw new NotFoundError('Event not found.');
  const { user, profile } = await findUserByAccountId(data.personId);
  if (!user.isActive) throw new ValidationError('Attendance cannot be added for an inactive account.');
  if (!['student', 'faculty'].includes(profile.role)) throw new ValidationError('Attendance can only be added for Student or Faculty accounts.');
  if (event.audience !== 'all' && event.audience !== profile.role) throw new ValidationError('This event is not open to the selected attendee role.');
  const status = String(data.status || 'Present').toLowerCase();
  if (!['present', 'late', 'absent'].includes(status)) throw new ValidationError({ status: 'Choose Present, Late, or Absent.' });
  try {
    const record = await EventAttendance.create({
      _id: await nextNumericId('eventAttendance'),
      eventId: event._id,
      attendeeId: user._id,
      status,
      method: event.attendanceMethod,
      recordedAt: new Date(),
      source: 'Manual addition',
      note: String(data.note || '').slice(0, 1000),
    });
    return serializeAdminAttendance(record, { ...user.toObject(), profile: profile.toObject() }, event.toObject());
  } catch (error) {
    if (error.code === 11000) throw new ConflictError('An attendance record already exists for this person and event.');
    throw error;
  }
}

export async function correctAttendance(recordId, data) {
  const record = await EventAttendance.findById(Number(recordId));
  if (!record) throw new NotFoundError('Attendance record not found.');
  const status = String(data.status || '').toLowerCase();
  if (!['present', 'late', 'absent'].includes(status)) throw new ValidationError({ status: 'Choose Present, Late, or Absent.' });
  record.status = status;
  record.note = String(data.note || '').slice(0, 1000);
  record.source = 'Manual correction';
  record.correctedAt = new Date();
  await record.save();
  const [{ user, profile }, event] = await Promise.all([
    findUserById(record.attendeeId),
    Event.findById(record.eventId),
  ]);
  return serializeAdminAttendance(record, { ...user.toObject(), profile: profile.toObject() }, event.toObject());
}

export async function deleteAttendance(recordId) {
  const result = await EventAttendance.deleteOne({ _id: Number(recordId) });
  if (!result.deletedCount) throw new NotFoundError('Attendance record not found.');
}

export async function listForms() {
  return (await EvaluationForm.find().sort({ updatedAt: -1 }).lean()).map(serializeEvaluationForm);
}

export async function listEvaluationResponses() {
  const responses = await EvaluationResponse.find().sort({ submittedAt: -1 }).lean();
  const users = await usersWithProfiles();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return responses.filter((response) => byId.has(String(response.attendeeId))).map((response) => serializeEvaluationResponse(response, byId.get(String(response.attendeeId))));
}

function normalizeQuestions(data) {
  if (!Array.isArray(data.questions) || !data.questions.length) throw new ValidationError({ questions: 'Add at least one question.' });
  return data.questions.map((question) => {
    const prompt = String(question.prompt || '').trim();
    if (!prompt || prompt.length > 500) throw new ValidationError({ questions: 'Every question needs a prompt of at most 500 characters.' });
    return {
      id: String(question.id || `Q-${crypto.randomUUID()}`),
      prompt,
      type: question.type === 'rating' ? 'rating' : 'text',
      required: Boolean(question.required),
    };
  });
}

export async function saveForm(data) {
  const title = String(data.title || '').trim();
  const eventId = normalizeUuid(data.eventId);
  if (!title || !eventId || !await Event.exists({ _id: eventId })) throw new ValidationError('A title and valid associated event are required.');
  const questions = normalizeQuestions(data);
  if (data.id) {
    const form = await EvaluationForm.findById(String(data.id));
    if (!form) throw new NotFoundError('Evaluation form not found.');
    Object.assign(form, { title, eventId, questions, active: Boolean(data.active), updatedAt: new Date() });
    await form.save();
    return serializeEvaluationForm(form);
  }
  const form = await EvaluationForm.create({
    _id: `FORM-${crypto.randomUUID()}`,
    title,
    eventId,
    questions,
    active: data.active ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return serializeEvaluationForm(form);
}

export async function deleteForm(formId) {
  const form = await EvaluationForm.findByIdAndDelete(String(formId));
  if (!form) throw new NotFoundError('Evaluation form not found.');
  await EvaluationResponse.deleteMany({ formId: String(formId) });
}

export async function adminState() {
  const [users, events, attendance, forms, responses, revoked] = await Promise.all([
    listAdminUsers(),
    serializeAdminEvents(await Event.find().sort({ startsAt: -1, name: 1 }).lean()),
    listAttendance(),
    listForms(),
    listEvaluationResponses(),
    RevokedIdentifier.find().sort({ revokedAt: -1 }).lean(),
  ]);
  return {
    version: 1,
    users,
    events,
    attendance,
    forms,
    responses,
    revokedIdentifiers: revoked.map((entry) => entry._id.split(':')[0]),
  };
}
