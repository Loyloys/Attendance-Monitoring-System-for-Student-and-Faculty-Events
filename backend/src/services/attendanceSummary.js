/**
 * Counts attendance for cards, percentages, reports and exports.
 *
 * GST008: FOR A DURATION-REQUIRED EVENT, THE QUALIFICATION IS THE VERDICT, NOT
 * THE SCAN.
 *
 * Counting `status` alone was correct before duration tracking existed, because
 * a scan WAS the whole story. It is no longer: the scan records a check-in the
 * instant it happens, so counting it would report somebody as PRESENT to an
 * administrator, a percentage and a PDF while they are still PENDING - which is
 * precisely the overcounting this feature exists to prevent.
 *
 * So the verdict is taken from `qualification` whenever the record carries one:
 *
 *   qualification 'present' | 'late'  -> counted, honouring lateness
 *   qualification 'absent'           -> counted absent
 *   qualification 'pending'          -> counted NEITHER present nor absent:
 *                                       the person genuinely has not been
 *                                       decided yet, and folding them into
 *                                       either bucket would be a lie
 *   qualification undefined/null      -> no duration requirement, so the
 *                                       established `status` counting is used
 *                                       and nothing about those events changes
 *
 * Both counts are returned so a caller can show the check-in separately from the
 * qualification, which is the distinction the admin table draws in its columns.
 *
 * `absent` still takes the larger of the explicit count and the shortfall
 * against `expected`, exactly as before.
 */
export function summarizeAttendance(records, expected = 0) {
  const decided = records.filter((record) => record.qualification !== null && record.qualification !== undefined);
  const qualifiedPresent = decided.filter((record) => record.qualification === 'present').length;
  const qualifiedLate = decided.filter((record) => record.qualification === 'late').length;
  const qualifiedAbsent = decided.filter((record) => record.qualification === 'absent').length;
  // Check-in counts, reported alongside so arrival is never confused with the verdict.
  const checkedInPresent = records.filter((record) => record.status === 'present').length;
  const checkedInLate = records.filter((record) => record.status === 'late').length;

  const present = qualifiedPresent + qualifiedLate > 0 ? qualifiedPresent : checkedInPresent;
  const late = qualifiedPresent + qualifiedLate > 0 ? qualifiedLate : checkedInLate;
  const explicitAbsent = qualifiedPresent + qualifiedLate + qualifiedAbsent > 0
    ? qualifiedAbsent
    : records.filter((record) => record.status === 'absent').length;

  // A PENDING attendee is excluded from both sides of the ratio: they are neither
  // attended nor yet absent, so counting them would distort the percentage.
  const attended = new Set(
    records
      .filter((record) => {
        if (record.qualification === 'present' || record.qualification === 'late') return true;
        if (record.qualification === 'absent') return false;
        if (record.qualification === 'pending') return false;
        return record.status !== 'absent';
      })
      .map((record) => String(record.attendeeId)),
  ).size;
  const absent = Math.max(explicitAbsent, Math.max(0, expected - attended));
  return {
    present,
    late,
    absent,
    total: Math.max(records.length, expected),
    pending: decided.filter((record) => record.qualification === 'pending').length,
    checkedInPresent,
    checkedInLate,
  };
}
