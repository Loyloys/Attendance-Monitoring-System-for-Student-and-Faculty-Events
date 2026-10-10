import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, backendIssuedToken, decodePdfImage, decodeQrFromImage, extractPdfImages, readDownload, resetAttendance, signIn,
} from './helpers';

/**
 * GST006: the code must survive the journey to a printed page.
 *
 * The point of this spec is that exports are DECODED with the application's own
 * decoder and compared against the credential the BACKEND issued. Asserting
 * only "a file downloaded" would prove nothing: an export of a blank or wrong
 * image would pass that check.
 */
test.describe('Full screen display and PNG/PDF export', () => {
  test('full screen shows the same code, and both exports decode to the server credential', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await resetAttendance(context, 'E2E-LIVE-OPEN');

    // The seeded live event, found by name through the admin API.
    const events = await (await context.request.get('/api/admin/events/')).json();
    const live = events.find((event: { name: string }) => event.name === 'E2E-LIVE-OPEN');
    expect(live, 'the seeded live event must exist').toBeTruthy();

    await page.goto('/admin/events');
    const card = page.locator('article').filter({ hasText: 'E2E-LIVE-OPEN' }).first();
    const panel = card.getByTestId('event-qr-panel');
    await panel.getByRole('button', { name: /view|refresh/i }).click();
    await expect(panel.getByTestId('qr-image')).toBeVisible();

    const onScreen = await panel.getByTestId('qr-image').getAttribute('src');
    const serverToken = await backendIssuedToken(context, live.id);

    // FULL SCREEN enlarges the SAME image; it must not re-issue anything.
    await panel.getByTestId('qr-fullscreen').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const fullScreenSrc = await dialog.locator('img').getAttribute('src');
    expect(fullScreenSrc, 'full screen shows the identical image, not a new code').toBe(onScreen);
    await dialog.getByRole('button', { name: /^close$/i }).click();
    await expect(dialog).toBeHidden();

    // The token is unchanged by viewing and enlarging.
    expect(await backendIssuedToken(context, live.id)).toBe(serverToken);

    // PNG export: decode the downloaded bytes and compare with the server.
    const pngBase64 = await readDownload(page, () => panel.getByTestId('qr-png').click());
    const pngBuffer = Buffer.from(pngBase64, 'base64');
    // A real PNG signature, so an HTML error page cannot pass as an image.
    expect(pngBuffer.subarray(1, 4).toString('latin1')).toBe('PNG');
    const pngDecoded = await decodeQrFromImage(page, pngBase64);
    expect(pngDecoded, 'the exported PNG must decode').toBe(serverToken);

    // PDF export: pull the embedded image out of the PDF and decode that too.
    const pdfBase64 = await readDownload(page, () => panel.getByTestId('qr-pdf').click());
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    expect(pdfBuffer.subarray(0, 5).toString('latin1'), 'a real PDF header').toBe('%PDF-');

    const images = extractPdfImages(pdfBase64);
    expect(images.length, 'the PDF must actually contain the QR image').toBeGreaterThan(0);
    const pdfDecoded = await decodePdfImage(page, images[0]);
    expect(pdfDecoded, 'the QR inside the exported PDF must decode').toBe(serverToken);

    // Exporting rotated nothing.
    expect(await backendIssuedToken(context, live.id)).toBe(serverToken);
  });
});
