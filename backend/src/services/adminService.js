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
  SignupRequest,
  User,
  UserProfile,
} from '../models/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { approvalStatusOf } from '../middleware/authentication.js';
import { nextNumericId } from '../utils/ids.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { createDjangoPassword } from '../utils/passwords.js';
import { effectiveEventStatus } from '../utils/events.js';
import { DEPARTMENTS } from '../utils/domain.js';
import { serializeAdminEvents } from './eventService.js';
import { serializeAdminAttendance, serializeAdminUser, serializeEventFeedback } from './adminSerializer.js';
import { finalizeExpiredSessions } from './attendanceSessionService.js';
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

/**
 * Registration counts per account, so the User Management screen can separate
 * "has an account" from "registered for events".
 *
 * Only `status: 'registered'` rows count as a live registration; a cancelled one
 * is history, not a current registration. Attendance is counted in a separate
 * pass so a registration is never reported as attendance.
 */
async function registrationCountsByUser() {
  const counts = new Map();
  const rows = await EventRegistration.aggregate([
    { $match: { status: 'registered' } },
    { $group: { _id: '$attendeeId', count: { $sum: 1 } } },
  ]);
  for (const row of rows) counts.set(String(row._id), row.count);
  return counts;
}

async function attendanceCountsByUser() {
  const counts = new Map();
  const rows = await EventAttendance.aggregate([
    { $group: { _id: '$attendeeId', count: { $sum: 1 } } },
  ]);
  for (const row of rows) counts.set(String(row._id), row.count);
  return counts;
}

/**
 * Every event this account has a registration row for, with the registration and
 * the attendance reported as two independent facts.
 *
 * `attendanceStatus` is null unless an attendance record actually exists, so a
 * registered person is never shown as Present, and a person with attendance is
 * not assumed to have registered either.
 */
export async function listUserEventRegistrations(accountId) {
  const { user, profile } = await findUserByAccountId(accountId);
  const registrations = await EventRegistration.find({ attendeeId: user._id })
    .sort({ registeredAt: -1 })
    .lean();
  const events = await Event.find({ _id: { $in: registrations.map((row) => row.eventId) } }).lean();
  const eventById = new Map(events.map((event) => [event._id, event]));
  const attendance = await EventAttendance.find({ attendeeId: user._id }).lean();
  const attendanceByEvent = new Map(
    attendance.map((record) => [record.eventId, record]),
  );

  return {
    account: {
      id: user.accountId,
      name: profile.displayName,
      email: user.email || '',
      role: profile.role,
      department: profile.department || '',
      status: user.isActive ? 'Active' : 'Inactive',
      approvalStatus: approvalStatusOf(user),
      createdAt: new Date(user.dateJoined).toISOString(),
    },
    registrations: registrations.map((registration) => {
      const event = eventById.get(registration.eventId);
      const record = attendanceByEvent.get(registration.eventId);
      return {
        eventId: registration.eventId,
        // An event removed from the database leaves a dangling registration row;
        // it is still reported rather than silently dropped.
        eventName: event ? event.name : '(event no longer exists)',
        eventDate: event ? new Date(event.startsAt).toISOString().slice(0, 10) : null,
        eventStatus: event ? event.status : null,
        // `registered` or `cancelled` - the registration itself.
        registrationStatus: registration.status,
        registeredAt: new Date(registration.registeredAt).toISOString(),
        // Null means "no attendance recorded", which is NOT the same as absent.
        // Capitalised like every other serialized attendance status, so the
        // administrator screen and this endpoint agree on one vocabulary.
        attendanceStatus: record ? record.status[0].toUpperCase() + record.status.slice(1) : null,
        checkedInAt: record && record.recordedAt ? new Date(record.recordedAt).toISOString() : null,
      };
    }),
  };
}

