import { expect, test } from '@playwright/test';
import {
  ACCOUNTS,
  VENUE,
  adminContext,
  allowScannerLocation,
  cleanupOwnedEvents,
  expectIsolatedBackend,
  isolatedMongoUri,
  newAttendeeContext,
  ownedEventName,
  provisionQrEvent,
  setLocation,
  signIn,
} from './helpers';
import {
  canShowAttendanceAction,
  durationLabel,
  registrationLabel,
  requiredAttendanceLabel,
} from '../src/utils/eventLabels';
import { scanMatchesEvent } from '../src/utils/eventQr';

/** A QR naming some other event. Well-formed, but not this card's event. */
const FOREIGN_QR = 'COT-EVENT:00000000-0000-4000-8000-000000000000:sometoken';

/**
 * MUST match `OWNED_NAME_PREFIX` in backend/scripts/cleanup-e2e-test-event.mjs.
 *
 * Kept as one constant so a fixture this spec creates is provably the same kind
 * of record the cleanup script is allowed to remove. If the two ever diverge,
 * cleanup refuses - loudly - rather than silently leaving records behind.
 */
const OWNED_PREFIX = 'E2E-CARD-WORDING-PROBE-';

/**
 * Opens the card list for the seeded student, with the position re-applied
 * AFTER navigation.
 *
 * WHY RE-APPLY AFTER NAVIGATION. Measured on this machine, not assumed: a
 * geolocation override supplied at `newContext` time is served on the first
 * document (`/login/student` reports the fix fine) but is NOT served once the
 * page has navigated to the Portal - `getCurrentPosition` there fails with
 * TIMEOUT, whatever options it is given, including no options at all. Calling
 * `context.setGeolocation()` again after the navigation makes the very same
 * page report the fix immediately.
 *
 * Without this the scanner's own location read stalls for its full 15 s and the
 * app reports "Taking a location reading took too long" - a harness artefact that
 * has nothing to do with the card or the scoping rule under test. This is the
 * same ordering the other scanning specs use, which is why they are unaffected.
 */
async function openEvents(page: import('@playwright/test').Page) {
  await signIn(page, ACCOUNTS.student, 'student');
  await page.goto('/portal?view=events');
  await setLocation(page.context(), VENUE);
}

/**
 * The position is the SUITE'S OWN synthetic venue - the same `VENUE` the other
 * specs fence against - and deliberately NOT the real phone-test venue. These
 * tests must stay meaningful without a person standing anywhere, and pointing
 * them at a real campus location would let a pass depend on that location being
 * reachable and unchanged.
 */
async function studentAtVenue(browser: import('@playwright/test').Browser) {
  return newAttendeeContext(browser, test.info().project.use.baseURL as string, VENUE);
}

/**
 * PURE-FUNCTION tests for the event card's wording and gating.
 *
 * These run without a browser or a server: each is a plain function of a
 * server-sent value. That is the point. The bug these pin was a labelling error -
 * an event's LENGTH rendered under the name of the attendance REQUIREMENT, so a
 * 2-minute requirement displayed as "2h 5m" - and a labelling error is exactly
 * the kind of mistake that hides inside JSX where it cannot be asserted.
 *
 * The rendered card against the real isolated stack is verified separately in
 * eventCard.e2e.spec.ts, so a wording regression fails fast and precisely here
 * instead of surfacing as a flaky UI assertion.
 */

test.describe('event card duration labels', () => {
  // The 125 / 2 pair is the real GST006-TRACKING-TEST: an event running 2 h 5 m
  // that requires 2 minutes of attendance. They are unrelated numbers and the
  // bug was showing one under the other's name.
  test('formats the event length as hours and minutes', () => {
    expect(durationLabel(125)).toBe('2h 5m');
    expect(durationLabel(120)).toBe('2h');
    expect(durationLabel(60)).toBe('1h');
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(2)).toBe('2 min');
  });

  test('shows the saved requirement as 2 minutes, never as the 125-minute event length', () => {
    expect(requiredAttendanceLabel(2)).toBe('2 min');
    expect(requiredAttendanceLabel(2)).not.toBe(durationLabel(125));
    expect(requiredAttendanceLabel(2)).not.toContain('h');
  });

  test('says a requirement is not configured instead of inventing a duration', () => {
    expect(requiredAttendanceLabel(null)).toBe('Minimum duration not configured');
    expect(requiredAttendanceLabel(undefined)).toBe('Minimum duration not configured');
    // The event length must never be substituted for a missing requirement.
    expect(requiredAttendanceLabel(null)).not.toContain('2h 5m');
    expect(requiredAttendanceLabel(null)).not.toBe(durationLabel(125));
  });
});

