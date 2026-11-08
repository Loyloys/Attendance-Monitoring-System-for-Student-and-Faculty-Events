import { Announcement } from '../models/index.js';
import { ValidationError } from '../utils/errors.js';
import { sendAnnouncementPush } from './pushNotificationService.js';

function serialize(row) {
  return {
    id: String(row._id),
    title: row.title,
    message: row.message,
    audience: row.audience,
    createdByName: row.createdByName || '',
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listAnnouncements(role) {
  const audience = role === 'admin' ? {} : { audience: { $in: ['all', role] } };
  const rows = await Announcement.find(audience).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map(serialize);
}

export async function createAnnouncement(data, actor) {
  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  const message = typeof data?.message === 'string' ? data.message.trim() : '';
  const audience = data?.audience;
  if (!title || title.length > 180) throw new ValidationError({ title: 'Enter a title up to 180 characters.' });
  if (!message || message.length > 10_000) throw new ValidationError({ message: 'Enter a message up to 10,000 characters.' });
  if (!['all', 'student', 'faculty'].includes(audience)) throw new ValidationError({ audience: 'Choose Students, Faculty, or both.' });
  const row = await Announcement.create({
    title,
    message,
    audience,
    createdBy: actor._id,
    createdByName: `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.username,
  });
  const announcement = serialize(row);
  let notificationDelivery;
  try {
    notificationDelivery = await sendAnnouncementPush(announcement);
  } catch (error) {
    console.error('Could not send push notifications for announcement:', error?.code || error?.name || 'unknown error');
    notificationDelivery = { status: 'failed', sent: 0, failed: 0 };
  }
  return { ...announcement, notificationDelivery };
}
