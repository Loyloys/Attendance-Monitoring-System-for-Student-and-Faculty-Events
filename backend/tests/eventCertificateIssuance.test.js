import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEvent,
  createUser,
  getModels,
  login,
  request,
  reset,
  send,
  setup,
  teardown,
} from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

const admin = async (username = 'ADM001') => {
  await createUser({ username, role: 'admin' });
  const { agent } = await login(username);
  return agent;
};

const nonAdmin = async (username = 'STU001', role = 'student') => {
  await createUser({ username, role });
  const { agent } = await login(username);
  return agent;
};

async function issueCertificates(adminAgent, eventId) {
  return send(adminAgent, 'post', `/api/admin/events/${eventId}/certificates/`);
}

test('admin issuance creates a certificate for each present student and nothing else', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const present = await createUser({ username: 'STU001', role: 'student' });
  const absent = await createUser({ username: 'STU002', role: 'student' });
  const event = await createEvent(faculty.user);

  const presentAttendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  const absentAttendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: presentAttendanceId,
    eventId: event._id,
    attendeeId: present.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });
  await getModels().EventAttendance.create({
    _id: absentAttendanceId,
    eventId: event._id,
    attendeeId: absent.user._id,
    status: 'absent',
    method: 'qr',
    recordedAt: new Date(),
  });
  const issued = await issueCertificates(adminAgent, event._id);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.equal(issued.body.issued, 1, 'should only issue for present students');
  assert.equal(
    (await getModels().EventCertificate.countDocuments({ eventId: event._id })).toString(),
    '1',
    'should not create anything for absent students',
  );
});

test('repeated issuance is idempotent and never duplicates a certificate', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);

  const attendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: attendanceId,
    eventId: event._id,
    attendeeId: student.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });

  const first = await issueCertificates(adminAgent, event._id);
  assert.equal(first.status, 200);
  assert.equal(first.body.issued, 1);

  const again = await issueCertificates(adminAgent, event._id);
  assert.equal(again.status, 200);
  assert.equal(again.body.issued, 1, 'repeat request should not create an extra certificate');
  assert.equal(
    (await getModels().EventCertificate.countDocuments({ eventId: event._id })).toString(),
    '1',
    'duplicate issuance must never create a second record',
  );
});

test('unauthorized administrators cannot issue certificates', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);

  const facultyAgent = await createUser({ username: 'FAC002', role: 'faculty' })
    .then(() => login('FAC002'))
    .then((result) => result.agent);
  const studentAgent = await createUser({ username: 'STU002', role: 'student' })
    .then(() => login('STU002'))
    .then((result) => result.agent);

  const facultyResponse = await issueCertificates(facultyAgent, event._id);
  assert.equal(facultyResponse.status, 403, 'faculty must not be able to issue certificates');

  const studentResponse = await issueCertificates(studentAgent, event._id);
  assert.equal(studentResponse.status, 403, 'student must not be able to issue certificates');
});

test('a student can only download a certificate if their attendance is present', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const present = await createUser({ username: 'STU001', role: 'student' });
  const absent = await createUser({ username: 'STU002', role: 'student' });
  const event = await createEvent(faculty.user);

  const presentAttendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  const absentAttendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: presentAttendanceId,
    eventId: event._id,
    attendeeId: present.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });
  await getModels().EventAttendance.create({
    _id: absentAttendanceId,
    eventId: event._id,
    attendeeId: absent.user._id,
    status: 'absent',
    method: 'qr',
    recordedAt: new Date(),
  });

  const issued = await issueCertificates(adminAgent, event._id);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.issued, 1);
  const certificates = await getModels().EventCertificate.find({ eventId: event._id }).lean();
  assert.equal(certificates.length, 1);

  const presentClient = await login('STU001');
  const absentClient = await login('STU002');
  const download = await presentClient.get(`/api/certificates/${certificates[0]._id}/download/`);
  assert.equal(download.status, 200, 'present students must be able to download their certificate');

  const absentDownload = await absentClient.get(`/api/certificates/${certificates[0]._id}/download/`);
  assert.equal(absentDownload.status, 403, 'absent students must not be able to download a certificate');
});

test('students without an issued certificate cannot download any certificate', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const eligible = await createUser({ username: 'STU001', role: 'student' });
  const ineligible = await createUser({ username: 'STU002', role: 'student' });
  const event = await createEvent(faculty.user);

  const eligibleAttendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: eligibleAttendanceId,
    eventId: event._id,
    attendeeId: eligible.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });

  const issued = await issueCertificates(adminAgent, event._id);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.issued, 1);
  const certificates = await getModels().EventCertificate.find({ eventId: event._id }).lean();
  assert.equal(certificates.length, 1);

  const ineligibleClient = await login('STU002');
  const download = await ineligibleClient.get(`/api/certificates/${certificates[0]._id}/download/`);
  assert.equal(download.status, 403, 'only an issued student may download their certificate');
});

test('certificates can be issued for a completed event when attendance is recorded', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user, { status: 'published' });

  const attendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: attendanceId,
    eventId: event._id,
    attendeeId: student.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });

  const issued = await issueCertificates(adminAgent, event._id);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.equal(issued.body.issued, 1, 'should issue for present students on a completed/past event');
});

test('certificates cannot be issued for a cancelled event', async () => {
  const adminAgent = await admin();
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user, { status: 'cancelled' });

  const attendanceId = await (await import('./helpers.js')).nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: attendanceId,
    eventId: event._id,
    attendeeId: student.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });

  const issued = await issueCertificates(adminAgent, event._id);
  assert.equal(issued.status, 409, 'issuance must be rejected for cancelled events');
  assert.equal(
    (await getModels().EventCertificate.countDocuments({ eventId: event._id })).toString(),
    '0',
    'no certificate must be created for a cancelled event',
  );
});

test('downloading a non-existent certificate returns 404', async () => {
  const client = await login('STU001');
  const missingId = '000000000000000000000000';
  const download = await client.get(`/api/certificates/${missingId}/download/`);
  assert.equal(download.status, 404, 'missing certificate must return 404');
});
