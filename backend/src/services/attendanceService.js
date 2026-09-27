import { Event, EventAttendance, EventCertificate, EventFeedback, EventRegistration, User, UserProfile } from '../models/index.js';
import { PermissionError, ValidationError } from '../utils/errors.js';
import { nextNumericId } from '../utils/ids.js';
import { eventAllows } from '../utils/events.js';
import { summarizeAttendance } from './attendanceSummary.js';
import { getManagedEvent } from './eventService.js';

export async function personalAttendance(user) {
  const records = await EventAttendance.find({ attendeeId: user._id }).lean();
  const events = await Event.find({ _id: { $in: records.map((record) => record.eventId) } }).lean();
  const eventById = new Map(events.map((event) => [event._id, event]));
  records.sort((left, right) => eventById.get(right.eventId).startsAt - eventById.get(left.eventId).startsAt);
  const summary = summarizeAttendance(records);
  const totalAttended = summary.present + summary.late;
  const denominator = totalAttended + summary.absent;
  return {
    summary: {
      present: summary.present,
      late: summary.late,
      absent: summary.absent,
      attendancePercentage: denominator ? Math.round((totalAttended * 100) / denominator) : 0,
    },
    records: records.map((record) => {
      const event = eventById.get(record.eventId);
      return {
        id: record._id,
        eventId: record.eventId,
        eventName: event.name,
        eventDate: new Date(event.startsAt).toISOString(),
        status: record.status,
        method: record.method,
        recordedAt: new Date(record.recordedAt).toISOString(),
      };
    }),
  };
}

export async function monitoredAttendance(user, eventId) {
  if (user.profile.role !== 'faculty') throw new PermissionError('This action is not available for your role.');
  const event = await getManagedEvent(user, eventId);
  const [records, registrations, attendeeIds] = await Promise.all([
    EventAttendance.find({ eventId: event._id }).lean(),
    EventRegistration.find({ eventId: event._id, status: 'registered' }).lean(),
    UserProfile.find({ role: 'student' }).select('userId').lean(),
  ]);
  const registeredStudentIds = new Set(registrations.map((registration) => String(registration.attendeeId)));
  const expected = [...registeredStudentIds].filter((id) => attendeeIds.some((profile) => String(profile.userId) === id)).length;
  const profiles = await UserProfile.find({ userId: { $in: records.map((record) => record.attendeeId) } }).lean();
  const byUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
  const users = await User.find({ _id: { $in: records.map((record) => record.attendeeId) } }).lean();
  const userById = new Map(users.map((entry) => [String(entry._id), entry]));
  const ordered = records
    .map((record) => ({ record, profile: byUser.get(String(record.attendeeId)), user: userById.get(String(record.attendeeId)) }))
    .sort((left, right) => (left.profile?.displayName || '').localeCompare(right.profile?.displayName || ''));
  const summary = summarizeAttendance(records, expected);
  return {
    event: { id: event._id, name: event.name, venue: event.venue },
    summary: { ...summary, registered: expected },
    attendees: ordered.map(({ record, profile, user }) => ({
      id: user?.username || profile?.displayName || String(record.attendeeId),
      name: profile?.displayName || 'Unknown user',
      role: profile?.role || 'student',
      status: record.status,
      method: record.method,
      recordedAt: new Date(record.recordedAt).toISOString(),
    })),
  };
}

export async function submitFeedback(user, eventId, data) {
  if (!['student', 'faculty'].includes(user.profile.role)) throw new PermissionError('This action is not available for your role.');
  const event = await Event.findOne({
    _id: eventId,
    status: 'published',
    $or: [{ audience: 'all' }, { audience: user.profile.role }],
  }).lean();
  if (!event || !eventAllows(event, user.profile)) throw new ValidationError({ event: 'Event not found.' });
  const attendance = await EventAttendance.findOne({ eventId, attendeeId: user._id }).lean();
  if (!attendance || attendance.status === 'absent') throw new ValidationError({ feedback: 'Feedback is available only after event attendance.' });
  const rating = Number(data.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ValidationError({ rating: 'Choose a rating from 1 to 5.' });
  const comments = String(data.comments ?? '').trim().slice(0, 2000);
  try {
    const feedback = await EventFeedback.create({
      _id: await nextNumericId('eventFeedback'),
      eventId,
      attendeeId: user._id,
      rating,
      comments,
      submittedAt: new Date(),
    });
    return feedback;
  } catch (error) {
    if (error.code === 11000) {
      const conflict = new Error('Feedback was already submitted for this event.');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}