export async function listAdminUsers() {
  const users = await usersWithProfiles();
  const [registrations, attendance] = await Promise.all([
    registrationCountsByUser(),
    attendanceCountsByUser(),
  ]);
  return users.map((user) => serializeAdminUser(user, {
    eventRegistrationCount: registrations.get(String(user._id)) || 0,
    attendanceCount: attendance.get(String(user._id)) || 0,
  }));
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
  // Administrator approval is a separate decision from the role. A pending
  // Google sign-up is approved or rejected here, and only here.
  const requestedApproval = data.approvalStatus;
  if (requestedApproval !== undefined && !['pending', 'approved', 'rejected'].includes(requestedApproval)) {
    throw new ValidationError({ approvalStatus: 'Approval status must be pending, approved or rejected.' });
  }
  const previousApproval = approvalStatusOf(user);
  const nextApproval = requestedApproval ?? previousApproval;
  const approvalChanged = nextApproval !== previousApproval;
  // Captured before any mutation so the audit entry can state the real before/after.
  const previousRole = profile.role;
  const roleChanged = nextRole !== previousRole;
  const statusChanged = nextActive !== user.isActive;
  if (profile.role === 'admin' && (nextRole !== 'admin' || !nextActive) && await activeAdminCount(user._id) === 0) {
    // The message is the SECOND argument. Passing the text as the field map made
    // the API answer with the generic "submitted data is invalid" instead of
    // telling the administrator why the change was refused.
    throw new ValidationError(
      { role: 'At least one active Admin account is required.' },
      'At least one active Admin account is required.',
    );
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
  user.approvalStatus = nextApproval;
  if (approvalChanged) {
    user.approvalReviewedAt = new Date();
    user.approvalReviewedBy = actor?._id || null;
  }
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
  if (approvalChanged) {
    // Approval is its own auditable event: it is the moment a person gains (or
    // loses) access to attendance features.
    await recordAudit(actor, `account_${nextApproval === 'approved' ? 'approved' : nextApproval === 'rejected' ? 'rejected' : 'approval_reset'}`, auditTarget, `Approval changed from ${previousApproval} to ${nextApproval}`);
  } else if (roleChanged) {
    await recordAudit(actor, 'role_changed', auditTarget, `Role changed from ${previousRole} to ${nextRole}`);
  } else if (statusChanged) {
    await recordAudit(actor, nextActive ? 'account_reactivated' : 'account_deactivated', auditTarget, nextActive ? 'Reactivated' : 'Deactivated');
  } else {
    await recordAudit(actor, 'account_updated', auditTarget, 'Account details updated');
  }

  return serializeAdminUser({ ...user.toObject(), profile: profile.toObject() });
}

/**
 * AD003.3: email-only pending signup requests.
 *
 * Lists SignupRequests (no User exists yet for these people). Reuse: the same
 * serializeAdminUser shape is NOT used here because there is no User/Profile;
 * a dedicated serializer keeps the pending-request surface explicit.
 */
export async function listSignupRequests(status = 'pending') {
  const query = ['pending', 'approved', 'rejected'].includes(status) ? { status } : {};
  const rows = await SignupRequest.find(query).sort({ createdAt: -1 }).lean();
  return rows.map((row) => ({
    id: String(row._id),
    googleEmail: row.googleEmail || '',
    accountId: row.accountId || '',
    name: row.displayName || '',
    department: row.department || '',
    phone: row.phone || '',
    // Role inferred from the verified email domain at submission, so the
    // approval screen can preselect it. Empty when no domain matched.
    pendingRole: row.pendingRole || '',
    status: row.status,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
  }));
}

/**
 * AD003.3: approve a pending signup request. The Admin assigns the role and
 * department/course here; only at approval is the User (+UserProfile) created.
 * The request is marked approved so a repeat approval cannot create a duplicate.
 */
export async function approveSignupRequest(requestId, data, actor) {
  const signup = await SignupRequest.findById(String(requestId));
  if (!signup || signup.status !== 'pending') throw new NotFoundError('Signup request not found or already reviewed.');
  // The pending role was inferred from the VERIFIED email domain at submission.
  // An administrator may assign a different one explicitly; a request with no
  // inferred role must be given one here. A browser-supplied value is validated
  // against the known role list, so an invented one is refused.
  const role = (data.role ? roleMap[data.role] : signup.pendingRole) || null;
  if (!role) throw new ValidationError({ role: 'Assign a role: Student, Faculty, or Admin.' });
  // Department/course is ONLY assigned here, by an administrator, from the fixed
  // list. It is never collected from the applicant, so a legacy or invented
  // value (including one stored on an old request) is refused rather than
  // silently creating an account with it.
  const department = String(data.department || '').trim();
  if (!DEPARTMENTS.includes(department)) {
    throw new ValidationError({ department: `Select a department or course: ${DEPARTMENTS.join(', ')}.` });
  }
  const accountId = String(data.accountId || signup.accountId || '').trim().toUpperCase();
  if (!accountId) throw new ValidationError({ accountId: 'Account ID is required.' });
  const normalized = stableCaseInsensitive(accountId);
  // An identifier retired by an earlier identity change may never be reused -
  // the check moved here from signup because the applicant no longer supplies
  // an account ID; the administrator chooses it at approval.
  const revoked = await RevokedIdentifier.exists({
    _id: { $regex: `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:` },
  });
  if (revoked) throw new ConflictError('That account ID can no longer be used.');
  if (await User.exists({ $or: [{ accountIdNormalized: normalized }, { usernameNormalized: normalized }] })) {
    throw new ConflictError('Account ID, username, or email is already in use.');
  }
  if (await User.exists({ emailNormalized: signup.googleEmailNormalized })) {
    throw new ConflictError('Account ID, username, or email is already in use.');
  }
  const parts = String(signup.displayName || '').trim().split(/\s+/).filter(Boolean);
  const user = await User.create({
    accountId,
    accountIdNormalized: normalized,
    username: accountId,
    usernameNormalized: normalized,
    passwordHash: null,
    authProviders: ['google'],
    googleSub: signup.googleSub,
    googleEmail: signup.googleEmail,
    googleEmailNormalized: signup.googleEmailNormalized,
    googleHostedDomain: signup.googleHostedDomain || '',
    googlePictureUrl: signup.googlePictureUrl || '',
    googleLinkedAt: new Date(),
    firstName: (parts[0] || '').slice(0, 150),
    lastName: parts.slice(1).join(' ').slice(0, 150),
    email: signup.googleEmail,
    emailNormalized: signup.googleEmailNormalized,
    isActive: true,
    approvalStatus: 'approved',
    approvalReviewedAt: new Date(),
    approvalReviewedBy: actor?._id || null,
    isStaff: role === 'admin',
    isSuperuser: false,
    profileCompleted: true,
    dateJoined: new Date(),
    dataSource: 'google',
  });
  const profile = await UserProfile.create({
    userId: user._id,
    role,
    displayName: signup.displayName || accountId,
    phone: signup.phone || '',
    department,
    cardIdentifier: null,
  }).catch(async (error) => {
    await User.deleteOne({ _id: user._id }).catch(() => {});
    throw error;
  });
  signup.status = 'approved';
  signup.reviewedAt = new Date();
  signup.reviewedBy = actor?._id || null;
  await signup.save();
  await recordAudit(actor, 'account_approved', { userId: user._id, accountId }, `Signup request approved as ${role}`);
  return serializeAdminUser({ ...user.toObject(), profile: profile.toObject() });
}

/** AD003.3: reject a pending signup request. No User is ever created. */
export async function rejectSignupRequest(requestId, actor) {
  const signup = await SignupRequest.findById(String(requestId));
  if (!signup || signup.status !== 'pending') throw new NotFoundError('Signup request not found or already reviewed.');
  signup.status = 'rejected';
  signup.reviewedAt = new Date();
  signup.reviewedBy = actor?._id || null;
  await signup.save();
  await recordAudit(actor, 'account_rejected', { userId: null, accountId: signup.accountId || signup.googleEmail }, 'Signup request rejected');
  return { id: String(signup._id), status: signup.status };
}

export async function deleteAdminUser(accountId, actor) {
  const { user, profile } = await findUserByAccountId(accountId);
  if (profile.role === 'admin' && user.isActive && await activeAdminCount(user._id) === 0) {
    throw new ValidationError(
      { role: 'At least one active Admin account is required.' },
      'At least one active Admin account is required.',
    );
  }
  const [organized, issued, codes, registrations, attendances, feedbacks, certificates, responses] = await Promise.all([
    Event.countDocuments({ organizerId: user._id }),
    EventCertificate.countDocuments({ issuedById: user._id }),
    AttendanceCode.countDocuments({ createdById: user._id }),
    EventRegistration.countDocuments({ attendeeId: user._id }),
    EventAttendance.countDocuments({ attendeeId: user._id }),
    EventFeedback.countDocuments({ attendeeId: user._id }),
    EventCertificate.countDocuments({ studentId: user._id }),
    EvaluationResponse.countDocuments({ attendeeId: user._id }),
  ]);
  if (organized || issued || codes) throw new ConflictError('This account is referenced by event, certificate, or attendance-code records and cannot be deleted. Deactivate it instead.');

  // AD002.5: attendance, feedback and reporting history are NOT silently
  // cascade-deleted. Those rows are the institutional record of who attended
  // what, and a permanent delete would erase them with no trace. When any exist
  // the request is refused with the exact counts, so the administrator can make
  // an informed choice. Deactivation is the reversible option that keeps the
  // history intact and still removes the person's access.
  const history = [
    ['event registration', registrations],
    ['attendance record', attendances],
    ['feedback response', feedbacks],
    ['certificate', certificates],
    ['evaluation response', responses],
  ].filter(([, count]) => count > 0);
  if (history.length) {
    const summary = history.map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`).join(', ');
    const conflict = new ConflictError(
      `This account has attendance history (${summary}) that must be preserved for reporting, so it cannot be permanently deleted. Deactivate the account instead: that removes access immediately and keeps every record.`,
    );
    // Machine-readable detail, so the UI can show the conflict instead of guessing.
    conflict.relatedRecords = Object.fromEntries(history.map(([label, count]) => [label, count]));
    throw conflict;
  }
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
  // GST008: an event that has ended must not keep showing Pending, and the
  // student is never coming back to close it. Reusing the existing
  // finalization decision here is what resolves those rows on read; it is the
  // same call a late heartbeat would have made, so both routes agree.
  await finalizeExpiredSessions();
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
  // GST008: an administrator's decision LATCHES. Automatic qualification must
  // never silently overwrite it afterwards - not by the next accepted location,
  // and not by the event-end sweep. The distinction stays auditable: the row
  // keeps `source: 'Manual correction'` and reports `manualOverride: true`, so an
  // automatic decision and a human one are never indistinguishable later.
  //
  // The chosen `status` is mirrored into `qualification` ONLY for records that
  // carry a duration requirement, because that is the only case where the two can
  // disagree. A non-tracking event's qualification stays null, so nothing about
  // its established reporting changes.
  if (record.requiredAttendanceMinutes) {
    record.qualification = status;
    record.qualificationReason = 'Set by an administrator.';
  }
  record.manualOverride = true;
  record.manualOverrideAt = new Date();
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

/**
 * Per-event feedback a student or faculty member submitted after attendance.
 *
 * THE MISSING READ PATH. This is the counterpart of `submitFeedback` in
 * attendanceService.js, which is what the Portal's "Event feedback" screen
 * posts to. Those rows were written correctly but were never read by any
 * administrator route, so `GET /admin/state/` carried no feedback at all and
 * "Feedback & evaluations" could not show them. The write side is deliberately
 * left untouched: existing rows are read as they are, never rewritten.
 *
 * Same defensive join as the evaluation responses above: a response whose
 * attendee no longer resolves to a user with a profile is DROPPED rather than
 * serialized, because there is no honest name to print for it and an
 * unlabelled row in a feedback report is worse than an absent one. Note this
 * can only remove a row that is already un-attributable - it never removes a
 * readable one.
 *
 * Administrator-only by route (`router.use('/admin', requireAuthentication,
 * requireRole('admin'))`), so this adds no new read path for a student or a
 * faculty member.
 */
export async function listEventFeedback() {
  const records = await EventFeedback.find().sort({ submittedAt: -1 }).lean();
  const users = await usersWithProfiles();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return records
    .filter((record) => byId.has(String(record.attendeeId)))
    .map((record) => serializeEventFeedback(record, byId.get(String(record.attendeeId))));
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
  const [users, events, attendance, forms, responses, feedback, revoked] = await Promise.all([
    listAdminUsers(),
    serializeAdminEvents(await Event.find().sort({ startsAt: -1, name: 1 }).lean()),
    listAttendance(),
    listForms(),
    listEvaluationResponses(),
    // Added beside `responses` rather than replacing it: an evaluation-form
    // response and a per-event feedback response are two different records
    // written by two different screens, and the administrator screen has to be
    // able to show both. Neither is derived from the other.
    listEventFeedback(),
    RevokedIdentifier.find().sort({ revokedAt: -1 }).lean(),
  ]);
  return {
    version: 1,
    users,
    events,
    attendance,
    forms,
    responses,
    feedback,
    revokedIdentifiers: revoked.map((entry) => entry._id.split(':')[0]),
  };
}
