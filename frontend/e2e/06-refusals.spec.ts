import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ACCOUNTS, OUTSIDE_FENCE, VENUE, metresNorthOfVenue, setLocation, signIn, resetAttendance, apiWrite, expectAttendanceRecorded, expectStrictFenceConfigured, expectServerHasAttendance, ownScanEvent, openScanner, submitCode, newAttendeeContext } from './helpers';

/**
 * The refusal rules. A green path is worthless if the rules that should block it
 * do not, so every case below is a case the server must REJECT.
 */
test.describe('Duplicate, invalid, out-of-fence, mistimed and unauthorized attempts', () => {
  /** Signs a student in at a given position and opens the scanner. */
  async function scannerAt(
    browser: Browser,
    baseURL: string,
    coordinates: { latitude: number; longitude: number },
    account: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    // The position is fixed at context creation, so every location reading this
    // person makes is served by the emulator from the very first call.
    const context = await newAttendeeContext(browser, baseURL, coordinates, 8);
    const page = await context.newPage();
    await signIn(page, account, 'student');
    // The shared opener, because the attendance view renders EITHER "Open event
    // scanner" or "Scan another event" depending on whether a tracking session
    // was restored for this account by an earlier spec.
    await openScanner(page);
    return { context, page };
  }

  /** The admin-issued credential for a seeded event, via the admin session. */
  async function tokenFor(context: BrowserContext, name: string) {
    const events = await (await context.request.get('/api/admin/events/')).json();
    const event = events.find((entry: { name: string }) => entry.name === name);
    if (!event) throw new Error(`seeded event ${name} not found`);
    return (await (await context.request.get(`/api/admin/events/${event.id}/qr/`)).json()).token as string;
  }

  /** The seeded live event's id and current credential, read via the admin API. */
  async function liveEventWithToken(context: BrowserContext) {
    const events = await (await context.request.get('/api/admin/events/')).json();
    const live = events.find((event: { name: string }) => event.name === 'E2E-LIVE-OPEN');
    if (!live) throw new Error('seeded event E2E-LIVE-OPEN not found');
    const token = await tokenFor(context, 'E2E-LIVE-OPEN');
    return { eventId: live.id as string, token };
  }

  test('a duplicate scan is refused and does not create a second row', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Use a fresh, in-window test-owned event instead of the shared fixture
    // E2E-LIVE-OPEN, whose check-in window can be closed at run time.
    const { id: eventId, token } = await ownScanEvent(browser, 'E2E-SCAN-', test.info().title);

    const first = await scannerAt(browser, test.info().project.use.baseURL!, VENUE, ACCOUNTS.scanDuplicate);
    await first.page.getByLabel('Manual fallback').fill(token);
    await first.page.getByRole('button', { name: /^submit$/i }).click();
    await expectAttendanceRecorded(first.page);

    // The SAME person scanning the SAME code again must be refused, and the UI
    // must say so rather than showing a second success. The scanner is reopened
    // from the Portal, because the first scan started a tracking session and so
    // replaced the scanner's own "Scan again" control.
    await openScanner(first.page);
    await submitCode(first.page, token);

    await expect(first.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(first.page.getByTestId('scan-error')).toContainText(/already|duplicate|recorded/i);

    // Still exactly one attendance row for that person and event.
    await expectServerHasAttendance(first.page, eventId, 1);

    await first.context.close();
  });

  test('a scan from outside the geofence is refused and no row is written', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // A fresh, in-window test-owned event: the shared fixture E2E-LIVE-OPEN's
    // check-in window can be closed at run time, which would masquerade a
    // timing refusal as a fence refusal.
    const { id: eventId, token } = await ownScanEvent(browser, 'E2E-SCAN-', test.info().title);

    // A valid, unexpired code, submitted from ~1.7 km away.
    const outside = await scannerAt(browser, test.info().project.use.baseURL!, OUTSIDE_FENCE, ACCOUNTS.scanOutsideFence);
    await outside.page.getByLabel('Manual fallback').fill(token);
    await outside.page.getByRole('button', { name: /^submit$/i }).click();

    await expect(outside.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(outside.page.getByTestId('scan-error')).toContainText(/outside the .* check-in zone|appear to be/i);

    const mine = await (await outside.page.request.get('/api/attendance/me/')).json();
    expect(mine.records.filter((r: { eventId: string }) => r.eventId === eventId).length).toBe(0);

    await outside.context.close();
  });

  /**
   * The fence EDGE, not merely its existence.
   *
   * The isolated instance runs with `LOCATION_FENCE_SLACK_METERS=0`, so "150 m"
   * means exactly 150 m. With the shipped default of 25 m the same venue would
   * accept up to 175 m, and a scan at 160 m would be recorded as PRESENT. That
   * is the whole point of the strict setting, so it is asserted here rather than
   * assumed: 148 m is accepted, 152 m is refused, and the refusal writes no row.
   *
   * The ~1.7 km case in the spec above passes under EITHER configuration, which
   * is exactly why it cannot be the only one.
   */
  test('the fence edge itself is strict: 148 m is in, 152 m is out', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Use a fresh, in-window test-owned event instead of the shared fixture
    // E2E-LIVE-OPEN, whose check-in window can be closed at run time.
    const { id: eventId, token, name: eventName } = await ownScanEvent(browser, 'E2E-SCAN-', test.info().title);

    // Prove the instance is actually strict before asserting strict behaviour.
    // Without this, a lenient instance would fail the 152 m case below for the
    // right reason by accident and the run would look like a product bug.
    await expectStrictFenceConfigured(page);

    // Just INSIDE the strict 150 m fence. 2 m of margin keeps a distance
    // calculation's rounding from deciding the outcome.
    const inside = await scannerAt(browser, test.info().project.use.baseURL!, metresNorthOfVenue(148), ACCOUNTS.scanOutsideFence);
    await inside.page.getByLabel('Manual fallback').fill(token);
    await inside.page.getByRole('button', { name: /^submit$/i }).click();
    await expect(inside.page.getByText('Attendance recorded', { exact: true })
      .or(inside.page.getByText('Live attendance tracking', { exact: true }))).toBeVisible({ timeout: 20_000 });
    await expectServerHasAttendance(inside.page, eventId, 1);
    await inside.context.close();

    // Just OUTSIDE it, but only 8 m further than the accepted point. Under the
    // shipped 25 m default BOTH of these would be accepted, so this is the
    // assertion that actually pins the configuration.
    await resetAttendance(context, eventName);
    const outside = await scannerAt(browser, test.info().project.use.baseURL!, metresNorthOfVenue(152), ACCOUNTS.scanTiming);
    await outside.page.getByLabel('Manual fallback').fill(token);
    await outside.page.getByRole('button', { name: /^submit$/i }).click();

    await expect(outside.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(outside.page.getByTestId('scan-error')).toContainText(/check-in zone|appear to be/i);
    // A refused scan leaves nothing behind.
    const mine = await (await outside.page.request.get('/api/attendance/me/')).json();
    expect(mine.records.filter((r: { eventId: string }) => r.eventId === eventId).length).toBe(0);

    await outside.context.close();
  });

  test('invalid and forged credentials are refused', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start from a clean slate: a scan refusal is only meaningful when no
    // earlier run already recorded attendance for the same seeded account.
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    const events = await (await context.request.get('/api/admin/events/')).json();
    const live = events.find((event: { name: string }) => event.name === 'E2E-LIVE-OPEN');

    const forged = await scannerAt(browser, test.info().project.use.baseURL!, VENUE, ACCOUNTS.scanForged);

    // 1. A well-formed payload carrying a token the server never issued.
    await forged.page.getByLabel('Manual fallback').fill(`COT-EVENT:${live.id}:${'A'.repeat(43)}`);
    await forged.page.getByRole('button', { name: /^submit$/i }).click();
    await expect(forged.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });

    // 2. A payload naming an event that does not exist.
    await forged.page.getByRole('button', { name: /scan again/i }).click();
    await forged.page.getByLabel('Manual fallback').fill(
      `COT-EVENT:00000000-0000-4000-8000-000000000000:${'B'.repeat(43)}`,
    );
    await forged.page.getByRole('button', { name: /^submit$/i }).click();
    await expect(forged.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });

    // NB: a value that is not a COT-EVENT payload at all is deliberately NOT
    // asserted here. That case is a QR-credential question rather than a
    // forgery question, so it is pinned separately and explicitly in
    // `07-qr-identifier-bypass.spec.ts`, which covers the manual-fallback box.

    // No attendance may exist for this event as a result of any forged payload.
    // Scoped to the event on purpose: an earlier spec legitimately records
    // attendance for the same seeded account, so a global count would be
    // measuring test ordering rather than the forgery attempt.
    const mine = await (await forged.page.request.get('/api/attendance/me/')).json();
    const forThisEvent = mine.records.filter((r: { eventId: string }) => r.eventId === live.id);
    expect(forThisEvent.length, 'no forged payload may record attendance').toBe(0);

    await forged.context.close();
  });

  test('scans before the window opens and after it closes are refused', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start from a clean slate: a scan refusal is only meaningful when no
    // earlier run already recorded attendance for the same seeded account.
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    const events = await (await context.request.get('/api/admin/events/')).json();
    const future = events.find((event: { name: string }) => event.name === 'E2E-FUTURE-WINDOW');
    const closed = events.find((event: { name: string }) => event.name === 'E2E-WINDOW-CLOSED');
    expect(future && closed, 'the timing fixtures must exist').toBeTruthy();

    // A code issued ahead of time is valid; it is simply not scannable yet.
    const futureQr = await (await context.request.get(`/api/admin/events/${future.id}/qr/`)).json();
    expect(futureQr.usability).toBe('not_yet_open');

    const student = await scannerAt(browser, test.info().project.use.baseURL!, VENUE, ACCOUNTS.scanTiming);
    await student.page.getByLabel('Manual fallback').fill(futureQr.token);
    await student.page.getByRole('button', { name: /^submit$/i }).click();
    await expect(student.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(student.page.getByTestId('scan-error')).toContainText(/check-in|not open|not yet/i);

    // A code whose window has already closed is equally refused. It is fetched
    // through the ADMIN session: a student is (correctly) refused the admin QR
    // route, so reading it from the student session would yield no token.
    //
    // POST (explicit rotation), not GET: a past-window event's credential expires
    // one hour after it was minted (`max(checkInClosesAt, issuedAt + 1h)`), and the
    // GET is idempotent - it keeps handing back that ACTIVE code even once it is
    // expired. The scan would then die on the credential check ("invalid or
    // expired") instead of reaching the window refusal this test is about.
    // Rotation is the UI's documented recovery path and leaves a LIVE credential
    // against a CLOSED window - precisely the state under test.
    const closedQr = await (await apiWrite(
      context,
      'post',
      `/api/admin/events/${closed.id}/qr/`,
    )).json();
    expect(closedQr.usability, 'live credential, closed window').toBe('window_closed');
    expect(closedQr.token, 'the closed-window event must have an issued code').toBeTruthy();
    await student.page.getByRole('button', { name: /scan again/i }).click();
    await student.page.getByLabel('Manual fallback').fill(closedQr.token);
    await student.page.getByRole('button', { name: /^submit$/i }).click();
    await expect(student.page.getByText('Attendance was not recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(student.page.getByTestId('scan-error')).toContainText(/closed|refused/i);

    await student.context.close();
  });

  test('a student cannot manage any code, and unassigned faculty cannot either', async ({ page, context, browser }) => {
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start from a clean slate: a scan refusal is only meaningful when no
    // earlier run already recorded attendance for the same seeded account.
    await resetAttendance(context, 'E2E-LIVE-OPEN');
    const events = await (await context.request.get('/api/admin/events/')).json();
    const live = events.find((event: { name: string }) => event.name === 'E2E-LIVE-OPEN');
    const baseURL = test.info().project.use.baseURL!;

    // A STUDENT is refused by role, on the read, the rotate, and the admin route.
    const student = await browser.newContext({ baseURL });
    const studentPage = await student.newPage();
    await setLocation(student, VENUE);
    await signIn(studentPage, ACCOUNTS.student, 'student');
    expect((await studentPage.request.get(`/api/events/${live.id}/check-in-code/`)).status(),
      'a student must never read a check-in code').toBe(403);
    expect((await studentPage.request.get(`/api/admin/events/${live.id}/qr/`)).status(),
      'a student must never reach the admin QR route').toBe(403);
    // The rotation POST is sent WITH a valid CSRF token, so a 403 here can only
    // come from the authorization rule and not from a missing header.
    const studentRotate = await apiWrite(student, 'post', `/api/events/${live.id}/check-in-code/`);
    expect(studentRotate.status(), 'a student must never rotate a check-in code').toBe(403);
    await student.close();

    // FACULTY who is NOT assigned to this event is refused.
    const outsider = await browser.newContext({ baseURL });
    const outsiderPage = await outsider.newPage();
    await setLocation(outsider, VENUE);
    await signIn(outsiderPage, ACCOUNTS.outsiderFaculty, 'faculty');
    expect((await outsiderPage.request.get(`/api/events/${live.id}/check-in-code/`)).status(),
      'unassigned faculty must be refused the code').toBe(400);
    expect((await apiWrite(outsider, 'post', `/api/events/${live.id}/check-in-code/`)).status(),
      'unassigned faculty must not rotate the code').toBe(400);
    await outsider.close();

    // The ASSIGNED faculty member CAN read the same code - proving the refusals
    // above are about authorization, not a broken endpoint.
    const assigned = await browser.newContext({ baseURL });
    const assignedPage = await assigned.newPage();
    await setLocation(assigned, VENUE);
    await signIn(assignedPage, ACCOUNTS.faculty, 'faculty');
    const allowed = await assignedPage.request.get(`/api/events/${live.id}/check-in-code/`);
    expect(allowed.status(), 'assigned faculty must be allowed').toBe(200);
    expect((await allowed.json()).token).toBe(await tokenFor(context, 'E2E-LIVE-OPEN'));
    await assigned.close();
  });
});
