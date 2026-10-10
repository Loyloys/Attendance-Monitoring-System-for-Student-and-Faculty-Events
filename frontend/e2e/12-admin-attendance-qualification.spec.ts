/**
 * GST008: proves the ADMIN ATTENDANCE TABLE renders the duration-qualification
 * columns from real server data, and that a Pending attendee is NOT shown as
 * Present.
 *
 * IT USES A FRESH ISOLATED EVENT created by this run, never a pre-existing
 * record: the point is to watch a NEW scan appear as Pending and then qualify,
 * and no historical attendance is reclassified to make that demonstrable.
 */
import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, OUTSIDE_FENCE, VENUE, adminContext, apiWrite, cleanupOwnedEvents,
  expectIsolatedBackend, ownScanEvent, reapplyLocation, setLocation, signIn,
} from './helpers';

const OWNED_PREFIX = 'E2E-QUAL-';

let owned: string[] = [];
test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

/**
 * A signed-in student context, with a position already asserted after navigation.
 */
async function studentAt(browser: import('@playwright/test').Browser, at = VENUE) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    permissions: ['geolocation'],
    geolocation: { ...at, accuracy: 12 },
  });
  await setLocation(context, at, 12);
  const page = await context.newPage();
  await signIn(page, ACCOUNTS.student, 'student');
  await page.goto('/portal?view=events');
  await reapplyLocation(context);
  return { context, page };
}

/**
 * Reads a fix FROM THE BROWSER, using its own `position.timestamp`.
 *
 * Never `Date.now()`: re-stamping an old reading would defeat the very
 * staleness rule these tests exist to exercise.
 */
function readFix(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Promise<{
    latitude: number; longitude: number; accuracy: number; capturedAt: string;
  }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
      (error) => reject(new Error(`geolocation failed: ${error.code}`)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }));
}

/**
 * The student's own tracking session for an event, read as that student.
 *
 * The endpoint answers `{ session: {...} | null }`, so the wrapper is unwrapped
 * here - reading the wrapper directly is why an earlier version of this helper
 * reported a session as missing even though one existed.
 *
 * Returns null when there is genuinely no session, and throws on a real error, so
 * a broken read can never be mistaken for "nothing there".
 */
async function studentRow(context: import('@playwright/test').BrowserContext, eventId: string) {
  const response = await context.request.get(`/api/attendance/session/event/${eventId}/`);
  if (!response.ok()) throw new Error(`session read failed: ${response.status()} ${await response.text()}`);
  const body = await response.json();
  const session = body?.session;
  return session && typeof session.creditedSeconds === 'number' ? session : null;
}

/**
 * INDEPENDENT persistence check.
 *
 * Deliberately does NOT reuse anything the test already asserted. It closes a
 * fresh browser page, re-reads the admin attendance table from scratch, and
 * requires the qualification, the verified time and the ended/paused state to be
 * present AGAIN. That proves the values came from the SERVER and survive a full
 * page load, rather than merely having been painted into the DOM earlier by the
 * polling refresh.
 */
/**
 * Captures the admin table with the QUALIFICATION column actually visible.
 *
 * A plain `fullPage` screenshot is not enough: the table is wider than the
 * viewport and scrolls horizontally, so the rightmost columns - qualification,
 * the reason, tracking - are cut off. Scrolling the table's own container first
 * is what puts the evidence in the picture.
 */
async function shotTable(page: import('@playwright/test').Page, name: string) {
  await page.locator('[data-testid="attendance-table"]').evaluate((table) => {
    const scroller = table.parentElement;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `../.e2e/artifacts/${name}`, fullPage: true });
}

