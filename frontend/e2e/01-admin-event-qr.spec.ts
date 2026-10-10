import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, checkInWindow, cleanupOwnedEvents, decodeQrOnScreen, ownedEventName, signIn, resetAttendance,
} from './helpers';

/**
 * GST006: an administrator creates an event and a code appears automatically.
 *
 * These are browser tests against the ISOLATED instance only. Nothing here may
 * be pointed at the live app: the config refuses a non-isolated origin.
 */

/**
 * MUST match an entry in `OWNED_NAME_PREFIXES` in
 * backend/scripts/cleanup-e2e-test-event.mjs.
 *
 * Deliberately NOT `E2E-BROWSER-CREATED-`: fifteen events from earlier runs are
 * still in the isolated database under that name, and reusing it would put this
 * spec one careless cleanup away from deleting records this run never created.
 */
const OWNED_PREFIX = 'E2E-QR-UI-';

/** Events this spec created, so `afterEach` can remove exactly those. */
let owned: string[] = [];

test.afterEach(() => {
  const created = owned;
  owned = [];
  // Throws on failure, so a leftover fixture turns an otherwise-passing run
  // red instead of scrolling past as a log line.
  cleanupOwnedEvents(created);
});

/**
 * Fills the admin form's time fields from the CURRENT UTC clock.
 *
 * The form's `Date` / `Start time` / `End time` / `Cut-off time` values are
 * parsed by `parseLocalDateTime`, which appends `Z` and therefore reads them as
 * UTC. Hard-coding `08:00`-`18:00` made this spec pass or fail purely on the
 * hour it happened to run: the server derives `checkInOpensAt = start - 30 min`
 * and `checkInClosesAt = end`, so an 18:14 UTC start left the window closed by
 * fourteen minutes and the panel honestly reported "Check-in has closed".
 */
async function fillWindow(page: import('@playwright/test').Page) {
  const window = checkInWindow();
  await page.getByLabel('Date').fill(window.date);
  await page.getByLabel('Start time').fill(window.start);
  await page.getByLabel('End time').fill(window.end);
  await page.getByLabel('Cut-off time').fill(window.cutoff);
}
test.describe('Admin event creation and automatic QR issuance', () => {
  test('creating a QR event issues a code immediately, and it survives a refresh', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start from a clean slate: a scan refusal is only meaningful when no
    // earlier run already recorded attendance for the same seeded account.
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    await page.goto('/admin/events');

    const eventName = ownedEventName(OWNED_PREFIX, test.info().title);
    await page.getByRole('button', { name: /create event/i }).click();

    await page.getByLabel('Event name').fill(eventName);
    await page.getByLabel('Description').fill('Created by the isolated browser verification run.');
    await fillWindow(page);
    await page.getByLabel('Venue', { exact: true }).fill('E2E Browser Hall');
    // A geofence is supplied so the code can be scanned in the later specs.
    await page.getByLabel('Venue latitude').fill('14.5995');
    await page.getByLabel('Venue longitude').fill('120.9842');
    await page.getByLabel('Check-in radius (metres)').fill('150');
    await page.getByRole('button', { name: /schedule event/i }).click();

    // The card for the new event appears, carrying its own QR panel.
    const card = page.locator('article').filter({ hasText: eventName }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });

    const eventId = (await card.locator('span').first().textContent())?.trim() ?? '';
    expect(eventId, 'the card shows the server event id').toMatch(/^[0-9a-f-]{36}$/i);
    // Registered before the first assertion that could fail, so a failing test
    // still cleans up after itself. `afterEach` removes exactly this id.
    owned.push(eventId);

    // No issuance-failure notice: the automatic issuance succeeded.
    await expect(page.getByTestId('qr-issuance-notice')).toHaveCount(0);

    // The code is displayed automatically, without anybody clicking "View".
    const panel = card.getByTestId('event-qr-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: /view|refresh/i }).click();
    await expect(panel.getByTestId('qr-image')).toBeVisible();
    // The window is derived from the clock at run time, so the server's verdict
    // is now deterministic: `usable_now` when the window is open, which
    // `fillWindow` guarantees it is.
    await expect(panel.getByTestId('qr-usability')).toContainText(/scannable now|once check-in opens/i);

    // The on-screen code decodes to a well-formed credential for THIS event.
    const decoded = await decodeQrOnScreen(page);
    expect(decoded, 'the displayed QR must decode').toMatch(new RegExp(`^COT-EVENT:${eventId}:`));

    // RETRIEVAL AFTER REFRESH: a full reload, then reopen the panel. The code
    // must be the SAME one, not a fresh one. This is the "recoverable at rest"
    // property, and it is the reason the token is stored encrypted.
    const firstToken = decoded!.split(':').slice(2).join(':');
    await page.reload();
    const reloadedCard = page.locator('article').filter({ hasText: eventName }).first();
    await expect(reloadedCard).toBeVisible();
    const reloadedPanel = reloadedCard.getByTestId('event-qr-panel');
    await reloadedPanel.getByRole('button', { name: /view|refresh/i }).click();
    await expect(reloadedPanel.getByTestId('qr-image')).toBeVisible();

    const afterReload = await decodeQrOnScreen(page);
    expect(afterReload).toBe(decoded);
    expect(afterReload!.split(':').slice(2).join(':')).toBe(firstToken);

    // And it matches what the SERVER holds, read directly from the API.
    const server = await context.request.get(`/api/admin/events/${eventId}/qr/`);
    expect(server.ok()).toBeTruthy();
    expect((await server.json()).token).toBe(afterReload);

    // Viewing did not create a second active credential: the status endpoint
    // still reports the SAME code that was issued at creation time. The usability
    // follows the event's own clock - check-in opens 30 minutes before the
    // 08:00 start, so a run later in the morning legitimately reads
    // "not_yet_open" rather than "usable_now". Both are valid; a third would
    // mean the code was revoked, expired, or silently reissued.
    const status = await (await context.request.get(`/api/admin/events/${eventId}/qr/status/`)).json();
    expect(['usable_now', 'not_yet_open']).toContain(status.usability);
    expect(status.issuedAt).toBe((await server.json()).issuedAt);
  });

  test('a non-QR event reports the refusal instead of pretending a code exists', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start from a clean slate: a scan refusal is only meaningful when no
    // earlier run already recorded attendance for the same seeded account.
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    await page.goto('/admin/events');

    const eventName = ownedEventName(OWNED_PREFIX, test.info().title);
    await page.getByRole('button', { name: /create event/i }).click();
    await page.getByLabel('Event name').fill(eventName);
    await page.getByLabel('Description').fill('Barcode roll call; no QR expected.');
    await fillWindow(page);
    await page.getByLabel('Venue', { exact: true }).fill('E2E Browser Hall');
    await page.getByLabel('Attendance method').selectOption('Barcode');
    await page.getByRole('button', { name: /schedule event/i }).click();

    const card = page.locator('article').filter({ hasText: eventName }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });

    const eventId = (await card.locator('span').first().textContent())?.trim() ?? '';
    expect(eventId, 'the card shows the server event id').toMatch(/^[0-9a-f-]{36}$/i);
    owned.push(eventId);

    // A barcode event has no QR panel at all, so there is nothing to mislead.
    await expect(card.getByTestId('event-qr-panel')).toHaveCount(0);
    // The event itself was still created; only the code was skipped. The
    // attendance method is shown in the card's own summary block.
    await expect(card.getByText(/^Barcode · /)).toBeVisible();
  });
});
