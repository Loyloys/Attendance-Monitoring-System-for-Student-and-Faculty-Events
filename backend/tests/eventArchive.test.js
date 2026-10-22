import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, createUser, getModels, login, reset, send, setup, teardown } from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

test('archiving an event hides it from students and lets an administrator restore it', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  const adminUser = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await createEvent(adminUser.user, { audience: 'all' });
  const { agent: student } = await login('STU001');
  const { agent: admin } = await login('ADM001');

  assert.ok((await student.get('/api/events/')).body.some((row) => row.id === event._id));

  const archived = await send(admin, 'post', `/api/admin/events/${event._id}/archive/`);
  assert.equal(archived.status, 200, JSON.stringify(archived.body));

  const stored = await getModels().Event.findById(event._id).lean();
  assert.ok(stored.archivedAt);
  assert.equal(String(stored.archivedBy), String((await getModels().User.findOne({ accountId: 'ADM001' }).lean())._id));

  const studentList = await student.get('/api/events/');
  assert.ok(!studentList.body.some((row) => row.id === event._id), 'archived event must not appear for students');

  const adminList = await admin.get('/api/admin/events/');
  const listed = adminList.body.find((row) => row.id === event._id);
  assert.ok(listed, 'archived event still listed for administrators');
  assert.ok(listed.archivedAt, 'archived event reports archivedAt');

  const restored = await send(admin, 'post', `/api/admin/events/${event._id}/restore/`);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal((await getModels().Event.findById(event._id).lean()).archivedAt, null);
  assert.ok((await student.get('/api/events/')).body.some((row) => row.id === event._id));
});

/**
 * REGRESSION: an event whose record predates the current schema.
 *
 * The demo seed wrote "Demo Student Developers Meetup" without a `venue`.
 * Archiving it answered 400 `{ "venue": "Path 'venue' is required." }` because
 * the archive action used to save the WHOLE document, and Mongoose re-validates
 * every path on save. The archive fields were perfectly valid; the refusal came
 * from a field the archive action never touches.
 *
 * Archiving and restoring must therefore work on such a record, and must not
 * rewrite the missing field either - the archive action owns two fields, and it
 * touches only those two.
 */
test('archiving works on an event whose record is missing an unrelated required field', async () => {
  const adminUser = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await createEvent(adminUser.user, { audience: 'all' });
  // Reproduce the legacy record: the document is written WITHOUT `venue`.
  await getModels().Event.updateOne({ _id: event._id }, { $unset: { venue: '' } });
  assert.equal((await getModels().Event.findById(event._id).lean()).venue, undefined);

  const { agent: admin } = await login('ADM001');

  const archived = await send(admin, 'post', `/api/admin/events/${event._id}/archive/`);
  assert.equal(archived.status, 200, JSON.stringify(archived.body));

  const stored = await getModels().Event.findById(event._id).lean();
  assert.ok(stored.archivedAt, 'the archive timestamp was written');
  assert.equal(stored.venue, undefined, 'the unrelated missing field was not invented');

  const restored = await send(admin, 'post', `/api/admin/events/${event._id}/restore/`);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal((await getModels().Event.findById(event._id).lean()).archivedAt, null);
});

test('archiving twice and restoring an event that is not archived are both refused', async () => {
  const adminUser = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await createEvent(adminUser.user, { audience: 'all' });
  const { agent: admin } = await login('ADM001');

  assert.equal((await send(admin, 'post', `/api/admin/events/${event._id}/restore/`)).status, 400);
  assert.equal((await send(admin, 'post', `/api/admin/events/${event._id}/archive/`)).status, 200);
  assert.equal((await send(admin, 'post', `/api/admin/events/${event._id}/archive/`)).status, 400);
});

test('an archived event leaves the faculty working list and cannot be archived by a student', async () => {
  const facultyUser = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'STU001', role: 'student' });
  const adminUser = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await createEvent(facultyUser.user, { audience: 'all' });
  const { agent: faculty } = await login('FAC001');
  const { agent: student } = await login('STU001');
  const { agent: admin } = await login('ADM001');

  assert.ok((await faculty.get('/api/events/managed/')).body.some((row) => row.id === event._id));

  assert.equal((await send(student, 'post', `/api/admin/events/${event._id}/archive/`)).status, 403);
  assert.equal((await send(admin, 'post', `/api/admin/events/${event._id}/archive/`)).status, 200);

  assert.ok(!(await faculty.get('/api/events/managed/')).body.some((row) => row.id === event._id));
  assert.ok(!(await student.get('/api/events/')).body.some((row) => row.id === event._id));
});
