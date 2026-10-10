import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  ACCOUNTS, VENUE, cleanupOwnedEvents, newAttendeeContext, ownedEventName, signIn, storedInstants,
} from './helpers';

/**
 * Event times are ASIA/MANILA wall-clock, stored as the matching UTC instant.
 *
 * THE BUG THIS SPEC PINS. An administrator typed "4 Oct 2026, 5:25 PM" and the
 * API appended `Z`, storing it as 17:25Z instead of 09:25Z. Every attendee then
 * saw the event eight hours later, on the following calendar day.
 *
 * WHY A ROUND-TRIP ALONE CANNOT CATCH IT. The admin serializer sliced the stored
 * UTC string straight back into the edit form, so the form echoed back exactly
 * what had been typed while the underlying instant was wrong. The form agreed
 * with itself either way; only the Student card, which renders the real instant,
 * disagreed. These tests therefore assert three independent things - the STORED
 * instant, the ADMIN form, and the STUDENT card - against expectations computed
 * here, so all three have to agree.
 */

/** MUST match `OWNED_NAME_PREFIXES` in backend/scripts/cleanup-e2e-test-event.mjs. */
const OWNED_PREFIX = 'E2E-TZ-';

/** Events this spec created, so `afterEach` can remove exactly those. */
let owned: string[] = [];

test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

const MANILA_OFFSET_MS = 8 * 3_600_000;

/** A Manila calendar date `days` after today, as `YYYY-MM-DD`. */
function manilaDateIn(days: number): string {
  return new Date(Date.now() + MANILA_OFFSET_MS + days * 86_400_000).toISOString().slice(0, 10);
}

/** The date/time the Student card renders for a stored instant, in Manila. */
function studentDateLabel(isoInstant: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(isoInstant));
}

function studentTimeLabel(isoInstant: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(isoInstant));
}