test.describe('event card registration status', () => {
  test('states that registration is not required for this event', () => {
    expect(registrationLabel({ registration_required: false, registration_status: 'not_required' }))
      .toBe('Registration not required');
  });

  test('states that registration is required when the event demands it', () => {
    expect(registrationLabel({ registration_required: true, registration_status: 'required' }))
      .toBe('Registration required');
  });

  test('reports an existing registration instead of asking again', () => {
    expect(registrationLabel({ registration_required: true, registration_status: 'registered' }))
      .toBe('Registered');
  });
});

test.describe('event card attendance action gating', () => {
  // The button restates the server's `can_check_in`; it must never re-derive the
  // check-in window, the registration rule or the role rules, or it could offer an
  // action the API would refuse.
  test('offers the action only when the server says check-in is open', () => {
    expect(canShowAttendanceAction({ can_check_in: true, attendance_status: null })).toBe(true);
    expect(canShowAttendanceAction({ can_check_in: false, attendance_status: null })).toBe(false);
  });

  test('does not offer a second check-in once attendance is recorded', () => {
    expect(canShowAttendanceAction({ can_check_in: true, attendance_status: 'present' })).toBe(false);
    expect(canShowAttendanceAction({ can_check_in: true, attendance_status: 'late' })).toBe(false);
  });
});

