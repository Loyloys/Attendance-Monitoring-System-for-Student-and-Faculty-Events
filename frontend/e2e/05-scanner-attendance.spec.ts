import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, VENUE, setLocation, signIn, cleanupOwnedEvents, expectAttendanceRecorded, expectLocationVerified, expectReportedAccuracyShown, expectServerHasAttendance, openScanner, submitCode, ownScanEvent, newAttendeeContext,
} from './helpers';

/**
 * MUST match an entry in `OWNED_NAME_PREFIXES` in
 * backend/scripts/cleanup-e2e-test-event.mjs.
 */
const OWNED_PREFIX = 'E2E-SCAN-';

/** Events this spec created, so `afterEach` can remove exactly those. */
let owned: string[] = [];

test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

/**
 * GST006: the existing scanner/parser, fed the generated QR, with a simulated
 * position, must record attendance.
 *
 * WHAT THIS SPEC ACTUALLY PROVES - read the labels carefully.
 *
 * EVIDENCE LEVEL A - INJECTED PAYLOAD (this spec).
 * The decoded string is typed into the scanner's own "manual fallback" field
 * and submitted. That reaches the SAME `handleScan` entry point the camera
 * callback calls, so it proves the parser, the geofenced submit, the server's
 * re-validation and the confirmation. It does NOT prove any camera behaviour.
 *
 * EVIDENCE LEVEL B - RENDERED IMAGE, DECODED (specs 01 and 03).
 * The QR PNG that the app actually renders is decoded back with the decoder the
 * app itself ships. That proves the on-screen code and the exported PNG/PDF
 * carry a real, scannable credential - still not a camera.
 *
 * EVIDENCE LEVEL C - REAL CAMERA ON A REAL PHONE: NOT COVERED HERE.
 * Chromium is launched with a SYNTHETIC camera (see playwright.config.ts) and
 * the fake video feed is never decoded by these specs. Nothing below says
 * anything about iOS Safari, autofocus, glare, a printed code, or Apple's
 * permission prompt. That is what the iPhone test is for.
 *
 * LOCATION IS SIMULATED throughout: every reading is injected through
 * Playwright, so a geofence test can never pass because the machine running it
 * happened to be standing at the venue.
 */

test.describe('Scanner, parser and geofenced attendance recording', () => {
  test('a scan inside the fence is recorded and confirmed by the server', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // This test's OWN event, provisioned open relative to now. Owning it is what
    // makes the run repeatable: a shared event would carry a completed tracking
    // session from the previous run, and the tracker would never start.
    const { id: eventId, token } = await ownScanEvent(browser, OWNED_PREFIX, test.info().title);
    owned.push(eventId);
    expect(token, 'the admin must have issued a code to scan').toMatch(/^COT-EVENT:/);

    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.student, 'student');
    await openScanner(studentPage);
    await submitCode(studentPage, token);

    // The server's confirmation is the ONLY success signal the UI will accept.
    // With live tracking enabled this also starts a tracking session, so either
    // the scanner confirmation or the tracker is the visible success surface.
    await expectAttendanceRecorded(studentPage);
    // GST004: the location verdict is server-derived, evidenced either by the
    // scanner's echo or by the live tracker's "Inside the check-in zone".
    await expectLocationVerified(studentPage);
    // The reported ACCURACY is on screen too. A verdict alone cannot tell a
    // +/-5 m fix from a +/-95 m one, so the precision is asserted separately:
    // it is what makes the strict-fence configuration observable during a run.
    await expectReportedAccuracyShown(studentPage);
    // And the SERVER agrees a row now exists, so a rendering quirk can never
    // be mistaken for a recorded check-in.
    await expectServerHasAttendance(studentPage, eventId, 1);

    await student.close();
  });

  /**
   * REQUIREMENT: a successful scan must appear in the authorized Admin list
   * WITHOUT a full-page reload.
   *
   * The admin workspace therefore performs a BOUNDED live refresh: it re-reads
   * its own state on a timer, schedules the next read only once the previous one
   * has settled (so requests never overlap), stops on unmount/navigation, and
   * leaves the already-loaded data on screen if a poll fails. A full reload
   * would satisfy a weaker version of this test, so the assertions below also
   * check that the tab never navigated away from `/admin/attendance`.
   */
  test('the recorded attendance reaches the authorized admin list without a full-page reload', async ({ page, context, browser }) => {
    // The admin page is opened and settled FIRST, so any later appearance of the
    // attendee can only come from the page updating itself.
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    const { id: eventId, token, name: eventName } = await ownScanEvent(browser, OWNED_PREFIX, test.info().title);
    owned.push(eventId);

    await page.goto('/admin/attendance');
    await expect(page.getByRole('heading', { name: /attendance management/i })).toBeVisible();
    // Select THIS test's own event explicitly, so the assertion is about this
    // event's rows rather than whatever the default selection happens to be.
    await page.locator('select').filter({ hasText: eventName }).first()
      .selectOption({ label: eventName });

    // Baseline: how many rows exist before the scan.
    const rowsBefore = await page.locator('table tbody tr').count();

    // Record the attendance in a SEPARATE context, so the admin tab is never
    // reloaded or re-navigated by the scan.
    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.outsider, 'student');
    await openScanner(studentPage);
    await submitCode(studentPage, token);
    await expectAttendanceRecorded(studentPage);

    // The admin tab must not have navigated at any point during the scan.
    expect(page.url()).toBe(`${test.info().project.use.baseURL}/admin/attendance`);

    // The new row must appear on its own, without a reload.
    await expect
      .poll(async () => page.locator('table tbody tr').count(), { timeout: 25_000 })
      .toBeGreaterThan(rowsBefore);
    // And it is the real, server-derived row rather than a placeholder.
    await expect(page.getByText('E2E Student Two').first()).toBeVisible();
    await expect(page.getByText('E2E_STU002').first()).toBeVisible();

    expect(eventId).toBeTruthy();
    await student.close();
  });
});