/** Creates an event through the real Admin form at a fixed Manila wall-clock. */
async function createEventAt(
  page: Page, name: string, date: string, start: string, end: string, cutoff: string,
) {
  await page.getByRole('button', { name: /create event/i }).click();
  await page.getByLabel('Event name').fill(name);
  await page.getByLabel('Description').fill('Created by the isolated event time-zone verification run.');
  await page.getByLabel('Date').fill(date);
  await page.getByLabel('Start time').fill(start);
  await page.getByLabel('End time').fill(end);
  await page.getByLabel('Cut-off time').fill(cutoff);
  await page.getByLabel('Venue', { exact: true }).fill('E2E Browser Hall');
  await page.getByLabel('Venue latitude').fill('14.5995');
  await page.getByLabel('Venue longitude').fill('120.9842');
  await page.getByLabel('Check-in radius (metres)').fill('150');
  await page.getByRole('button', { name: /schedule event/i }).click();

  const card = page.locator('article').filter({ hasText: name }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const eventId = (await card.locator('span').first().textContent())?.trim() ?? '';
  expect(eventId, 'the card shows the server event id').toMatch(/^[0-9a-f-]{36}$/i);
  // Registered before the first assertion that could fail, so a failing test
  // still cleans up after itself.
  owned.push(eventId);
  return eventId;
}

/** Opens the Admin edit form for an event and reads its time fields back. */
async function readAdminEditForm(page: Page, name: string) {
  const card = page.locator('article').filter({ hasText: name }).first();
  await card.getByRole('button', { name: /edit/i }).first().click();
  const form = page.locator('form').filter({ has: page.getByLabel('Event name') });
  await expect(form).toBeVisible();
  return {
    form,
    date: await form.getByLabel('Date').inputValue(),
    start: await form.getByLabel('Start time').inputValue(),
    end: await form.getByLabel('End time').inputValue(),
    cutoff: await form.getByLabel('Cut-off time').inputValue(),
  };
}

/** Opens a student's event list and returns that student's card for `name`. */
async function studentCard(browser: Browser, name: string) {
  const context = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
  const page = await context.newPage();
  await signIn(page, ACCOUNTS.student, 'student');
  await page.goto('/portal?view=events');
  const card = page.locator('article').filter({ hasText: name }).first();
  await expect(card, 'the event is visible to a student').toBeVisible({ timeout: 20_000 });
  return { context, card };
}

/**
 * Reads an event's STORED instants through a real student session.
 *
 * `GET /api/events/` publishes the raw ISO instant, unlike the admin endpoint,
 * which only publishes Manila wall-clock fields. Reading the instant through the
 * same API the Student card uses is what makes the storage assertion
 * INDEPENDENT of the form round-trip that originally concealed the bug.
 */
async function readStored(browser: Browser, name: string) {
  const context = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
  try {
    const page = await context.newPage();
    await signIn(page, ACCOUNTS.student, 'student');
    return await storedInstants(context, name);
  } finally {
    await context.close();
  }
}
test.describe('Event times are Asia/Manila wall-clock', () => {
  test('create -> save -> Admin edit -> Student display all agree on the same instant', async ({ page, browser }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');

    const name = ownedEventName(OWNED_PREFIX, test.info().title);
    // A well-future date, so the event cannot drift into its own check-in window
    // mid-run and produce a second, confusing failure.
    const date = manilaDateIn(30);
    await createEventAt(page, name, date, '17:25', '18:00', '17:45');

    // 1. STORED: 17:25 MANILA is 09:25 UTC - NOT 17:25 UTC, which was the bug.
    const stored = await readStored(browser, name);
    expect(stored.starts_at, 'stored instant for a 17:25 Manila start').toBe(`${date}T09:25:00.000Z`);
    expect(stored.ends_at, 'stored instant for an 18:00 Manila end').toBe(`${date}T10:00:00.000Z`);

    // 2. ADMIN EDIT FORM: must show the same wall-clock back.
    const firstEdit = await readAdminEditForm(page, name);
    expect({ date: firstEdit.date, start: firstEdit.start, end: firstEdit.end, cutoff: firstEdit.cutoff })
      .toEqual({ date, start: '17:25', end: '18:00', cutoff: '17:45' });

    // 3. Save it back UNCHANGED, reload, re-open: no drift on a second pass.
    // The modal keeps the SAME "Schedule event" label when editing an existing
    // event, so the locator matches both create and edit.
    await firstEdit.form.getByRole('button', { name: /schedule event/i }).click();
    await page.reload();
    await expect(page.locator('article').filter({ hasText: name }).first()).toBeVisible({ timeout: 20_000 });
    const secondEdit = await readAdminEditForm(page, name);
    expect({ date: secondEdit.date, start: secondEdit.start, end: secondEdit.end, cutoff: secondEdit.cutoff },
      'the times survive a save-and-reopen with no drift')
      .toEqual({ date, start: '17:25', end: '18:00', cutoff: '17:45' });

    // 4. STUDENT CARD: renders the real instant, so it must agree with the form.
    const student = await studentCard(browser, name);
    try {
      await expect(student.card, 'student card shows the Manila date the admin typed')
        .toContainText(studentDateLabel(`${date}T09:25:00.000Z`));
      await expect(student.card, 'student card shows the Manila start time the admin typed')
        .toContainText(studentTimeLabel(`${date}T09:25:00.000Z`));
    } finally {
      await student.context.close();
    }
  });
test.describe('Event times across the midnight boundary', () => {
  test('a start just after midnight keeps its Manila day, though it is the previous UTC day', async ({ page, browser }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');

    const name = ownedEventName(OWNED_PREFIX, test.info().title);
    const date = manilaDateIn(31);
    await createEventAt(page, name, date, '00:30', '01:15', '00:50');

    // 00:30 Manila on `date` is 16:30 UTC on the PREVIOUS calendar day. This is
    // the case a naive UTC parse gets most wrong: the date rolls back, so any
    // code that compares calendar days sees the wrong one.
    const previousUtcDay = manilaDateIn(30);
    const stored = await readStored(browser, name);
    expect(stored.starts_at).toBe(`${previousUtcDay}T16:30:00.000Z`);
    expect(stored.ends_at).toBe(`${previousUtcDay}T17:15:00.000Z`);

    // The form must still show the Manila day that was typed, not the UTC one.
    const edit = await readAdminEditForm(page, name);
    expect(edit.date, 'the form keeps the typed Manila date across the UTC day boundary').toBe(date);
    expect({ start: edit.start, end: edit.end }).toEqual({ start: '00:30', end: '01:15' });

    const student = await studentCard(browser, name);
    try {
      await expect(student.card).toContainText(studentDateLabel(`${previousUtcDay}T16:30:00.000Z`));
      await expect(student.card).toContainText('00:30');
    } finally {
      await student.context.close();
    }
  });

  test('an end just before midnight is still the same UTC day', async ({ page, browser }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');

    const name = ownedEventName(OWNED_PREFIX, test.info().title);
    const date = manilaDateIn(32);
    await createEventAt(page, name, date, '22:00', '23:59', '23:30');

    const stored = await readStored(browser, name);
    expect(stored.starts_at).toBe(`${date}T14:00:00.000Z`);
    expect(stored.ends_at, '23:59 Manila is still the same UTC day').toBe(`${date}T15:59:00.000Z`);

    const edit = await readAdminEditForm(page, name);
    expect({ date: edit.date, start: edit.start, end: edit.end })
      .toEqual({ date, start: '22:00', end: '23:59' });
  });

  test('a live event is genuinely check-in-able, so the window tracks the stored instant', async ({ page, browser }) => {
    // The functional consequence of getting the zone wrong. Stored eight hours
    // off, `checkInOpensAt = start - 30 min` lands in the future and the server
    // correctly refuses check-in. That refusal is a protection that must be
    // preserved, so this asserts the OPEN side of it rather than bypassing it.
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');

    const now = new Date();
    const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
    const date = manilaNow.toISOString().slice(0, 10);
    const nowMinutes = manilaNow.getUTCHours() * 60 + manilaNow.getUTCMinutes();
    const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    const start = Math.max(0, nowMinutes - 30);
    const end = Math.min(23 * 60 + 59, nowMinutes + 30);

    const name = ownedEventName(OWNED_PREFIX, test.info().title);
    await createEventAt(page, name, date, clock(start), clock(end), clock(Math.min(end, nowMinutes)));

    const stored = await readStored(browser, name);
    const driftMinutes = Math.abs(new Date(stored.starts_at).getTime() - now.getTime()) / 60_000;
    expect(driftMinutes, 'the stored start really is now, in Manila').toBeLessThan(31);

    // The SERVER owns the attendance window, and these are its own published
    // boundaries. Stored eight hours out, `check_in_opens_at` would sit in the
    // future and this window would NOT contain now - which is the protection
    // that must be preserved, asserted from the API rather than the screen.
    // `can_check_in` is deliberately not used: it also folds in registration
    // state, so it would measure the fixture rather than the clock.
    expect(
      new Date(stored.check_in_opens_at).getTime(),
      'check-in opens exactly 30 minutes before the stored start',
    ).toBe(new Date(stored.starts_at).getTime() - 30 * 60_000);
    expect(
      new Date(stored.check_in_closes_at).getTime(),
      'check-in closes exactly when the event ends',
    ).toBe(new Date(stored.ends_at).getTime());
    expect(
      now.getTime(),
      'the server-published attendance window really does contain now',
    ).toBeGreaterThanOrEqual(new Date(stored.check_in_opens_at).getTime());
    expect(
      now.getTime(),
      'the server-published attendance window really does contain now',
    ).toBeLessThanOrEqual(new Date(stored.check_in_closes_at).getTime());
  });
});
});