test.describe('the student event card states the real registration and duration facts', () => {
  let fixtureId = '';

  test.beforeEach(async ({ browser }) => {
    // Refuse to write anything unless the stack is genuinely the isolated one,
    // and unless the cleanup target really is a test database. Checked here, at
    // the point of the WRITE, rather than only at config load.
    isolatedMongoUri();
    const admin = await adminContext(browser);
    try {
      await expectIsolatedBackend(await admin.newPage());

      // A fresh, uniquely named event per test: two tests, or a retry, can never
      // share one mutable event, and nothing here depends on a window that was
      // set up on an earlier day.
      fixtureId = await provisionQrEvent(admin, {
        name: ownedEventName(OWNED_PREFIX, test.info().title),
        requiredAttendanceMinutes: 2,
      });
    } finally {
      await admin.close();
    }
  });

  test.afterEach(() => {
    // Runs after an ordinary assertion failure too, so a failing run does not
    // leave fixtures behind for the next one to trip over.
    //
    // `cleanupOwnedEvents` THROWS on failure rather than logging. A leftover
    // fixture is a real defect in the run, and a `console.warn` is exactly the
    // kind of message that scrolls past a green summary; throwing from
    // `afterEach` is what makes an otherwise-passing run go red instead.
    const created = fixtureId;
    fixtureId = '';
    cleanupOwnedEvents(created ? [created] : []);
  });

  test('shows event length and required attendance separately, and says registration is not required', async ({ browser }) => {
    const context = await studentAtVenue(browser);
    const page = await context.newPage();
    await openEvents(page);

    const card = page.locator(`article:has([data-testid="scan-${fixtureId}"])`);
    await expect(card).toBeVisible();

    // The SERVER must be sending the real saved requirement. Asserted through the
    // API as well as the screen, so a card that renders the right wording from
    // the wrong number cannot pass.
    const record = await (await context.request.get(`/api/events/${fixtureId}/`)).json();
    expect(record.required_attendance_minutes, 'the student API must carry the saved 2-minute requirement').toBe(2);
    expect(record.registration_required, 'registration must be disabled for this fixture').toBe(false);
    expect(record.registration_status).toBe('not_required');
    // The whole point of the time-dependent fixture: the server says check-in is
    // open, so the card is entitled to offer the action.
    expect(record.can_check_in, 'the provisioned event must be open for check-in').toBe(true);
    // Event LENGTH and the attendance REQUIREMENT are unrelated numbers, and
    // here the length is deliberately far larger than 2 minutes.
    expect(record.duration_minutes).toBeGreaterThan(record.required_attendance_minutes);

    // The saved requirement is 2 minutes. It previously read "2h 5m" because the
    // card showed the event's length under the requirement's label.
    const required = card.locator('div').filter({ hasText: /^Required attendance/ }).last();
    await expect(required).toContainText('2 min');
    await expect(required).not.toContainText('2h');

    // The event itself runs for hours (the fixture spans the whole UTC day), and
    // that fact is shown under its OWN name - never under the requirement's.
    const length = card.locator('div').filter({ hasText: /^Event length/ }).last();
    await expect(length).toContainText('h');

    // Registration is not required here, and the card says so rather than
    // silently offering nothing.
    await expect(card.getByText('Registration not required')).toBeVisible();

    // The action the student actually has is offered: check in and be tracked.
    await expect(card.getByRole('button', { name: /scan attendance for this event/i })).toBeVisible();

    // This event DOES have a requirement, so "not configured" must not appear.
    await expect(card.getByText('Minimum duration not configured')).toHaveCount(0);
    await context.close();
  });

  test('the card-level scan action is scoped and refuses another event’s QR', async ({ browser }) => {
    const context = await studentAtVenue(browser);
    const page = await context.newPage();
    await openEvents(page);
    const card = page.locator(`article:has([data-testid="scan-${fixtureId}"])`);
    await card.getByRole('button', { name: /scan attendance for this event/i }).click();
    await expect(page.getByLabel('Manual fallback')).toBeVisible();
    await allowScannerLocation(page);

    // A QR naming a different event must be refused by the SCOPED scanner, with a
    // clear message and WITHOUT recording anything.
    await page.getByLabel('Manual fallback').fill(FOREIGN_QR);
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByTestId('scan-error')).toContainText(/different event/i);
    await expect(page.getByText('Attendance recorded')).toHaveCount(0);

    // Nothing may have been sent to the server for this event either: the guard
    // refuses before any request is made. Asserted against the SERVER, because a
    // screen that simply has not updated yet would satisfy a weaker check.
    const recorded = await (await context.request.get('/api/attendance/me/')).json();
    const rows = (recorded.records ?? []) as { eventId: string }[];
    expect(
      rows.filter((row) => row.eventId === fixtureId),
      'a refused foreign QR must not record attendance for this event',
    ).toHaveLength(0);
    await context.close();
  });

  test('the general scanner is unchanged and defers to the server on any QR', async ({ browser }) => {
    const context = await studentAtVenue(browser);
    const page = await context.newPage();
    await openEvents(page);
    // The GENERAL entry point, in the page header rather than on a card.
    await page.getByRole('button', { name: /^scan attendance$/i }).click();
    await expect(page.getByLabel('Manual fallback')).toBeVisible();
    await allowScannerLocation(page);

    // With no event preselected the scoping guard must NOT fire, so the error must
    // NOT be "different event": the verdict belongs to the server.
    await page.getByLabel('Manual fallback').fill(FOREIGN_QR);
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByTestId('scan-error')).toBeVisible();
    await expect(page.getByTestId('scan-error')).not.toContainText(/different event/i);
    await context.close();
  });
});

test.describe('scan event matching', () => {
  // A card-level "Scan attendance for this event" button scopes the scanner to one
  // event. That must not become a way to record against the WRONG event.
  test('rejects a QR belonging to a different event when scoped', () => {
    const result = scanMatchesEvent('COT-EVENT:event-b:token-b', 'event-a');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/different event/i);
  });

  test('accepts the scoped event’s own QR', () => {
    expect(scanMatchesEvent('COT-EVENT:event-a:token-a', 'event-a').ok).toBe(true);
  });

  test('leaves the general scanner unchanged - it accepts any event’s QR', () => {
    expect(scanMatchesEvent('COT-EVENT:event-b:token-b', undefined).ok).toBe(true);
  });

  test('does not treat a non-QR card or ID value as an event mismatch', () => {
    // The server decides whether an identifier is valid; this guard only refuses
    // a QR that positively belongs to a different event.
    expect(scanMatchesEvent('RFID-E2E-STU001', 'event-a').ok).toBe(true);
    expect(scanMatchesEvent('12345678', 'event-a').ok).toBe(true);
  });

  test('ignores surrounding whitespace when matching', () => {
    expect(scanMatchesEvent('  COT-EVENT:event-b:token-b  ', 'event-a').ok).toBe(false);
    expect(scanMatchesEvent('  COT-EVENT:event-a:token-a  ', 'event-a').ok).toBe(true);
  });
});
