/**
 * Event wall-clock time zone.
 *
 * ONE PLACE decides what "17:25" means for an event. Previously
 * `parseLocalDateTime` appended `Z` to the administrator's typed wall-clock,
 * which silently reinterpreted Philippine local time as UTC and moved every
 * event eight hours later than intended.
 *
 * THE BUG WAS INVISIBLE IN THE ADMIN FORM, which is why it survived. The form
 * echoes the stored value back as a UTC slice, so it displayed exactly what was
 * typed even though the underlying instant was wrong. The Student card renders
 * the real instant in the reader's own zone, so it showed the true - and wrong -
 * time. Two halves of one mistake cancelled on the admin screen and only
 * surfaced to attendees.
 *
 * WHY A FIXED +08:00 IS CORRECT HERE, NOT A SHORTCUT. The Philippines has
 * observed a single UTC+8 offset with no daylight saving since 1978, and these
 * are future-dated events. The offset is still RESOLVED THROUGH `Intl` at
 * runtime rather than assumed, so a future rule change cannot leave a silent
 * eight-hour error behind; `MANILA_OFFSET_HOURS` is only the documented
 * expectation that `assertManilaOffsetIsStable()` checks.
 */
export const EVENT_TIME_ZONE = 'Asia/Manila';

/** The Philippines' documented, DST-free offset from UTC, in hours. */
export const MANILA_OFFSET_HOURS = 8;

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const manilaParts = (instant) => Object.fromEntries(
  partsFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
);

/** The UTC offset, in hours, Manila was observing at a given instant. */
function offsetHoursAt(instant) {
  const parts = manilaParts(instant);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 3_600_000;
}

/**
 * Turns an administrator's MANILA wall-clock into the UTC instant to store.
 *
 * Returns null for anything that is not a real date and time, so the caller
 * keeps its existing validation error instead of storing a nonsense instant.
 */
export function manilaWallClockToInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(time || '')) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [rawHour, minute, second = 0] = (time.length === 5 ? `${time}:00` : time).split(':').map(Number);
  const hour = rawHour === 24 ? 0 : rawHour;

  // Ranges are checked EXPLICITLY because `Date.UTC` rolls out-of-range values
  // over into a valid but different date: "99:99" would become 4 Oct 17:39 on
  // the 7th. That silent rollover is the same class of defect as the
  // eight-hour bug - a nonsense time accepted as if it were a real one - so it
  // is rejected here and the caller keeps its own validation message.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (rawHour > 23 || minute > 59 || second > 59) return null;
  // Reject dates that only exist in the calendar's validation, e.g. 30 Feb.
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) return null;

  // Guess the instant as if the wall-clock were UTC, then correct by whatever
  // offset Manila is actually on at that moment. The correction is a whole
  // number of hours, so one pass is enough to land on the right instant.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(guess.getTime())) return null;
  const instant = new Date(guess.getTime() - offsetHoursAt(guess) * 3_600_000);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** `YYYY-MM-DD` for an instant, as the administrator sees it in Manila. */
export function manilaDate(instant) {
  const parts = manilaParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** `HH:MM` for an instant, as the administrator sees it in Manila. */
export function manilaTime(instant) {
  const parts = manilaParts(instant);
  return `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

/**
 * Guards the assumption the offset maths relies on. Throws if the zone is ever
 * no longer UTC+8, so a rule change becomes a loud startup failure rather than
 * a silent eight-hour shift in every event's stored time.
 */
export function assertManilaOffsetIsStable() {
  const offset = offsetHoursAt(new Date('2026-06-15T00:00:00.000Z'));
  if (Math.abs(offset - MANILA_OFFSET_HOURS) > 1e-9) {
    throw new Error(
      `Event times assume ${EVENT_TIME_ZONE} is UTC+${MANILA_OFFSET_HOURS}, but it is currently UTC+${offset}. `
      + 'Re-check the event time-zone conversion before scheduling events.',
    );
  }
  return offset;
}
