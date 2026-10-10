import type { EventRecord } from '../types/eventAttendance';

/**
 * Event-card wording, kept apart from the component so it can be unit-tested
 * directly.
 *
 * These are pure functions of server-sent values. That is deliberate: the bug this
 * module exists to prevent was a labelling error, where an event's LENGTH was
 * rendered under the name of the attendance REQUIREMENT, making a 2-minute
 * requirement read as "2h 5m" on a student's own card. Pure, separately tested
 * functions make that class of mistake visible instead of buried in JSX.
 */

/**
 * Formats a duration in whole minutes as "45 min" or "2h 5m".
 *
 * Both durations below are formatted from SERVER-SENT whole minutes, so the
 * browser never recomputes a duration from two timestamps - which is where
 * timezone mistakes creep in and where a number silently drifts from the stored
 * value.
 */
export const durationLabel = (minutes: number): string => {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim();
  return `${minutes} min`;
};

/**
 * How long the EVENT runs. This is the schedule, not an attendance rule.
 */
export const eventLengthLabel = (minutes: number): string => durationLabel(minutes);

/**
 * The attendance a student must actually earn to be credited.
 *
 * Event length and required attendance are two unrelated numbers: an event can
 * run 2 h 5 m and require only 2 minutes of verified attendance. They are
 * formatted separately and labelled separately for exactly that reason.
 *
 * A null requirement renders as "not configured". It is NOT filled in from the
 * event length - that would invent an attendance rule nobody chose and could
 * demand a student stay hours for an event that requires nothing - and it is NOT
 * phrased as "no minimum stay", which would assert a policy that was never set.
 */
export const requiredAttendanceLabel = (minutes: number | null | undefined): string => {
  if (minutes === null || minutes === undefined) return 'Minimum duration not configured';
  return durationLabel(minutes);
};

/**
 * The registration state to show on a card.
 *
 * "Registration not required" is an affirmative statement of the event's own
 * configuration: this event does not ask anybody to register. It must never be
 * presented as though registration had closed or been missed, because that would
 * wrongly imply the student missed a deadline or is ineligible.
 */
export const registrationLabel = (
  event: Pick<EventRecord, 'registration_required' | 'registration_status'>,
): string => {
  if (event.registration_status === 'registered') return 'Registered';
  return event.registration_required ? 'Registration required' : 'Registration not required';
};

/**
 * Whether the card should offer the attendance action.
 *
 * Intentionally a thin restatement of the SERVER's `can_check_in`, never a second
 * implementation of it. The check-in window, the registration rule and the role
 * rules all stay exactly as the API computes them, so the card cannot offer an
 * action the API would refuse. Attendance already recorded also hides the action,
 * because a second check-in for the same event is not something to offer.
 */
export const canShowAttendanceAction = (
  event: Pick<EventRecord, 'can_check_in' | 'attendance_status'>,
): boolean => event.can_check_in && !event.attendance_status;
