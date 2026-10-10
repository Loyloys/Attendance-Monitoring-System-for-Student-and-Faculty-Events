import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, VENUE, allowScannerLocation, cleanupOwnedEvents, newAttendeeContext, ownScanEvent, setLocation, signIn,
} from './helpers';

/**
 * REGRESSION COVERAGE for the scoped scanner's event selection.
 *
 * THE DEFECT THESE PIN. A card's "Scan attendance for this event" opens the
 * scanner scoped to one event, and the scanner also shows an event dropdown.
 * The mismatch guard used to compare the scanned code against the PINNED
 * `initialEventId` prop instead of the live dropdown value. Changing the
 * dropdown therefore did nothing to the check: a person who switched to event B
 * and scanned B's own valid code was told "That QR code belongs to a different
 * event" - a false refusal of a code that was correct for the event they had
 * just chosen.
 *
 * The guard still exists and still matters. It is what stops a scoped scanner
 * from recording attendance for the WRONG event, so these tests pin both
 * directions: the right code must get through to the normal attendance checks,
 * and a genuinely wrong code must still be refused with nothing recorded.
 *
 * Each test provisions its own events and accounts, so no test depends on
 * another's attendance, session or ordering.
 */
const OWNED_PREFIX = 'E2E-SCAN-';

let owned: string[] = [];

test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

/** Opens the scanner scoped to `eventId`, exactly as a card button does. */
async function openScopedScanner(page: import('@playwright/test').Page, eventId: string) {
  const card = page.locator(`article:has([data-testid="scan-${eventId}"])`);
  await card.getByRole('button', { name: /scan attendance for this event/i }).click();
  await expect(page.getByLabel('Manual fallback')).toBeVisible();
  await allowScannerLocation(page);
}

const submit = async (page: import('@playwright/test').Page, token: string) => {
  await page.getByLabel('Manual fallback').fill(token);
  await page.getByRole('button', { name: /^submit$/i }).click();
};

/** A signed-in attendee at the venue, with the event list open. */
async function openEventsAs(browser: import('@playwright/test').Browser, account: string) {
  const context = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
  const page = await context.newPage();
  await signIn(page, account, 'student');
  await page.goto('/portal?view=events');
  await setLocation(page.context(), VENUE);
  return { context, page };
}

/** Attendance rows this account holds for one event. */
async function rowsFor(page: import('@playwright/test').Page, eventId: string) {
  const mine = await (await page.request.get('/api/attendance/me/')).json();
  return mine.records.filter((r: { eventId: string }) => r.eventId === eventId).length;
}

/** Either success surface the app legitimately shows. */
const recorded = (page: import('@playwright/test').Page) => page
  .getByText('Attendance recorded', { exact: true })
  .or(page.getByText('Live attendance tracking', { exact: true }));


test.describe('Scoped scanner event selection', () => {
  test('selecting event A and scanning A reaches the normal attendance checks', async ({ browser }) => {
    const a = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    owned.push(a.id);

    const { context, page } = await openEventsAs(browser, ACCOUNTS.student);
    await openScopedScanner(page, a.id);

    // The scanner opened scoped to A, so the live selection really is A.
    await expect(page.locator('#scanner-event')).toHaveValue(a.id);
    await submit(page, a.token);

    // Not merely "no error": the ordinary attendance checks ran and passed.
    await expect(recorded(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('scan-error')).toHaveCount(0);
    expect(await rowsFor(page, a.id)).toBe(1);
    await context.close();
  });

  test('switching from A to B and scanning B uses the CURRENT selection', async ({ browser }) => {
    const a = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    const b = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    owned.push(a.id, b.id);

    const { context, page } = await openEventsAs(browser, ACCOUNTS.scanOutsideFence);
    await openScopedScanner(page, a.id);

    // THE REGRESSION: change the visible selection to B, then scan B's own code.
    await page.locator('#scanner-event').selectOption(b.id);
    await expect(page.locator('#scanner-event')).toHaveValue(b.id);
    await submit(page, b.token);

    await expect(recorded(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('scan-error')).toHaveCount(0);
    expect(
      await rowsFor(page, b.id),
      'the code must record against the event actually selected, not the one the scanner was opened for',
    ).toBe(1);
    await context.close();
  });

  test('selecting A and scanning B is still refused, and records nothing', async ({ browser }) => {
    const a = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    const b = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    owned.push(a.id, b.id);

    const { context, page } = await openEventsAs(browser, ACCOUNTS.scanTiming);
    await openScopedScanner(page, a.id);
    await expect(page.locator('#scanner-event')).toHaveValue(a.id);

    // Another event's genuine, server-issued code must NOT get through.
    await submit(page, b.token);
    await expect(page.getByTestId('scan-error')).toContainText(/different event/i, { timeout: 20_000 });

    // And the refusal is local: no request was made, so nothing exists.
    expect(await rowsFor(page, a.id)).toBe(0);
    expect(await rowsFor(page, b.id)).toBe(0);
    await context.close();
  });

  test('closing and reopening the scanner does not retain an unintended event', async ({ browser }) => {
    const a = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    const b = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 5 });
    owned.push(a.id, b.id);

    const { context, page } = await openEventsAs(browser, ACCOUNTS.scanBypass);
    await openScopedScanner(page, a.id);
    await expect(page.locator('#scanner-event')).toHaveValue(a.id);

    await page.getByRole('button', { name: /^close$/i }).click();
    await expect(page.getByLabel('Manual fallback')).toHaveCount(0);

    // Reopened for B, the selection must be B - not A carried over.
    await openScopedScanner(page, b.id);
    await expect(page.locator('#scanner-event')).toHaveValue(b.id);
    await context.close();
  });
});
