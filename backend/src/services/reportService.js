import PDFDocument from 'pdfkit';
import { Event, EventAttendance, EventCertificate, EventRegistration, UserProfile } from '../models/index.js';
import { NotFoundError, PermissionError } from '../utils/errors.js';
import { getManagedEvent } from './eventService.js';
import { summarizeAttendance } from './attendanceSummary.js';
import { methodLabel, statusLabel } from '../utils/labels.js';

function formatDateTime(value) {
  return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
}

function renderPdf({ title, subtitle, summary, columns, rows, footer }) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.fontSize(18).fillColor('#1746a2').text(title);
    document.moveDown(0.4).fontSize(10).fillColor('#3f4c61').text(subtitle);
    document.text(summary);
    document.moveDown();
    const startY = document.y;
    let x = 40;
    document.fontSize(8).fillColor('#141923');
    columns.forEach((column) => { document.text(column[0], x, startY, { width: column[1] }); x += column[1]; });
    document.moveTo(40, startY + 14).lineTo(555, startY + 14).strokeColor('#d1d7e0').stroke();
    rows.forEach((row) => {
      if (document.y > 770) document.addPage();
      const rowY = document.y + 3;
      x = 40;
      row.forEach((value, index) => { document.fillColor('#333a46').text(String(value ?? ''), x, rowY, { width: columns[index][1] }); x += columns[index][1]; });
      document.y = rowY + 15;
    });
    document.fontSize(8).fillColor('#707986').text(footer, 40, 805, { align: 'center', width: 515 });
    document.end();
  });
}

export async function personalAttendancePdf(user) {
  if (!['student', 'faculty'].includes(user.profile.role)) throw new PermissionError('This action is not available for your role.');
  const records = await EventAttendance.find({ attendeeId: user._id }).lean();
  const events = await Event.find({ _id: { $in: records.map((record) => record.eventId) } }).lean();
  const byId = new Map(events.map((event) => [event._id, event]));
  records.sort((a, b) => byId.get(b.eventId).startsAt - byId.get(a.eventId).startsAt);
  const summary = summarizeAttendance(records);
  const attended = summary.present + summary.late;
  const denominator = attended + summary.absent;
  const percentage = denominator ? Math.round((attended * 100) / denominator) : 0;
  const content = await renderPdf({
    title: 'Personal Event Attendance Report',
    subtitle: `${user.profile.displayName} (${user.username})`,
    summary: `Attendance percentage: ${percentage}% | Records: ${records.length}`,
    columns: [['Event', 170], ['Date and time', 120], ['Status', 70], ['Method', 110]],
    rows: records.map((record) => [byId.get(record.eventId).name, formatDateTime(byId.get(record.eventId).startsAt), statusLabel(record.status), methodLabel(record.method)]),
    footer: 'COT Event Attendance',
  });
  return { content, filename: 'personal-event-attendance.pdf' };
}

export async function eventAttendancePdf(user, eventId) {
  if (user.profile.role !== 'faculty') throw new PermissionError('This action is not available for your role.');
  const event = await getManagedEvent(user, eventId);
  const records = await EventAttendance.find({ eventId: event._id }).lean();
  const profiles = await UserProfile.find({ userId: { $in: records.map((record) => record.attendeeId) } }).lean();
  const byUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
  const registrations = await EventRegistration.find({ eventId: event._id, status: 'registered' }).lean();
  const registeredProfiles = await UserProfile.find({ userId: { $in: registrations.map((registration) => registration.attendeeId) }, role: 'student' }).lean();
  const expected = registeredProfiles.length;
  const summary = summarizeAttendance(records, expected);
  const content = await renderPdf({
    title: 'Authorized Event Attendance Report',
    subtitle: event.name,
    summary: `Present: ${summary.present} | Late: ${summary.late} | Absent: ${summary.absent} | Total: ${summary.total}`,
    columns: [['Attendee', 135], ['ID', 80], ['Role', 65], ['Status', 65], ['Recorded', 140]],
    rows: records.map((record) => {
      const profile = byUser.get(String(record.attendeeId));
      return [profile?.displayName || 'Unknown user', profile?.userId, profile?.role || 'student', statusLabel(record.status), formatDateTime(record.recordedAt)];
    }),
    footer: 'COT Event Attendance',
  });
  return { content, filename: 'event-attendance-report.pdf' };
}

export async function certificatePdf(user, certificateId) {
  if (user.profile.role !== 'student') throw new PermissionError('This action is not available for your role.');
  const certificate = await EventCertificate.findOne({ _id: certificateId, studentId: user._id }).lean();
  if (!certificate) throw new NotFoundError('Certificate not found.');
  const event = await Event.findById(certificate.eventId).lean();
  const organizer = await UserProfile.findOne({ userId: event.organizerId }).lean();
  const content = await renderPdf({
    title: 'Event Participation Certificate',
    subtitle: event.name,
    summary: `This certificate is issued to ${user.profile.displayName} (${user.username}).`,
    columns: [['Reference', 130], ['Event date', 100], ['Organizer', 220]],
    rows: [[certificate.reference, new Date(event.startsAt).toISOString().slice(0, 10), organizer?.displayName || 'College of Technologies']],
    footer: 'COT Event Attendance',
  });
  return { content, filename: 'event-participation-certificate.pdf' };
}