async function rereadAdminRow(
  page: import('@playwright/test').Page,
  eventName: string,
  personId: string,
) {
  await page.reload();
  await page.locator('select').first().selectOption({ label: eventName });
  const row = page.locator('tr', { hasText: personId });
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

/** The admin page, already on the attendance tab for `eventId`. */
async function adminOnEvent(
  browser: import('@playwright/test').Browser,
  eventName: string,
) {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await expectIsolatedBackend(page);
  await page.goto('/admin/attendance');
  await page.locator('select').first().selectOption({ label: eventName });
  return { admin, page };
}



test('the admin table shows qualification columns, and a scan is Pending rather than Present', async ({ browser }) => {
  // 1. A fresh event that REQUIRES verified in-zone minutes.
  const created = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 2 });
  owned.push(created.id);

  // 2. A student checks in inside the fence.
  const student = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    permissions: ['geolocation'],
    geolocation: { ...VENUE, accuracy: 12 },
  });
  await setLocation(student, VENUE, 12);
  const page = await student.newPage();
  await signIn(page, ACCOUNTS.student, 'student');
  await page.goto('/portal?view=events');
  await reapplyLocation(student);

  // 2. A student checks in inside the fence.
  //
  // THE LOCATION IS READ FROM THE BROWSER, NOT HAND-WRITTEN. This event
  // verifies location, so the scan must carry a real fix, and the only honest
  // source is `navigator.geolocation` itself - the same call the scanner makes.
  // A hand-written coordinate would let a broken geolocation path pass.
  const fix = await page.evaluate(() => new Promise<{
    latitude: number; longitude: number; accuracy: number; capturedAt: string;
  }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        // The browser's OWN timestamp. Never Date.now(): that would make an old
        // reading look fresh and defeat the very staleness check under test.
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
      (error) => reject(new Error(`geolocation failed: ${error.code} ${error.message}`)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }));
  expect(Math.abs(fix.latitude - VENUE.latitude), 'the simulated fix must be inside the fence').toBeLessThan(0.001);

  // Written through the store's own CSRF-aware helper rather than a hand-rolled
  // fetch, so the scan faces exactly the CSRF and credential checks a real one does.
  const scanResponse = await apiWrite(student, 'post', '/api/attendance/scan/', {
    token: created.token, method: 'qr', location: fix,
  });
  expect(scanResponse.status(), `the check-in itself must succeed: ${await scanResponse.text()}`).toBe(201);
  await student.close();

  // 3. The admin opens the attendance table for that event.
  const admin = await adminContext(browser);
  const adminPage = await admin.newPage();
  await expectIsolatedBackend(adminPage);
  await adminPage.goto('/admin/attendance');

  // Select the event we just created.
  await adminPage.locator('select').first().selectOption({ label: created.name });
  const row = adminPage.locator('tr', { hasText: ACCOUNTS.student });

  await expect(row.getByTestId('cell-verified')).toHaveText('0:00');
  await expect(row.getByTestId('cell-required')).toHaveText('2 min');
  await expect(row.getByTestId('cell-qualification')).toContainText('Pending');
  // The check-in is still recorded and shown; qualification did not erase it.
  await expect(row.locator('td').nth(3)).toContainText(/Manual entry|Scan/);
  // An unqualified attendee must never be coloured/counted as Present.
  await expect(row.getByTestId('cell-qualification')).not.toContainText('Present');

  // 4. Pending is surfaced in the summary as its own number.
  await expect(adminPage.getByText('Pending duration')).toBeVisible();

  // 5. Evidence that the table on screen carries the new columns, for review.
  await shotTable(adminPage, 'admin-attendance-qualification.png');

  // The header is uppercased by CSS, and `innerText` returns the RENDERED text,
  // so the comparison is case-insensitive rather than against the source casing.
  const header = (await adminPage.getByTestId('attendance-table').locator('thead').innerText()).toLowerCase();
  for (const column of ['verified in-zone', 'required', 'progress', 'location', 'last update', 'tracking', 'qualification']) {
    expect(header, `the table must carry a "${column}" column`).toContain(column);
  }
});

/**
 * THE FULL ARC, driven through the browser on a FRESH isolated event.
 *
 * Ordered so the two independent facts are proven apart: a scan alone is PENDING;
 * an outside observation PAUSES without finalizing; enough inside time QUALIFIES.
 */
