  import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  ACCOUNTS, VENUE, apiWrite, backendIssuedToken, cleanupOwnedEvents, expectIsolatedBackend,
  newAttendeeContext, ownedEventName, openScanner, signIn, submitCode,
} from './helpers';

/** MUST match an entry in `OWNED_NAME_PREFIXES` in cleanup-e2e-test-event.mjs. */
const OWNED_PREFIX = 'E2E-REG-';

let owned: string[] = [];
test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

const REGISTRATION_BOX = /students must register before checking in/i;
const PERCENTAGE_BOX = /counts toward the attendance percentage/i;

const MANILA_OFFSET_MS = 8 * 3_600_000;

/**
 * A `YYYY-MM-DD` date in Asia/Manila wall-clock terms, which is what the
 * administrator write contract parses.
 *
 * The fields of `now` shifted by the offset read as Manila wall-clock, and they
 * are formatted DIRECTLY. Converting them to an instant first would yield the
 * PREVIOUS UTC day, because Manila midnight is 16:00 UTC the day before.
 */
function manilaDate(offsetDays = 0) {
  const manilaNow = new Date(Date.now() + MANILA_OFFSET_MS);
  return new Date(Date.UTC(
    manilaNow.getUTCFullYear(),
    manilaNow.getUTCMonth(),
    manilaNow.getUTCDate() + offsetDays,
  )).toISOString().slice(0, 10);
}

/**
 * Provisions one test-owned event through the real admin API, with an explicit
 * registration policy.
 *
 * `offsetDays` 0 gives a TODAY 00:00-23:59 window, which is ONGOING: check-in is
 * open but registration is closed. A positive value gives an UPCOMING event,
 * the only state in which registering is possible.
 */
async function adminEvent(context: BrowserContext, options: {
  name: string;
  offsetDays: number;
  registrationRequired: boolean;
  requiredForAttendance: boolean;
}) {
  const response = await apiWrite(context, 'post', '/api/admin/events/', {
    name: options.name,
    description: 'Created by the registration policy browser test.',
    date: manilaDate(options.offsetDays),
    start: '00:00',
    end: '23:59',
    cutoff: '23:00',
    venue: 'E2E Registration Hall',
    venueLatitude: VENUE.latitude,
    venueLongitude: VENUE.longitude,
    venueRadiusMeters: 150,
    audience: 'all',
    method: 'qr',
    status: 'published',
    registrationRequired: options.registrationRequired,
    requiredForAttendance: options.requiredForAttendance,
  });
  expect(response.status(), `event must be created: ${response.status()}`).toBe(201);
  const body = await response.json();
  owned.push(body.id);
  return body as { id: string; name: string };
}

/** The Student's own view of one event, read from the API as that Student. */
async function studentView(page: Page, eventId: string) {
  const events = await (await page.request.get('/api/events/')).json();
  const found = (events as { id: string }[]).find((event) => event.id === eventId);
  expect(found, 'the student must be able to see the event at all').toBeTruthy();
  return found as {
    id: string; status: string; registration_required: boolean;
    registration_status: string; can_register: boolean;
    registration_unavailable_reason: string | null; can_check_in: boolean;
  };
}

/** The event card the Student sees for one event, by name. */
function studentCard(page: Page, name: string) {
  return page.locator('article').filter({ hasText: name }).first();
}

