import { expect, test } from '@playwright/test';
import { ACCOUNTS, VENUE, resetAttendance, setLocation, signIn, tokenFor, newAttendeeContext, openScanner } from './helpers';

/**
 * REGRESSION TEST for a CONFIRMED security finding that has since been FIXED.
 *
 * The scanner's "manual fallback" box is a single field. When its contents are
 * NOT a `COT-EVENT:` payload, the frontend used to send
 * `{ eventId, identifier, method }` instead of `{ token, method }`, using the
 * method of the event selected in the UI. For a QR event that meant
 * `method: 'qr'`.
 *
 * `recordEventAttendance` then called `resolveScannedEvent(undefined, eventId,
 * user)`. With no token, that function resolved the event BY ID and never
 * consulted `attendancecodes` at all. And because `method === 'qr'`, the
 * `identifierMatchesUser` ownership check was skipped, since that check only
 * runs for non-QR methods.
 *
 * Net effect was: for any published QR event in the caller's audience,
 * submitting an arbitrary string recorded attendance with NO valid QR
 * credential involved. The geofence still applied, so this was not a location
 * bypass - it was a bypass of the event's rotating attendance credential, which
 * is the control that lets an organizer invalidate a leaked or replaced code.
 *
 * The server now requires a validated credential for a QR event, keyed on the
 * EVENT's own stored method, so an event id, an arbitrary identifier, or a
 * caller-chosen method can no longer stand in for one. This test is RETAINED as
 * the regression guard for that rule, and it passes: the request is refused and
 * no attendance row is written.
 */
test.describe('Event credential bypass probe', () => {
  test('a non-QR string must not check in to a QR event without a real code', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    const { eventId } = await tokenFor(context, 'E2E-LIVE-OPEN');

    // Sign a student in, open the scanner, and submit a value that is
    // deliberately NOT a COT-EVENT payload.
    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.scanBypass, 'student');
    await openScanner(studentPage);
    await studentPage.getByLabel('Manual fallback').fill('not-a-qr-code');
    await studentPage.getByRole('button', { name: /^submit$/i }).click();

    // Secure expectation: refused, and no attendance row created.
    await expect(studentPage.getByText('Attendance was not recorded', { exact: true }))
      .toBeVisible({ timeout: 20_000 });
    const mine = await (await studentPage.request.get('/api/attendance/me/')).json();
    expect(
      mine.records.filter((r: { eventId: string }) => r.eventId === eventId).length,
      'an arbitrary string must not record attendance for a QR event',
    ).toBe(0);

    await student.close();
  });
});
