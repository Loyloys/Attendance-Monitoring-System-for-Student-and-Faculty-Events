import test, { after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { setup, teardown, reset, agent, login, send, createUser, getModels } from './helpers.js';
import { __setGoogleTokenVerifier, __resetGoogleTokenVerifier } from '../src/services/googleAuthService.js';

before(setup);
beforeEach(reset);
after(teardown);

const CLIENT_ID = '1234567890-test.apps.googleusercontent.com';

async function googleSignupRequest(client, { claims = {} } = {}) {
  // Mirrors the browser flow: open a session for the nonce, then submit a
  // credential bound to that nonce, then confirm the request. The applicant
  // sends NOTHING typed - the server takes the email from the verified token.
  const start = await send(client, 'post', '/api/auth/google/session/', {});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  __setGoogleTokenVerifier(async () => ({
    sub: 'google-sub-signup-1',
    email: 'person@gmail.com',
    email_verified: true,
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    name: 'New Signup',
    picture: '',
    nonce: start.body.nonce,
    ...claims,
  }));
  try {
    const started = await send(client, 'post', '/api/auth/google/', { credential: 'google-credential' });
    assert.equal(started.body.status, 'profile_incomplete', JSON.stringify(started.body));
    const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {});
    return completed;
  } finally {
    __resetGoogleTokenVerifier();
  }
}

async function adminAgent() {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent: client } = await login('ADM001');
  return client;
}

test('AD003.3: Google profile completion stores a pending signup request without creating a User', async () => {
  const completed = await googleSignupRequest(agent());
  assert.equal(completed.status, 202, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'signup_pending');
  const models = getModels();
  assert.equal(await models.User.countDocuments({}), 0);
  const request = await models.SignupRequest.findOne({ googleEmailNormalized: 'person@gmail.com' }).lean();
  assert.ok(request);
  assert.equal(request.status, 'pending');
  assert.equal(request.department, '');
  // No session: the pending person reaches no attendance feature.
  assert.equal((await agent().get('/api/auth/me/')).status, 401);
});

test('AD003.3: each email-only signup is stored as its own pending request; no User is created', async () => {
  const identities = [
    { sub: 'google-sub-multi-1', email: 'new.user@gmail.com', name: 'Alpha User' },
    { sub: 'google-sub-multi-2', email: 'mine@gmail.com', name: 'Beta User' },
    { sub: 'google-sub-multi-3', email: 'tester@example.com', name: 'Gamma User' },
  ];
  for (const identity of identities) {
    const completed = await googleSignupRequest(agent(), {
      claims: { ...identity, name: identity.name },
    });
    assert.equal(completed.status, 202, `${identity.email}: ${JSON.stringify(completed.body)}`);
    assert.equal(completed.body.status, 'signup_pending');
    const models = getModels();
    assert.equal(await models.User.countDocuments({ googleSub: identity.sub }), 0, `${identity.email} must not create a User`);
    const stored = await models.SignupRequest.findOne({ googleSub: identity.sub }).lean();
    assert.ok(stored, `a pending request must be stored for ${identity.email}`);
    assert.equal(stored.status, 'pending');
    // The applicant supplies nothing typed: accountId, department and phone stay empty.
    assert.equal(stored.accountId, '');
    assert.equal(stored.department, '');
    assert.equal(stored.phone, '');
    assert.equal(stored.displayName, identity.name);
  }
  assert.equal(await getModels().SignupRequest.countDocuments({}), identities.length);
  assert.equal(await getModels().User.countDocuments({}), 0);
});

