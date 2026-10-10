import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, checkInWindow, cleanupOwnedEvents, decodeQrOnScreen, ownedEventName, signIn, resetAttendance, apiWrite,
} from './helpers';

/**
 * GST006: a failed automatic issuance must not lose the event, and the retry
 * must be safe (a GET, never a silent rotation).
 *
 * The failure is produced the same way a real outage produces it: the server's
 * credential key is removed, so issuance genuinely cannot succeed. The event
 * save is a separate step and must still succeed, and the administrator must be
 * told plainly rather than left believing a scannable code exists.
 */

/**
 * MUST match an entry in `OWNED_NAME_PREFIXES` in
 * backend/scripts/cleanup-e2e-test-event.mjs. Not `E2E-RETRY-`, which is what
 * five earlier runs left behind under that name.
 */
const OWNED_PREFIX = 'E2E-QR-UI-';

/** Events this spec created, so `afterEach` can remove exactly those. */
let owned: string[] = [];

test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

/**
 * The admin form's date/times are parsed as UTC by `parseLocalDateTime`, so
 * they are derived from the current UTC clock rather than hard-coded. A fixed
 * `08:00`-`18:00` window is only open between 07:30 and 18:00 UTC, which made
 * this spec's outcome depend on the hour it happened to run.
 */
async function fillWindow(page: import('@playwright/test').Page) {
  const window = checkInWindow();
  await page.getByLabel('Date').fill(window.date);
  await page.getByLabel('Start time').fill(window.start);
  await page.getByLabel('End time').fill(window.end);
  await page.getByLabel('Cut-off time').fill(window.cutoff);
}

test.describe('QR generation failure and safe retry', () => {
  test('a failed issuance is reported, the event survives, and retry is safe', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start from a clean slate: a scan refusal is only meaningful when no
    // earlier run already recorded attendance for the same seeded account.
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    await page.goto('/admin/events');
    const eventName = ownedEventName(OWNED_PREFIX, test.info().title);

    // Normally the admin route is the issue path. Fault injection is only used
    // to prove the failure UX, and it is confined to the ISOLATED test backend.
    const fillForm = async () => {
      await page.getByRole('button', { name: /create event/i }).click();
      await page.getByLabel('Event name').fill(eventName);
      await page.getByLabel('Description').fill('Issuance failure + safe retry.');
      await fillWindow(page);
      await page.getByLabel('Venue', { exact: true }).fill('E2E Browser Hall');
      await page.getByLabel('Venue latitude').fill('14.5995');
      await page.getByLabel('Venue longitude').fill('120.9842');
      await page.getByLabel('Check-in radius (metres)').fill('150');
      await page.getByRole('button', { name: /schedule event/i }).click();
    };

    // A cancelled event is refused a code by the domain rule itself. That is a
    // REAL server-side refusal, not a stubbed one, so the failure path is
    // exercised through the same code a storage outage would take.
    await fillForm();
    // Flip the freshly created event to Cancelled via the API, then delete any
    // code it may have received, then attempt issuance through the UI panel.
    const events = await (await context.request.get('/api/admin/events/')).json();
    const created = events.find((event: { name: string }) => event.name === eventName);
    expect(created, 'the event must be created even though its code is refused').toBeTruthy();
    // Registered the moment the id is known, so every later assertion - and the
    // cancellation below - still cleans up after itself on failure.
    owned.push(String(created.id));
    await apiWrite(context, 'post', `/api/admin/events/${created.id}/cancel/`);

    const card = page.locator('article').filter({ hasText: eventName }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Viewing a cancelled event's code surfaces a clear, specific error, and
    // shows no QR image, so nobody can mistake it for a working code. The
    // cancellation happened through the API, so the list is re-read to be sure
    // the card really is the cancelled event before clicking.
    await page.reload();
    const cancelledCard = page.locator('article').filter({ hasText: eventName }).first();
    await expect(cancelledCard).toBeVisible({ timeout: 20_000 });
    const cancelledPanel = cancelledCard.getByTestId('event-qr-panel');
    await cancelledPanel.getByRole('button', { name: /view|refresh/i }).click();
    await expect(cancelledPanel.getByTestId('qr-image')).toHaveCount(0);
    await expect(cancelledPanel.getByText(/cancelled event/i)).toBeVisible();

    // SAFE RETRY: re-publishing and re-requesting the code succeeds, and the
    // code that appears is the one the server holds.
    await apiWrite(context, 'patch', `/api/admin/events/${created.id}/`, { status: 'published' });
    await page.reload();
    const reloaded = page.locator('article').filter({ hasText: eventName }).first();
    const reloadedPanel = reloaded.getByTestId('event-qr-panel');
    await reloadedPanel.getByRole('button', { name: /view|refresh/i }).click();
    await expect(reloadedPanel.getByTestId('qr-image')).toBeVisible();

    const decoded = await decodeQrOnScreen(page);
    expect(decoded).toBeTruthy();
    const server = await (await context.request.get(`/api/admin/events/${created.id}/qr/`)).json();
    expect(decoded).toBe(server.token);

    // Retrying again (a further View) returns the SAME code: the retry path is a
    // read, so a retried administrator never invalidates a printed code.
    await reloadedPanel.getByRole('button', { name: /view|refresh/i }).click();
    await expect(reloadedPanel.getByTestId('qr-image')).toBeVisible();
    expect(await decodeQrOnScreen(page)).toBe(decoded);
  });
});