test.describe('Event registration is a setting of its own', () => {
  /**
   * REGRESSION: "counts toward the attendance percentage" and "students must
   * register" are different questions, and the admin form used to answer both
   * with one checkbox.
   *
   * THE DEFECT THIS COVERS. The write contract had no `registrationRequired`
   * field at all - it wrote `registrationRequired: data.requiredForAttendance`.
   * The `Event` model had no `requiredForAttendance` field either. So the single
   * checkbox labelled "Required for percentage" decided whether Students had to
   * register before checking in, and it defaulted to ON: every event created
   * through this form demanded a registration nobody had asked for.
   */
  test('an untouched event requires no registration, and each flag reopens on its own box', async ({ page }) => {
    await expectIsolatedBackend(page);
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');

    const eventName = ownedEventName(OWNED_PREFIX, test.info().title);
    await page.getByRole('button', { name: /create event/i }).click();
    await page.getByLabel('Event name').fill(eventName);
    await page.getByLabel('Description').fill('Created by the registration policy browser test.');
    await page.getByLabel('Date').fill(manilaDate(7));
    await page.getByLabel('Start time').fill('09:00');
    await page.getByLabel('End time').fill('10:00');
    await page.getByLabel('Cut-off time').fill('09:15');
    await page.getByLabel('Venue', { exact: true }).fill('E2E Registration Hall');

    const registration = page.getByLabel(REGISTRATION_BOX);
    const percentage = page.getByLabel(PERCENTAGE_BOX);
    await expect(registration, 'the registration control must exist and be legible').toBeVisible();
    await expect(percentage, 'the percentage control must exist and be legible').toBeVisible();

    // THE KEY ASSERTION: an administrator who never touches either box must not
    // get an event that demands registration.
    await expect(registration, 'registration is a restriction, so it defaults to OFF').not.toBeChecked();
    await page.getByRole('button', { name: /schedule event/i }).click();

    const card = page.locator('article').filter({ hasText: eventName }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const eventId = (await card.locator('span').first().textContent())?.trim() ?? '';
    expect(eventId, 'the card shows the server event id').toMatch(/^[0-9a-f-]{36}$/i);
    owned.push(eventId);

    // READ THROUGH THE SERVER, not the screen: the stored policy is what counts.
    const stored = (await (await page.request.get('/api/admin/state/')).json()).events
      .find((event: { id: string }) => event.id === eventId);
    expect(stored, 'the event must be listed for the administrator').toBeTruthy();
    expect(stored.registrationRequired, 'an untouched event must not require registration').toBe(false);
    expect(stored.requiredForAttendance, 'the percentage flag keeps its own historical default').toBe(true);

    // CREATE -> SAVE -> REOPEN: each box must show the stored value, on its own
    // control, rather than both reflecting one shared value.
    await card.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByLabel(REGISTRATION_BOX)).not.toBeChecked();
    await expect(page.getByLabel(PERCENTAGE_BOX)).toBeChecked();

    // TICK registration only, save, and reopen: the boxes must not swap.
    await page.getByLabel(REGISTRATION_BOX).check();
    await page.getByRole('button', { name: /schedule event|save event|update event/i }).click();
    await expect(card).toBeVisible({ timeout: 20_000 });

    const afterSave = (await (await page.request.get('/api/admin/state/')).json()).events
      .find((event: { id: string }) => event.id === eventId);
    expect(afterSave.registrationRequired, 'registration must now be required').toBe(true);
    expect(afterSave.requiredForAttendance, 'the percentage flag must be untouched by that change').toBe(true);

    // Reopen once more, after a FULL page load, to prove the value persisted
    // rather than merely sitting in the form's state.
    await page.reload();
    const reopened = page.locator('article').filter({ hasText: eventName }).first();
    await reopened.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByLabel(REGISTRATION_BOX)).toBeChecked();
    await expect(page.getByLabel(PERCENTAGE_BOX)).toBeChecked();
  });


  /**
   * REGRESSION: an event that requires NO registration must let a Student scan
   * and check in, and must not present a registration control at all.
   */
  test('an event needing no registration lets the student check in, and offers nothing to register for', async ({ page, context, browser }) => {
    await expectIsolatedBackend(page);
    await signIn(page, ACCOUNTS.admin, 'admin');
    const created = await adminEvent(context, {
      name: ownedEventName(OWNED_PREFIX, 'no registration needed'),
      offsetDays: 0,
      registrationRequired: false,
      requiredForAttendance: true,
    });

    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 12);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.student, 'student');

    const view = await studentView(studentPage, created.id);
    expect(view.registration_required, 'this event requires no registration').toBe(false);
    expect(view.registration_status).toBe('not_required');
    expect(view.can_check_in, 'a student may check in without registering').toBe(true);

    // Nothing to register for, so no control is offered and no badge demands it.
    await studentPage.goto('/portal?view=events');
    const card = studentCard(studentPage, created.name);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId('register-event')).toHaveCount(0);
    await expect(card.getByTestId('registration-closed-reason')).toHaveCount(0);
    await expect(card).toContainText(/Registration not required/i);

    // AND THE SCAN REALLY IS NOT REFUSED FOR REGISTRATION. Asserted as "no error
    // element exists at all" rather than "the error does not mention register":
    // a successful scan renders no error node, and asserting on its text would
    // fail on the very success it is meant to prove.
    const token = await backendIssuedToken(context, created.id);
    await openScanner(studentPage);
    await submitCode(studentPage, token);
    await expect(studentPage.getByText('Attendance recorded', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(studentPage.getByTestId('scan-error'), 'no registration refusal may be shown').toHaveCount(0);

    await student.close();
  });


  /**
   * REGRESSION: registration that is required and OPEN must offer a working
   * Register action, and afterwards report the student's status.
   */
  test('a student can register while registration is open, and is then told they are registered', async ({ page, context, browser }) => {
    await expectIsolatedBackend(page);
    await signIn(page, ACCOUNTS.admin, 'admin');
    const created = await adminEvent(context, {
      name: ownedEventName(OWNED_PREFIX, 'registration open'),
      offsetDays: 7,
      registrationRequired: true,
      requiredForAttendance: false,
    });

    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 12);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.student, 'student');

    const view = await studentView(studentPage, created.id);
    expect(view.registration_required, 'this event requires registration').toBe(true);
    expect(view.registration_status).toBe('required');
    expect(view.can_register, 'an UPCOMING event must offer the Register action').toBe(true);
    expect(view.registration_unavailable_reason).toBeNull();

    await studentPage.goto('/portal?view=events');
    const card = studentCard(studentPage, created.name);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId('register-event'), 'the Register action must be visible, not hidden').toBeVisible();
    await expect(card.getByTestId('registration-closed-reason')).toHaveCount(0);

    // The action WORKS through the real API.
    const registered = await apiWrite(student, 'post', `/api/events/${created.id}/registrations/`);
    expect([200, 201], `registering must succeed: ${registered.status()}`).toContain(registered.status());

    // Afterwards the card reports the status instead of offering it again.
    const after = await studentView(studentPage, created.id);
    expect(after.registration_status, 'the student is now registered').toBe('registered');
    expect(after.can_register, 'an existing registration is not re-offered').toBe(false);

    await studentPage.reload();
    const reloaded = studentCard(studentPage, created.name);
    await expect(reloaded.getByTestId('registration-status')).toContainText('Registered');
    await expect(reloaded.getByTestId('register-event')).toHaveCount(0);

    await student.close();
  });


  /**
   * REGRESSION: registration that is required but CLOSED must be explained.
   *
   * THE DEAD END THIS COVERS. The card rendered the Register button only when
   * `registration_required && can_register`. For an event that had already
   * started that hid the action entirely, while the badge still said
   * "Registration required" and scanning still refused with "Register for this
   * event before checking in." - a demand nothing on the screen could satisfy.
   */
  test('when registration is required but already closed, the card says why instead of hiding the action', async ({ page, context, browser }) => {
    await expectIsolatedBackend(page);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // offsetDays 0 -> a TODAY 00:00-23:59 event, which is already ONGOING.
    const created = await adminEvent(context, {
      name: ownedEventName(OWNED_PREFIX, 'registration closed'),
      offsetDays: 0,
      registrationRequired: true,
      requiredForAttendance: false,
    });

    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 12);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.student, 'student');

    const view = await studentView(studentPage, created.id);
    expect(view.status, 'the event has already started').toBe('ongoing');
    expect(view.registration_required).toBe(true);
    expect(view.can_register, 'registration cannot be opened retrospectively').toBe(false);
    expect(
      view.registration_unavailable_reason,
      'the server must say why registration is unavailable',
    ).toMatch(/already started/i);

    await studentPage.goto('/portal?view=events');
    const card = studentCard(studentPage, created.name);
    await expect(card).toBeVisible({ timeout: 20_000 });

    // The reason is SHOWN, in place of the action, rather than the action
    // silently vanishing while the badge still demands registration.
    await expect(card.getByTestId('registration-closed-reason')).toContainText(/already started/i);
    await expect(card.getByTestId('register-event')).toHaveCount(0);
    await expect(card).toContainText(/Registration required/i);

    await student.close();
  });
});

