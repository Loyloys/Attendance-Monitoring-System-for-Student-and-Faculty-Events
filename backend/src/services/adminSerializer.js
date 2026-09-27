export function serializeAdminUser(user) {
  return {
    id: user.accountId,
    username: user.username,
    name: user.profile.displayName,
    email: user.email || '',
    contact: user.profile.phone || user.email || '',
    role: { student: 'Student', faculty: 'Faculty', admin: 'Admin' }[user.profile.role],
    department: user.profile.department || '',
    status: user.isActive ? 'Active' : 'Inactive',
    createdAt: new Date(user.dateJoined).toISOString(),
    legacyId: user.legacyId ? String(user.legacyId) : undefined,
  };
}

export function serializeAdminAttendance(record, user, event) {
  return {
    id: String(record._id),
    eventId: record.eventId,
    personId: user.accountId,
    name: user.profile.displayName,
    role: user.profile.role === 'faculty' ? 'Faculty' : 'Student',
    department: user.profile.department || '',
    status: record.status[0].toUpperCase() + record.status.slice(1),
    scannedAt: new Date(record.recordedAt).toISOString(),
    source: record.source || 'Scan',
    note: record.note || undefined,
    correctedAt: record.correctedAt ? new Date(record.correctedAt).toISOString() : undefined,
    eventDate: event ? new Date(event.startsAt).toISOString().slice(0, 10) : undefined,
  };
}