test('pending, credited, paused, then qualified - live in the admin table without a reload', async ({ browser }) => {
  // BUDGET, STATED BECAUSE IT WAS THE ACTUAL FAILURE. The global timeout in
  // playwright.config.ts is 60 s, but this arc is arithmetically incapable of
  // finishing inside it: the server credits VERIFIED PRESENCE in real time (a
  // diagnostic run showed exactly +8 credited seconds per 8 s attempt), the
  // requirement below is 1 minute, and the loop that gathers it allows up to
  // 20 attempts x 8 s = 160 s on its own - before the fixture provisioning, two
  // sign-ins, the scan, the outside-pause step, and the final fresh-page
  // persistence check. Repeated runs died at "Test timeout of 60000ms exceeded"
  // with creditedSeconds still climbing normally (0, 8, 16, 24, 32...), i.e. the
  // product was crediting correctly and the TEST's budget was impossible. This
  // raises the budget to cover the loop the test already declares it may run;
  // no assertion is weakened or removed.
  test.setTimeout(240_000);
  // A SHORT requirement so the arc completes inside one test run.
  const created = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 1 });
  owned.push(created.id);

  const { context: student, page } = await studentAt(browser);
  const scan = await apiWrite(student, 'post', '/api/attendance/scan/', {
    token: created.token, method: 'qr', location: await readFix(page),
  });
  expect(scan.status(), `check-in must succeed: ${await scan.text()}`).toBe(201);

  const { admin, page: adminPage } = await adminOnEvent(browser, created.name);
  const row = adminPage.locator('tr', { hasText: ACCOUNTS.student });

  // 1. PENDING below the requirement - never Present.
  await expect(row.getByTestId('cell-verified')).toHaveText('0:00');
  await expect(row.getByTestId('cell-required')).toHaveText('1 min');
  await expect(row.getByTestId('cell-qualification')).toContainText('Pending');
  await expect(row.getByTestId('cell-qualification')).not.toContainText('Present');

  // 2. An INSIDE observation starts tracking.
  const started = await apiWrite(student, 'post', '/api/attendance/session/', {
    token: created.token, method: 'qr', location: await readFix(page),
  });
  expect([200, 201], `tracking must start (201 = newly created, 200 = resumed): ${await started.text()}`).toContain(started.status());
  const sessionId = (await started.json()).id;

  // 3. Step OUTSIDE. Crediting stops and the session pauses, but the attendance
  //    must NOT finalize - the attendee may walk back in.
  await setLocation(student, OUTSIDE_FENCE, 12);
  await reapplyLocation(student);
  const outside = await apiWrite(student, 'patch', `/api/attendance/session/${sessionId}/`, {
    location: await readFix(page),
  });
  expect(outside.status(), `an outside observation is accepted as a pause: ${await outside.text()}`).toBe(200);
  expect((await outside.json()).locationState, 'the server records them outside the fence').toBe('outside');

  await expect(row.getByTestId('cell-qualification')).toContainText('Pending', { timeout: 30_000 });
  await expect(row.getByTestId('cell-qualification')).not.toContainText('Absent');
  await expect(row.getByTestId('cell-location')).toContainText('Outside');

  // 4. Back inside, crediting until the requirement is met.
  //
  // Each observation is a genuinely fresh browser fix, timestamped by the
  // browser itself - never a re-stamp of an old reading.
  //
  // THE 30-SECOND FRESHNESS RULE IS RESPECTED, NOT WORKED AROUND. The server
  // refuses an observation older than 30 s, so this sends on a shorter cadence
  // and tolerates that refusal: a 400 meaning "too old" is the documented
  // tracking behaviour (the real tracker pauses rather than inventing time), so
  // it is skipped and a fresh reading is taken, exactly as a device would.
  await setLocation(student, VENUE, 12);
  await reapplyLocation(student);
  let credited = 0;
  for (let attempt = 1; attempt <= 20 && credited < 60; attempt += 1) {
    await page.waitForTimeout(8_000);
    // RE-ASSERT THE POSITION BEFORE EVERY READ.
    //
    // This is the ordering this codebase already established (see `eventCard`
    // and `reapplyLocation` in helpers): a geolocation override is served to the
    // page once and then stops advancing, so its `position.timestamp` stops
    // moving. Without this the fix ages, the 30 s rule refuses every observation,
    // and no time is ever credited - which is exactly what the previous run of
    // this test showed. It supplies coordinates only; it grants no permission and
    // touches no timestamp by hand.
    await reapplyLocation(student);
    const sent = await apiWrite(student, 'patch', `/api/attendance/session/${sessionId}/`, {
      location: await readFix(page),
    });
    if (sent.status() === 200) {
      credited = (await sent.json()).creditedSeconds;
      continue;
    }
    const body = await sent.text();
    expect(sent.status(), `only a freshness refusal is tolerated here, got: ${body}`).toBe(400);
    expect(body, 'the refusal must be the freshness rule, never something else').toMatch(/within the last 30 seconds|too old/i);
  }
  expect(credited, 'enough verified time must eventually be credited').toBeGreaterThanOrEqual(60);

  // 5. QUALIFIED, shown WITHOUT any reload - the values arrive by polling, so
  //    nothing here waits for a page load.
  await expect(row.getByTestId('cell-qualification')).toContainText(/Present|Late/, { timeout: 30_000 });
  await expect(row.getByTestId('cell-qualification')).not.toContainText('Pending');
  await expect(row.getByTestId('cell-location')).toContainText('Inside');
  await expect(row.getByTestId('cell-verified')).not.toHaveText('0:00');
  // The check-in time is still shown alongside the verdict.
  await expect(row.locator('td').nth(3)).toContainText(/\d/);
  const verifiedText = (await row.getByTestId('cell-verified').innerText()).trim();

  // THE SERVER'S OWN ACCOUNT OF THE SAME FACT. Independent of the table: it is
  // the credited seconds the session endpoint reports, which is the only value
  // that may decide whether time was genuinely verified.
  const state = await studentRow(student, created.id);
  expect(state, 'the tracking session must be readable through the API').toBeTruthy();
  expect(state!.creditedSeconds, 'the server owns the credited total').toBeGreaterThanOrEqual(60);
  expect(state!.durationOutcome, 'the server agrees the requirement was met').toBe('met');

  // 6. PERSISTENCE, CHECKED INDEPENDENTLY. A fresh page load re-reads everything
  //    from the server, so this cannot pass on values the DOM merely happened to
  //    be showing earlier.
  const reread = await rereadAdminRow(adminPage, created.name, ACCOUNTS.student);
  await expect(reread.getByTestId('cell-qualification')).toContainText(/Present|Late/);
  await expect(reread.getByTestId('cell-verified')).toHaveText(verifiedText);
  expect(verifiedText, 'the persisted verified time must be real, not 0:00').not.toBe('0:00');

  await shotTable(adminPage, 'admin-attendance-qualified.png');

  await admin.close();
  await student.close();
});


