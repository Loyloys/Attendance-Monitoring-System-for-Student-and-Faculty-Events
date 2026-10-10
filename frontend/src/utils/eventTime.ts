/**
 * The zone every event's schedule is written and read in.
 *
 * The API already interprets an administrator's `<input type="date">` +
 * `<input type="time">` pair as ASIA/MANILA and stores the matching UTC
 * instant. These helpers read that instant back in the SAME zone, which is what
 * makes the Admin form round-trip and the Student card agree with the
 * administrator's screen.
 *
 * WHY THE ZONE IS PINNED RATHER THAN LEFT TO THE DEVICE. These calls used to
 * pass no `timeZone`, so the same event rendered as different wall-clock times
 * on different devices. That is how an eight-hour error stayed hidden for so
 * long: the admin form echoed back UTC, the student's card rendered their own
 * zone, and the two halves of one mistake cancelled on the admin's screen while
 * telling attendees something different. Pinning both ends to the same zone
 * removes the possibility of them disagreeing again.
 *
 * Operational stamps that are NOT a schedule - "recorded at", "last verified",
 * "account created", "generated" - deliberately keep using the device's own
 * zone, because those describe when something happened here, not when an event
 * is scheduled.
 */
export const EVENT_TIME_ZONE = 'Asia/Manila';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: EVENT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const stampFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: EVENT_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** e.g. "Sun, Oct 4, 2026" - the day an event falls on, in Manila. */
export const eventDateLabel = (value: string) => dateFormatter.format(new Date(value));

/** e.g. "17:25" - the wall-clock an event starts or ends, in Manila. */
export const eventTimeLabel = (value: string) => timeFormatter.format(new Date(value));

/** e.g. "4 Oct 2026, 17:25" - a full event timestamp, in Manila. */
export const eventStampLabel = (value: string) => stampFormatter.format(new Date(value));