test('AD003.3: a client-sent department field is rejected; nothing is stored', async () => {
  const client = agent();
  const started = await send(client, 'post', '/api/auth/google/session/', {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  __setGoogleTokenVerifier(async () => ({
    sub: 'google-sub-dept-reject',
    email: 'person@gmail.com',
    email_verified: true,
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    name: 'Reject Dept',
    picture: '',
    nonce: started.body.nonce,
  }));
  try {
    const authenticated = await send(client, 'post', '/api/auth/google/', { credential: 'google-credential' });
    assert.equal(authenticated.body.status, 'profile_incomplete', JSON.stringify(authenticated.body));
    const completed = await send(client, 'post', '/api/auth/google/complete-profile/', { department: 'BSIT' });
    assert.equal(completed.status, 400, JSON.stringify(completed.body));
    assert.match(completed.body.department, /administrator/);
  } finally {
    __resetGoogleTokenVerifier();
  }
  const models = getModels();
  assert.equal(await models.SignupRequest.countDocuments({ googleSub: 'google-sub-dept-reject' }), 0);
  assert.equal(await models.User.countDocuments({ googleSub: 'google-sub-dept-reject' }), 0);
});

test('public signup approval cannot create Admin accounts', async () => {
  const completed = await googleSignupRequest(agent(), {
    claims: {
      sub: 'google-sub-no-public-admin',
      email: 'person@gmail.com',
      name: 'Public Applicant',
    },
  });
  assert.equal(completed.status, 202, JSON.stringify(completed.body));
  const models = getModels();
  const signup = await models.SignupRequest.findOne({ googleSub: 'google-sub-no-public-admin' }).lean();
  assert.ok(signup);

  const admin = await adminAgent();
  const result = await send(admin, 'post', `/api/admin/signup-requests/${signup._id}/approve/`, {
    accountId: 'ADM-PUBLIC-1',
    department: 'IT',
    role: 'Admin',
  });
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.equal(await models.User.countDocuments({ accountId: 'ADM-PUBLIC-1' }), 0);
  assert.equal((await models.SignupRequest.findById(signup._id).lean()).status, 'pending');

  const separatelyCreated = await send(admin, 'post', '/api/admin/users/', {
    id: 'ADM-MANAGED-1', username: 'admin-managed-1', name: 'Managed Admin',
    email: 'admin-managed-1@cot.edu', contact: '09120000001', department: 'IT',
    role: 'Admin', password: 'temporary-pass',
  });
  assert.equal(separatelyCreated.status, 201, JSON.stringify(separatelyCreated.body));
});

test('GST001.3: profile PATCH rejects approval/active/role fields explicitly', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  const { agent: client } = await login('STU001');
  for (const field of ['approvalStatus', 'isActive', 'role']) {
    const response = await send(client, 'patch', '/api/profile/', { [field]: 'approved' });
    assert.equal(response.status, 400, `${field} must be refused: ${JSON.stringify(response.body)}`);
  }
});

test('GST014: an Absent student is refused the certificate download and sees no URL', async () => {
  const { user: student } = await createUser({ username: 'STU002', role: 'student' });
  const { user: faculty } = await createUser({ username: 'FAC002', role: 'faculty' });
  const models = getModels();
  const event = await models.Event.create({
    name: 'Cert Event', description: '', startsAt: new Date(Date.now() - 3600000),
    endsAt: new Date(Date.now() + 3600000), checkInOpensAt: new Date(Date.now() - 3600000),
    checkInClosesAt: new Date(Date.now() + 3600000), lateCutoff: new Date(Date.now() + 3600000),
    venue: 'Hall', audience: 'all', organizerId: faculty._id, status: 'published', attendanceMethod: 'qr',
  });
  await models.EventAttendance.create({
    _id: await (await import('./helpers.js')).nextId('eventAttendance'),
    eventId: event._id, attendeeId: student._id, status: 'absent', method: 'qr', recordedAt: new Date(),
  });
  const certificate = await models.EventCertificate.create({
    _id: await (await import('./helpers.js')).nextId('eventCertificate'),
    eventId: event._id, studentId: student._id, issuedById: faculty._id, reference: 'CERT-ABSENT-1',
  });
  const { agent: client } = await login('STU002');
  const download = await client.get(`/api/certificates/${certificate._id}/download/`);
  assert.equal(download.status, 403, JSON.stringify(download.body));
});

test('GST009: personal history exposes verified duration and percentage inputs', async () => {
  const { user: student } = await createUser({ username: 'STU003', role: 'student' });
  const { user: faculty } = await createUser({ username: 'FAC003', role: 'faculty' });
  const models = getModels();
  const event = await models.Event.create({
    name: 'History Event', description: '', startsAt: new Date(Date.now() - 3600000),
    endsAt: new Date(Date.now() + 3600000), checkInOpensAt: new Date(Date.now() - 3600000),
    checkInClosesAt: new Date(Date.now() + 3600000), lateCutoff: new Date(Date.now() + 3600000),
    venue: 'Hall', audience: 'all', organizerId: faculty._id, status: 'published', attendanceMethod: 'qr',
    requiredAttendanceMinutes: 10,
  });
  await models.EventAttendance.create({
    _id: await (await import('./helpers.js')).nextId('eventAttendance'),
    eventId: event._id, attendeeId: student._id, status: 'present', method: 'qr', recordedAt: new Date(),
    verifiedSeconds: 300, requiredAttendanceMinutes: 10, qualification: 'pending',
  });
  const { agent: client } = await login('STU003');
  const history = await client.get('/api/attendance/me/');
  assert.equal(history.status, 200);
  assert.equal(history.body.records[0].verifiedSeconds, 300);
  assert.equal(history.body.records[0].requiredAttendanceMinutes, 10);
  assert.equal(history.body.records[0].status, 'pending', 'a check-in is not Present before duration qualification');
});

test('AD003.3: an admin lists pending signup requests', async () => {
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-list-1', email: 'person@gmail.com', name: 'List Me' } });
  const client = await adminAgent();
  const listed = await send(client, 'get', '/api/admin/signup-requests/?status=pending');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(Array.isArray(listed.body));
  assert.ok(listed.body.some((row) => row.googleEmail === 'person@gmail.com' && row.emailVerified && row.status === 'pending' && row.pendingRole === ''));
  // Nothing typed by the applicant, so accountId and department are empty until review.
  assert.ok(listed.body.every((row) => row.accountId === '' && row.department === ''));
});

test('signup request IDs and inferred roles come only from verified supported institutional email', async () => {
  const models = getModels();
  const verifiedAt = new Date();
  await models.SignupRequest.create([
    {
      _id: 'REQ-VERIFIED-GOOGLE',
      provider: 'google',
      googleSub: 'verified-google-sub',
      googleEmail: '2401105160@student.buksu.edu.ph',
      googleEmailNormalized: '2401105160@student.buksu.edu.ph',
      pendingRole: 'faculty',
      accountId: 'UNTRUSTED-REQUEST-ID',
      status: 'pending',
    },
    {
      _id: 'REQ-VERIFIED-EMAIL',
      provider: 'email',
      googleEmail: '2401105161@faculty.buksu.edu.ph',
      googleEmailNormalized: '2401105161@faculty.buksu.edu.ph',
      emailVerifiedAt: verifiedAt,
      pendingRole: 'student',
      accountId: 'UNTRUSTED-REQUEST-ID',
      status: 'pending',
    },
    {
      _id: 'REQ-UNVERIFIED',
      provider: 'email',
      googleEmail: '2401105162@student.buksu.edu.ph',
      googleEmailNormalized: '2401105162@student.buksu.edu.ph',
      pendingRole: 'student',
      accountId: 'UNTRUSTED-REQUEST-ID',
      status: 'pending',
    },
    {
      _id: 'REQ-UNSUPPORTED-DOMAIN',
      provider: 'email',
      googleEmail: '2401105163@other.example',
      googleEmailNormalized: '2401105163@other.example',
      emailVerifiedAt: verifiedAt,
      pendingRole: 'student',
      status: 'pending',
    },
    {
      _id: 'REQ-MALFORMED-LOCAL-PART',
      provider: 'email',
      googleEmail: 'id-2401105164@student.buksu.edu.ph',
      googleEmailNormalized: 'id-2401105164@student.buksu.edu.ph',
      emailVerifiedAt: verifiedAt,
      pendingRole: 'faculty',
      status: 'pending',
    },
  ]);

  const admin = await adminAgent();
  const response = await send(admin, 'get', '/api/admin/signup-requests/?status=pending');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const byId = new Map(response.body.map((row) => [row.id, row]));
  assert.equal(byId.get('REQ-VERIFIED-GOOGLE').accountId, '2401105160');
  assert.equal(byId.get('REQ-VERIFIED-GOOGLE').emailVerified, true);
  assert.equal(byId.get('REQ-VERIFIED-GOOGLE').pendingRole, 'student');
  assert.equal(byId.get('REQ-VERIFIED-EMAIL').accountId, '2401105161');
  assert.equal(byId.get('REQ-VERIFIED-EMAIL').pendingRole, 'faculty');
  assert.equal(byId.get('REQ-UNVERIFIED').accountId, '');
  assert.equal(byId.get('REQ-UNVERIFIED').emailVerified, false);
  assert.equal(byId.get('REQ-UNVERIFIED').pendingRole, '');
  assert.equal(byId.get('REQ-UNSUPPORTED-DOMAIN').accountId, '');
  assert.equal(byId.get('REQ-UNSUPPORTED-DOMAIN').pendingRole, '');
  assert.equal(byId.get('REQ-MALFORMED-LOCAL-PART').accountId, '');
  assert.equal(byId.get('REQ-MALFORMED-LOCAL-PART').pendingRole, 'student');

  const unverifiedApproval = await send(admin, 'post', '/api/admin/signup-requests/REQ-UNVERIFIED/approve/', {
    accountId: 'STU-UNVERIFIED',
    department: 'IT',
    role: 'Student',
  });
  assert.equal(unverifiedApproval.status, 400, JSON.stringify(unverifiedApproval.body));
  assert.equal(await models.User.exists({ accountId: 'STU-UNVERIFIED' }), null);

  for (const id of ['REQ-UNSUPPORTED-DOMAIN', 'REQ-MALFORMED-LOCAL-PART']) {
    const missingId = await send(admin, 'post', `/api/admin/signup-requests/${id}/approve/`, {
      department: 'IT',
      role: 'Student',
    });
    assert.equal(missingId.status, 400, JSON.stringify(missingId.body));
    assert.ok(Object.hasOwn(missingId.body, 'accountId'));
    assert.equal((await models.SignupRequest.findById(id).lean()).status, 'pending');
  }
});

test('AD003.3: admin approval creates the User with the assigned accountId, department and role', async () => {
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-approve-1', email: 'person@gmail.com', name: 'Approve Me' } });
  const models = getModels();
  const request = await models.SignupRequest.findOne({ googleSub: 'google-sub-approve-1' }).lean();
  assert.ok(request, 'a pending request must exist before approval');
  assert.equal(request.status, 'pending');
  const client = await adminAgent();
  const approved = await send(client, 'post', `/api/admin/signup-requests/${request._id}/approve/`, {
    accountId: 'STU9001', department: 'IT', role: 'Student',
  });
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  assert.equal(approved.body.id, 'STU9001');
  const user = await models.User.findOne({ accountIdNormalized: 'stu9001' }).lean();
  assert.ok(user, 'approval must create the User');
  assert.equal(user.authProviders.join(','), 'google');
  assert.equal(user.googleSub, 'google-sub-approve-1');
  const profile = await models.UserProfile.findOne({ userId: user._id }).lean();
  assert.equal(profile.role, 'student');
  assert.equal(profile.department, 'IT');
  const reviewed = await models.SignupRequest.findById(request._id).lean();
  assert.equal(reviewed.status, 'approved');
  assert.ok(reviewed.reviewedAt);
  assert.ok(reviewed.reviewedBy, 'reviewer recorded');
});

test('signup approval retains duplicate account ID protection', async () => {
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-duplicate-id-1', email: 'first@gmail.com', name: 'First' } });
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-duplicate-id-2', email: 'second@gmail.com', name: 'Second' } });
  const models = getModels();
  const first = await models.SignupRequest.findOne({ googleSub: 'google-sub-duplicate-id-1' }).lean();
  const second = await models.SignupRequest.findOne({ googleSub: 'google-sub-duplicate-id-2' }).lean();
  const admin = await adminAgent();

  const approved = await send(admin, 'post', `/api/admin/signup-requests/${first._id}/approve/`, {
    accountId: 'STU-DUPLICATE-1', department: 'IT', role: 'Student',
  });
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  const duplicate = await send(admin, 'post', `/api/admin/signup-requests/${second._id}/approve/`, {
    accountId: 'STU-DUPLICATE-1', department: 'BSEMC', role: 'Student',
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal((await models.SignupRequest.findById(second._id).lean()).status, 'pending');
  assert.equal(await models.User.countDocuments({ accountIdNormalized: 'stu-duplicate-1' }), 1);
});

test('AD003.3: admin refusal marks the request rejected and creates no User', async () => {
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-reject-1', email: 'person@gmail.com', name: 'Reject Me' } });
  const models = getModels();
  const request = await models.SignupRequest.findOne({ googleSub: 'google-sub-reject-1' }).lean();
  assert.ok(request);
  const client = await adminAgent();
  const refused = await send(client, 'post', `/api/admin/signup-requests/${request._id}/reject/`);
  assert.equal(refused.status, 200, JSON.stringify(refused.body));
  assert.equal(refused.body.status, 'rejected');
  const reviewed = await models.SignupRequest.findById(request._id).lean();
  assert.equal(reviewed.status, 'rejected');
  assert.ok(reviewed.reviewedAt);
  assert.equal(await models.User.countDocuments({ googleSub: 'google-sub-reject-1' }), 0, 'rejection must not create a User');
});

test('AD003.3: approval refuses a missing accountId, department or role', async () => {
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-validate-1', email: 'person@gmail.com', name: 'Validate Me' } });
  const models = getModels();
  const request = await models.SignupRequest.findOne({ googleSub: 'google-sub-validate-1' }).lean();
  assert.ok(request);
  const client = await adminAgent();
  const cases = [
    { label: 'no accountId', body: { department: 'IT', role: 'Student' }, field: 'accountId' },
    { label: 'malformed accountId', body: { accountId: 'STU\u0000BAD', department: 'IT', role: 'Student' }, field: 'accountId' },
    { label: 'accountId exceeds schema length', body: { accountId: 'x'.repeat(151), department: 'IT', role: 'Student' }, field: 'accountId' },
    { label: 'no department', body: { accountId: 'STU9002', role: 'Student' }, field: 'department' },
    { label: 'no role', body: { accountId: 'STU9003', department: 'IT' }, field: 'role' },
    { label: 'invented department', body: { accountId: 'STU9004', department: 'Bogus', role: 'Student' }, field: 'department' },
  ];
  for (const c of cases) {
    const response = await send(client, 'post', `/api/admin/signup-requests/${request._id}/approve/`, c.body);
    assert.equal(response.status, 400, `${c.label}: ${JSON.stringify(response.body)}`);
    assert.ok(Object.hasOwn(response.body, c.field), `${c.label} must report the ${c.field} problem`);
  }
  for (const id of ['stu9002', 'stu9003', 'stu9004']) {
    assert.equal(await models.User.countDocuments({ accountIdNormalized: id }), 0, `failed approval must not create ${id}`);
  }
  const stillPending = await models.SignupRequest.findById(request._id).lean();
  assert.equal(stillPending.status, 'pending');
});

test('AD003.3: an already-reviewed request cannot be approved or rejected again', async () => {
  await googleSignupRequest(agent(), { claims: { sub: 'google-sub-dual-1', email: 'person@gmail.com', name: 'Dual' } });
  const models = getModels();
  const request = await models.SignupRequest.findOne({ googleSub: 'google-sub-dual-1' }).lean();
  assert.ok(request);
  const client = await adminAgent();
  const approved = await send(client, 'post', `/api/admin/signup-requests/${request._id}/approve/`, {
    accountId: 'STU9005', department: 'IT', role: 'Student',
  });
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  const again = await send(client, 'post', `/api/admin/signup-requests/${request._id}/approve/`, {
    accountId: 'STU9005', department: 'IT', role: 'Student',
  });
  assert.equal(again.status, 404, JSON.stringify(again.body));
  const rejected = await send(client, 'post', `/api/admin/signup-requests/${request._id}/reject/`);
  assert.equal(rejected.status, 404, JSON.stringify(rejected.body));
  const final = await models.SignupRequest.findById(request._id).lean();
  assert.equal(final.status, 'approved');
});