/**
 * AN EARLY EXPLICIT CHECKOUT IS AN ABSENCE - the approved policy, in the browser.
 *
 * Uses the real "Check out" endpoint, so this exercises the explicit-checkout
 * branch and NOT the event-end sweep. The two are proven apart on purpose.
 */
test('checking out before the required time finalizes as Absent, keeping the check-in', async ({ browser }) => {
  const created = await ownScanEvent(browser, OWNED_PREFIX, test.info().title, { requiredAttendanceMinutes: 20 });
  owned.push(created.id);

  const { context: student, page } = await studentAt(browser);
  const scan = await apiWrite(student, 'post', '/api/attendance/scan/', {
    token: created.token, method: 'qr', location: await readFix(page),
  });
  expect(scan.status(), `check-in must succeed: ${await scan.text()}`).toBe(201);

  const started = await apiWrite(student, 'post', '/api/attendance/session/', {
    token: created.token, method: 'qr', location: await readFix(page),
  });
  expect([200, 201], 'tracking must start').toContain(started.status());
  const sessionId = (await started.json()).id;

  // An explicit checkout, far short of the 20 minutes required.
  const out = await apiWrite(student, 'post', `/api/attendance/session/${sessionId}/checkout/`);
  expect(out.status(), `checkout must be accepted: ${await out.text()}`).toBe(200);
  expect((await out.json()).state).toBe('completed');

  const { admin, page: adminPage } = await adminOnEvent(browser, created.name);
  const row = adminPage.locator('tr', { hasText: ACCOUNTS.student });

  await expect(row.getByTestId('cell-qualification')).toContainText('Absent', { timeout: 30_000 });
  await expect(row.getByTestId('cell-reason'))
    .toHaveText('Checked out before required attendance duration was met.');
  await expect(row.getByTestId('cell-tracking')).toHaveText('Ended');
  // THE CHECK-IN SURVIVES the absence: the record of arrival is not erased.
  await expect(row.locator('td').nth(3)).toContainText(/\d/);

  // INDEPENDENT PERSISTENCE CHECK: reload the whole page and confirm the absence,
  // its reason and the surviving check-in all come back from the SERVER.
  const reread = await rereadAdminRow(adminPage, created.name, ACCOUNTS.student);
  await expect(reread.getByTestId('cell-qualification')).toContainText('Absent');
  await expect(reread.getByTestId('cell-reason'))
    .toHaveText('Checked out before required attendance duration was met.');
  await expect(reread.getByTestId('cell-tracking')).toHaveText('Ended');
  await expect(reread.locator('td').nth(3)).toContainText(/\d/);

  await shotTable(adminPage, 'admin-attendance-absent.png');
  await admin.close();
  await student.close();
});

