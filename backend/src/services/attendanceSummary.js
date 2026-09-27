export function summarizeAttendance(records, expected = 0) {
  const present = records.filter((record) => record.status === 'present').length;
  const late = records.filter((record) => record.status === 'late').length;
  const explicitAbsent = records.filter((record) => record.status === 'absent').length;
  const attended = new Set(records.filter((record) => record.status !== 'absent').map((record) => String(record.attendeeId))).size;
  const absent = Math.max(explicitAbsent, Math.max(0, expected - attended));
  return { present, late, absent, total: Math.max(records.length, expected) };
}
