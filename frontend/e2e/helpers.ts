import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Shared helpers for the isolated browser verification run.
 *
 * Two things are deliberately kept here rather than repeated per spec:
 *
 *  1. `decodeQrFromImage` decodes an EXPORTED image with the SAME decoder
 *     bundle the application ships (`qr-scanner`'s inlined ZXing worker). Using
 *     the app's own decoder is the point: it proves the exported PNG really
 *     carries a scannable code, not merely that a string was embedded in a
 *     data URL. No new dependency is installed for this.
 *
 *  2. Location is ALWAYS injected explicitly through Playwright, so a geofence
 *     test can never accidentally pass because a dev machine happened to be
 *     standing at the venue.
 */

export const E2E_PASSWORD = 'e2e-pass-123';
export const ACCOUNTS = {
  admin: 'E2E_ADM001',
  student: 'E2E_STU001',
  outsider: 'E2E_STU002',
  /**
   * One dedicated student per scanning spec.
   *
   * A successful check-in starts a live tracking session that holds a position
   * watch, so a second scan by the same person competes with that watch and the
   * browser's location read times out. Giving each scanning spec its own
   * account makes them independent of execution order.
   */
  scanDuplicate: 'E2E_STU003',
  scanOutsideFence: 'E2E_STU004',
  scanForged: 'E2E_STU005',
  scanTiming: 'E2E_STU006',
  scanBypass: 'E2E_STU007',
  faculty: 'E2E_FAC001',
  outsiderFaculty: 'E2E_FAC002',
} as const;

/** The seeded venue. A scan at these coordinates is inside the fence. */
export const VENUE = { latitude: 14.5995, longitude: 120.9842 };
/** ~1.7 km north of the venue: far outside the 150 m fence and its 25 m slack. */
export const OUTSIDE_FENCE = { latitude: 14.615, longitude: 120.9842 };

/**
 * A point a given number of METRES north of the venue, at the venue longitude.
 *
 * `OUTSIDE_FENCE` is ~1.7 km away, which proves the fence exists but says
 * nothing about where its EDGE is. These points sit just inside and just outside
 * 150 m, which is what actually distinguishes a strict fence (slack 0) from the
 * shipped default (slack 25, so a "150 m" venue really accepts 175 m).
 *
 * 1 degree of latitude is ~111_320 m, and the calculation is kept in one place so
 * the two points cannot drift apart from each other.
 */
export function metresNorthOfVenue(metres: number) {
  return { latitude: VENUE.latitude + (metres / 111_320), longitude: VENUE.longitude };
}

const require = createRequire(import.meta.url);

/**
 * Decodes a QR code out of an image buffer, using the decoder the application
 * itself ships. Returns the decoded string, or null when nothing decodes.
 */
export async function decodeQrFromImage(page: Page, imageBase64: string): Promise<string | null> {
  const workerPath = require.resolve('qr-scanner/qr-scanner-worker.min.js');
  const workerSource = readFileSync(workerPath, 'utf8');

  return page.evaluate(async ({ source, dataUrl }) => {
    // The shipped file is a FACTORY, not a decoder: it exports `createWorker`,
    // which spawns the real ZXing-style worker. It is imported as a module and
    // the factory is called once, which is the same thing the application's own
    // qr-scanner wrapper does - so the decode path under test is the app's.
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    const module = await import(url);
    const worker = module.createWorker();

    try {
      const image = new Image();
      image.src = dataUrl;
      await new Promise((resolve, reject) => {
        image.onload = () => resolve(undefined);
        image.onerror = () => reject(new Error('image did not load'));
      });

      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);

      return await new Promise<string | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('decode timed out')), 30_000);
        worker.onmessage = (event: MessageEvent) => {
          clearTimeout(timer);
          resolve((event.data.data as string | null) ?? null);
        };
        worker.onerror = (error: ErrorEvent) => {
          clearTimeout(timer);
          reject(new Error(`decoder error: ${error.message || 'unknown'}`));
        };
        worker.postMessage({
          type: 'decode',
          id: 1,
          data: { data: pixels.data, width: canvas.width, height: canvas.height },
        });
      });
    } finally {
      worker.postMessage({ type: 'close' });
      worker.terminate();
    }
  }, { source: workerSource, dataUrl: `data:image/png;base64,${imageBase64}` });
}

/** Decodes the QR rendered on the page itself (the on-screen code). */
export async function decodeQrOnScreen(page: Page): Promise<string | null> {
  const src = await page.getByTestId('qr-image').getAttribute('src');
  if (!src?.startsWith('data:image/png;base64,')) throw new Error('QR image is not a PNG data URL');
  return decodeQrFromImage(page, src.replace('data:image/png;base64,', ''));
}

/**
 * Signs in through the real login form, so the session, the CSRF cookie and the
 * role gate are all exercised exactly as a person would experience them.
 */
export async function signIn(page: Page, username: string, expectedRole: 'admin' | 'student' | 'faculty') {
  const path = expectedRole === 'admin'
    ? '/login/administrator'
    : expectedRole === 'faculty' ? '/login/faculty' : '/login/student';

  await page.goto(path);
  // Selected by id/role rather than by visible text: the page has BOTH a "Sign
  // In" tab and a "Sign In" submit button, so a name-based locator is ambiguous.
  await page.locator('#identifier').fill(username);
  await page.locator('#password').fill(E2E_PASSWORD);
  await page.locator('form#auth-panel-signin button[type="submit"]').click();
  await page.waitForURL(expectedRole === 'admin' ? /\/admin\// : /\/portal/, { timeout: 30_000 });
  await expect(page.getByText(/ISOLATED E2E TEST INSTANCE/i).first()).toBeVisible();
}

/**
 * The position each context was last ASKED to report, keyed by the context.
 *
 * Recorded rather than re-derived because a spec may legitimately withhold a
 * position: a denied/unavailable-location test clears the permission or never
 * sets a fix at all, and re-applying one here would quietly repair the very
 * condition that test exists to observe. Recording the intent means the
 * re-apply below is a no-op for exactly those contexts, and only those
 * contexts that asked for a position are ever corrected.
 */
const intendedPosition = new WeakMap<BrowserContext, { latitude: number; longitude: number; accuracy: number }>();

/** Puts a fresh, explicit position on the context. Never ambient. */
export async function setLocation(
  context: BrowserContext,
  coordinates: { latitude: number; longitude: number },
  accuracy = 10,
) {
  intendedPosition.set(context, { ...coordinates, accuracy });
  await context.setGeolocation({ ...coordinates, accuracy });
}

/**
 * Re-asserts a context's intended position AFTER a navigation has happened.
 *
 * WHY THIS EXISTS. The ordering that matters was measured, not assumed: a
 * geolocation override supplied at `newContext` time is served on the first
 * document, and a later `setGeolocation` issued after the page has navigated
 * is served immediately by that same page. Scanning specs navigate at least
 * twice (the sign-in redirect, then `/portal?view=attendance`), so the
 * override has to be re-asserted once the final document is in place.
 *
 * It is deliberately additive. It does not grant, clear or alter any
 * permission: `setGeolocation` only supplies coordinates, so a spec that
 * revoked the `geolocation` permission still gets `PERMISSION_DENIED`, and the
 * denied/unavailable-location coverage is unaffected by this helper.
 *
 * A context with no recorded intent is left completely untouched.
 */
export async function reapplyLocation(context: BrowserContext): Promise<void> {
  const intended = intendedPosition.get(context);
  if (!intended) return;
  await context.setGeolocation({ ...intended });
}

/** Signs in and installs a specific simulated position, in one step. */
export async function signInAt(
  page: Page,
  context: BrowserContext,
  username: string,
  role: 'admin' | 'student' | 'faculty',
  coordinates: { latitude: number; longitude: number } = VENUE,
) {
  await setLocation(context, coordinates);
  await signIn(page, username, role);
}

/** The credential the SERVER issued, read through the API rather than the UI. */
export async function backendIssuedToken(
  context: BrowserContext,
  eventId: string,
): Promise<string> {
  const response = await context.request.get(`/api/admin/events/${eventId}/qr/`);
  expect(response.ok(), 'admin QR fetch should succeed').toBeTruthy();
  return (await response.json()).token as string;
}

/** Waits for a download and returns its bytes as base64. */
export async function readDownload(page: Page, trigger: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    trigger(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('download had no path');
  return readFileSync(path).toString('base64');
}

/**
 * Pulls the image XObject(s) out of a PDF.
 *
 * jsPDF does NOT store a PNG here: it decompresses the PNG and writes the
 * pixels as a raw, UNCOMPRESSED `/DeviceRGB` byte stream, so a search for PNG
 * signatures finds nothing. This therefore reads each image dictionary for its
 * `/Width`, `/Height` and `/Length`, and takes exactly that many bytes after
 * the `stream` keyword. Getting `/Length` right is what makes the extraction
 * trustworthy: a byte-count derived from the next "endstream" would silently
 * run past the image and produce garbage that could never decode anyway.
 */
export interface PdfImage {
  width: number;
  height: number;
  /** Raw DeviceRGB bytes, 3 per pixel. */
  rgb: Buffer;
}

export function extractPdfImages(pdfBase64: string): PdfImage[] {
  const buffer = Buffer.from(pdfBase64, 'base64');
  const text = buffer.toString('latin1');
  const images: PdfImage[] = [];

  const dictionary = /\/Subtype\s*\/Image[\s\S]*?>>\s*stream/g;
  let match: RegExpExecArray | null;
  while ((match = dictionary.exec(text)) !== null) {
    const header = match[0];
    const width = Number(/\/Width\s+(\d+)/.exec(header)?.[1]);
    const height = Number(/\/Height\s+(\d+)/.exec(header)?.[1]);
    const length = Number(/\/Length\s+(\d+)/.exec(header)?.[1]);
    const start = match.index + match[0].length;
    if (!width || !height || !length) continue;

    // `start` already sits just after the "stream" keyword, before its EOL.
    let begin = start;
    if (buffer[begin] === 0x0d) begin += 1;
    if (buffer[begin] === 0x0a) begin += 1;

    // Only uncompressed raw images are handled, which is what jsPDF writes.
    if (/\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/.test(header)) continue;
    images.push({ width, height, rgb: buffer.subarray(begin, begin + length) });
  }
  return images;
}

/**
 * Decodes a raw DeviceRGB image extracted from a PDF, by handing it to the same
 * application decoder the PNG path uses. The RGB bytes are expanded to RGBA on
 * a canvas, so the decoder sees exactly what a renderer would show.
 */
export async function decodePdfImage(page: Page, image: PdfImage): Promise<string | null> {
  const workerPath = require.resolve('qr-scanner/qr-scanner-worker.min.js');
  const workerSource = readFileSync(workerPath, 'utf8');
  const rgbBase64 = image.rgb.toString('base64');

  return page.evaluate(async ({ source, width, height, data }) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    const module = await import(url);
    const worker = module.createWorker();
    try {
      const binary = atob(data);
      const rgb = new Uint8ClampedArray(binary.length);
      for (let i = 0; i < binary.length; i += 1) rgb[i] = binary.charCodeAt(i);

      // DeviceRGB (3 bytes/px) -> RGBA (4 bytes/px) for the canvas.
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let p = 0, q = 0; p < width * height; p += 1, q += 3) {
        rgba[p * 4] = rgb[q];
        rgba[p * 4 + 1] = rgb[q + 1];
        rgba[p * 4 + 2] = rgb[q + 2];
        rgba[p * 4 + 3] = 255;
      }

      return await new Promise<string | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('pdf image decode timed out')), 30_000);
        worker.onmessage = (event: MessageEvent) => {
          clearTimeout(timer);
          resolve((event.data.data as string | null) ?? null);
        };
        worker.onerror = (error: ErrorEvent) => {
          clearTimeout(timer);
          reject(new Error(`decoder error: ${error.message || 'unknown'}`));
        };
        worker.postMessage({
          type: 'decode',
          id: 1,
          data: { data: rgba, width, height },
        });
      });
    } finally {
      worker.postMessage({ type: 'close' });
      worker.terminate();
    }
  }, { source: workerSource, width: image.width, height: image.height, data: rgbBase64 });
}

/**
 * Issues a state-changing request the way the application does, WITH the CSRF
 * header the server demands.
 *
 * `context.request` shares the page's cookies but does NOT add the
 * `X-CSRFToken` header, so a bare POST is refused with 403. That refusal is
 * correct server behaviour, not a product bug, so the header is supplied here
 * rather than worked around.
 */
export async function apiWrite(
  context: BrowserContext,
  method: 'post' | 'patch' | 'delete',
  path: string,
  data?: unknown,
) {
  const health = await context.request.get('/api/health/');
  const csrfCookieName = (await health.json()).csrfCookieName as string;
  const cookies = await context.cookies();
  const token = cookies.find((cookie) => cookie.name === csrfCookieName)?.value;
  if (!token) throw new Error(`no ${csrfCookieName} cookie; the caller must be signed in`);

  return context.request[method](path, {
    headers: { 'X-CSRFToken': token },
    ...(data === undefined ? {} : { data }),
  });
}

/** Finds a seeded event by name and returns its id. */
export async function findEvent(context: BrowserContext, name: string) {
  const events = await (await context.request.get('/api/admin/events/')).json();
  const event = events.find((entry: { name: string }) => entry.name === name);
  if (!event) throw new Error(`seeded event ${name} not found`);
  return { eventId: event.id as string, event };
}

/** The admin-issued credential for a seeded event, via the admin session. */
export async function tokenFor(context: BrowserContext, name: string) {
  const { eventId } = await findEvent(context, name);
  const qr = await (await context.request.get(`/api/admin/events/${eventId}/qr/`)).json();
  return { eventId, token: qr.token as string };
}

/**
 * The event's STORED instants, read through the STUDENT-facing API.
 *
 * WHY THIS EXISTS ALONGSIDE `findEvent`. The admin serializer deliberately does
 * not expose `starts_at`: it publishes `date`/`start`/`end`, which are now
 * rendered in Asia/Manila. Asserting only those would re-run the exact round
 * trip that hid the original eight-hour bug - the form agreeing with the form.
 * `GET /api/events/` publishes the raw ISO instant, so a test can compare the
 * STORED value against an independently computed expectation and catch a
 * mis-parse that no amount of form round-tripping would reveal.
 */
export async function storedInstants(context: BrowserContext, name: string) {
  const events = await (await context.request.get('/api/events/')).json();
  const found = (events as {
    name: string; starts_at: string; ends_at: string;
    check_in_opens_at: string; check_in_closes_at: string;
  }[]).find((entry) => entry.name === name);
  if (!found) throw new Error(`event ${name} is not visible through the student API`);
  return {
    starts_at: found.starts_at,
    ends_at: found.ends_at,
    check_in_opens_at: found.check_in_opens_at,
    check_in_closes_at: found.check_in_closes_at,
  };
}

/**
 * Creates a browser context for a SECOND person (a student or faculty member)
 * with its position fixed at CONTEXT CREATION time.
 *
 * The position is passed in `newContext` rather than applied afterwards with
 * `setGeolocation` on purpose. A later override races with a page that has
 * already started watching position, and `getCurrentPosition` is then called
 * with `maximumAge: 0` - so it stalls and the app reports "taking a location
 * reading took too long" instead of the real server verdict. Creating the
 * context with the override means every reading in that context is served by
 * the same fixed position from the first call.
 */
export async function newAttendeeContext(
  browser: Browser,
  baseURL: string,
  coordinates: { latitude: number; longitude: number },
  accuracy = 10,
) {
  const context = await browser.newContext({
    baseURL,
    permissions: ['camera', 'geolocation'],
    geolocation: { ...coordinates, accuracy },
  });
  // Recorded for the same reason `setLocation` records: `openScanner` re-asserts
  // it after navigation, and it must re-assert the position THIS context asked
  // for rather than re-deriving one from global state.
  intendedPosition.set(context, { ...coordinates, accuracy });
  return context;
}

/**
 * Opens the scanner on the attendance view for a signed-in attendee.
 *
 * Accepts either entry point, because which one is rendered depends on state:
 * with no active tracking session the view offers "Open event scanner"; after a
 * successful check-in that started tracking, it offers "Scan another event".
 *
 * Any session a PREVIOUS run left behind is checked out first, so the page this
 * returns is genuinely a clean one. See `clearActiveSession` for why a restored
 * tracker would otherwise silently swallow the next scan.
 */
export async function openScanner(page: Page) {
  await clearActiveSession(page);
  await page.goto('/portal?view=attendance');
  await page.getByRole('button', { name: /open event scanner|scan another event/i }).click();
  await expect(page.getByLabel('Manual fallback')).toBeVisible();
  // Re-assert the position on the FINAL document, then let the scanner finish
  // its own location gate. Without this the submit races a fix that was never
  // served, and the app reports "Taking a location reading took too long"
  // instead of the server's real verdict.
  await reapplyLocation(page.context());
  await allowScannerLocation(page);
}

/**
 * Opens the scanner WITHOUT clearing any existing tracking session.
 *
 * This is the counterpart to `openScanner` and exists precisely so the
 * already-tracking case is exercised for real. `openScanner` deliberately ends a
 * leftover session so scanning specs start from a known state; that is correct
 * test hygiene, but on its own it would HIDE whether the product behaves well for
 * a person who genuinely still has a live session running. A spec that needs the
 * untouched behaviour must call this instead, so nothing is quietly cleaned up
 * behind it.
 */
export async function openScannerKeepingSession(page: Page) {
  await page.goto('/portal?view=attendance');
  await page.getByRole('button', { name: /open event scanner|scan another event/i }).click();
  await expect(page.getByLabel('Manual fallback')).toBeVisible();
  await reapplyLocation(page.context());
  await allowScannerLocation(page);
}

/**
 * Submits a payload through the app's real parser and waits for the server's
 * verdict. This is the same entry point the camera callback uses.
 */
export async function submitCode(page: Page, code: string) {
  await page.getByLabel('Manual fallback').fill(code);
  await page.getByRole('button', { name: /^submit$/i }).click();
}

/**
 * Asserts that the server verified the attendee's location.
 *
 * Two server-derived surfaces exist, depending on whether live tracking
 * started: the scanner's confirmation row ("Verified at venue"), or the tracker,
 * which can only read "Inside the check-in zone" because the server accepted
 * that observation. The tracker is the stronger of the two - a live server
 * verdict rather than a one-off echo.
 */
export async function expectLocationVerified(page: Page) {
  await expect(
    page.getByText('Verified at venue')
      .or(page.getByText(/inside the check-in zone/i)),
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Asserts that the PRECISION of the accepted fix is shown, not merely that a
 * location was accepted.
 *
 * This is deliberately separate from `expectLocationVerified`. A verdict such as
 * "Verified at venue" says the fence was satisfied; it says nothing about
 * whether a +/-5 m fix or a +/-95 m one was accepted. During testing the
 * reported accuracy is the number that makes a run diagnosable - it is how you
 * tell a strict run from a lenient one, and why a phone was refused for a poor
 * fix rather than for being in the wrong place.
 *
 * Both legitimate surfaces are accepted, for the same reason as above: the
 * scanner's confirmation ("Verified at venue (+/-8 m)") and the tracker
 * ("Reported accuracy +/-8 m"). The accuracy is matched as a NUMBER rather than
 * a fixed string, because it is the presence of a real, server-derived value
 * that matters - and asserting one hard-coded figure would break the moment a
 * browser reports a slightly different (equally valid) fix.
 */
export async function expectReportedAccuracyShown(page: Page) {
  await expect(
    // A "+/-<n> m" precision figure, on either surface.
    page.getByText(/[±]\s*\d+\s*m/)
      .or(page.getByText(/reported accuracy[^\d]*[±]\s*\d+\s*m/i)),
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Asserts the running instance's fence is STRICT (0 m slack).
 *
 * This is a property of the INSTANCE, not of the application, so it is read from
 * the health endpoint the same server the browser is talking to. Asserting it
 * here means a run cannot quietly pass against a lenient instance: every other
 * fence assertion in the suite would still hold, because they all sit far from
 * the boundary.
 */
export async function expectStrictFenceConfigured(page: Page) {
  const health = await (await page.request.get('/api/health/')).json();
  expect(health.locationPolicy, 'the server must publish its effective location policy').toBeTruthy();
  expect(
    health.locationPolicy.slackMeters,
    'the isolated instance must run with a 0 m fence slack, so 150 m means 150 m',
  ).toBe(0);
}

/**
 * Asserts that a check-in SUCCEEDED, accepting either of the two success
 * surfaces the app can legitimately show.
 *
 * When live tracking is enabled, a successful scan also starts a tracking
 * session and the Portal renders the tracker, so the scanner's own
 * confirmation panel is no longer the visible surface. When tracking is not
 * available for the event, the scanner's confirmation is what is shown.
 *
 * Both are success. What this deliberately does NOT accept is a failure panel:
 * the assertion is about the outcome, not about which component renders it.
 */
export async function expectAttendanceRecorded(page: Page) {
  await expect(
    page.getByText('Attendance recorded', { exact: true })
      // A paragraph label, not a heading: the tracker renders "Live attendance
      // tracking" as its caption above the event name heading.
      .or(page.getByText('Live attendance tracking', { exact: true })),
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * The authoritative check that attendance really was written, read from the
 * server rather than inferred from the screen. Used alongside the UI assertion
 * so a rendering quirk can never masquerade as a recorded check-in.
 */
export async function expectServerHasAttendance(
  page: Page,
  eventId: string,
  expectedRows: number,
) {
  await expect
    .poll(async () => {
      const mine = await (await page.request.get('/api/attendance/me/')).json();
      return mine.records.filter((row: { eventId: string }) => row.eventId === eventId).length;
    }, { timeout: 20_000 })
    .toBe(expectedRows);
}

/**
 * Removes any attendance rows a previous run left behind for these accounts.
 *
 * The scanner specs assert refusals such as "a first scan succeeds" and "a
 * duplicate is refused", which are only meaningful from a clean starting state.
 * The seeded accounts are shared across the whole run, so the state is cleared
 * through the admin API between tests rather than by re-seeding the database.
 */
export async function resetAttendance(context: BrowserContext, eventName: string) {
  const events = await (await context.request.get('/api/admin/events/')).json();
  const event = events.find((entry: { name: string }) => entry.name === eventName);
  if (!event) return;
  const state = await (await context.request.get('/api/admin/state/')).json();
  const rows = (state.attendance ?? []).filter(
    (row: { eventId: string; personId: string }) => row.eventId === event.id
      && String(row.personId).startsWith('E2E_'),
  );
  for (const row of rows) {
    // Sent WITH the CSRF header. A bare DELETE is refused with 403 by the
    // server, which would silently leave the previous run's rows in place and
    // make every "first scan" assertion fail for the wrong reason.
    await apiWrite(context, 'delete', `/api/admin/attendance/${encodeURIComponent(row.id)}/`);
  }
}

/**
 * Ends any LIVE TRACKING SESSION the signed-in attendee still holds.
 *
 * `resetAttendance` clears attendance ROWS but cannot reach a tracking session,
 * and the Portal deliberately RESTORES one on the attendee's next visit. That
 * restored tracker is not cosmetic: it holds a `watchPosition` on the same
 * geolocation source the scanner needs, so the scanner's own
 * `getCurrentPosition` can time out and the scan never reaches the server at
 * all. Because the tracker is also a legitimate success surface, the UI
 * assertion passes while nothing was recorded, so the failure only shows up
 * later as a missing server-side row.
 *
 * Checking out through the attendee's OWN session is the supported way to end
 * it, and it is a no-op when there is nothing to end. Doing it here is what
 * makes each scanning spec independent of every run that came before it.
 */
export async function clearActiveSession(page: Page) {
  const events = await (await page.request.get('/api/events/')).json();
  for (const event of events as { id: string; status: string; can_check_in: boolean }[]) {
    if (!(event.status === 'ongoing' || event.can_check_in)) continue;
    const { session } = await (await page.request.get(`/api/attendance/session/event/${event.id}/`)).json();
    if (session?.id && session.state !== 'completed') {
      await apiWrite(page.context(), 'post', `/api/attendance/session/${session.id}/checkout/`);
    }
  }
}

/**
 * Refuses to provision anything unless the stack really is the ISOLATED one.
 *
 * The suite already refuses a live URL at config load, but a provisioner writes
 * an EVENT, and an event is the kind of record that then appears in somebody's
 * real portal. So this re-checks the EFFECTIVE runtime state rather than
 * trusting the URL: it asks the running backend to name itself.
 */
export async function expectIsolatedBackend(page: Page) {
  const health = await (await page.request.get('/api/health/')).json();
  expect(
    health.deploymentLabel,
    'the backend must identify itself as the isolated test instance',
  ).toMatch(/ISOLATED E2E TEST INSTANCE/i);
  return health;
}

/**
 * The isolated MongoDB URI for provisioning and cleanup.
 *
 * The database name is checked here as well as inside the cleanup script,
 * because the check must happen BEFORE anything is written. The live database
 * name is refused by name, and the LIVE PORT is refused too: a name-only rule
 * accepts `mongodb://127.0.0.1:27017/university_attendance_e2e_test`, which
 * passes every name test while still pointing at the live mongod. Mirrors
 * backend/scripts/support/testDatabaseTarget.js, which the backend scripts use.
 */
export function isolatedMongoUri(): string {
  const uri = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27019/university_attendance_e2e_test';
  const parsed = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'mongodb://'));
  const name = parsed.pathname.replace(/^\//, '');
  if (!/(^|[_-])test([_-]|$)/i.test(name)) {
    throw new Error(`Refusing to provision or clean up: database "${name}" is not a test database.`);
  }
  if (name === 'university_attendance') {
    throw new Error('Refusing to provision or clean up: that is the LIVE database.');
  }
  // An omitted port is the driver's default, which IS the live port.
  const port = parsed.port === '' ? 27017 : Number(parsed.port);
  if (port === 27017) {
    throw new Error(
      `Refusing to provision or clean up: port ${port} is the LIVE application's MongoDB. `
      + 'These specs write data, so they may only target the isolated instance on 27019.',
    );
  }
  return uri;
}

/** A signed-in admin context, used to provision fixtures. */
export async function adminContext(browser: Browser) {
  const context = await browser.newContext();
  await signIn(await context.newPage(), ACCOUNTS.admin, 'admin');
  return context;
}

/**
 * Completes the scanner's location gate, the way a person does.
 *
 * The scanner deliberately withholds the camera until the browser has granted
 * location and produced an acceptable fix, and asks for that with an explicit
 * "Allow location and continue" action. A spec that opens the scanner and
 * submits without doing this races the fix: the submit's own location read has
 * nothing granted to resolve against and stalls until its own timeout, which
 * looks like a product failure but is only a missing permission step.
 *
 * This waits for "Location ready" rather than merely clicking, so the submit
 * that follows is never racing the fix - the difference between a deterministic
 * run and one that depends on which 15-second timer expires first.
 *
 * No-op when the gate is already satisfied, so a spec that has location ready
 * for another reason does not fail here.
 */
export async function allowScannerLocation(page: Page) {
  const allow = page.getByRole('button', { name: /allow location and continue/i });
  // No gate on screen means the scanner is already satisfied, or this context
  // deliberately has no position. Either way there is nothing to complete.
  if (!(await allow.isVisible())) return;
  await allow.click();
  // The gate is allowed to settle EITHER way. Waiting only for "Location ready"
  // would convert a deliberate permission denial - the condition the
  // denied/unavailable coverage exists to assert - into a 20 s timeout inside an
  // unrelated spec, so a visible refusal counts as settled, not as a hang.
  await expect(
    page.getByText(/location ready/i).or(page.getByTestId('scan-error')),
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Builds a check-in window that is OPEN right now and stays open with margin.
 *
 * THE FIELDS ARE THE SERVER'S, NOT OURS. The admin write contract accepts ONE
 * `date` plus `start` / `end` / `cutoff` wall-clock times, and
 * `parseLocalDateTime` reads them as UTC. All three times therefore share a
 * single calendar day: a window can never straddle UTC midnight through this
 * API, and anything that tries is either clamped or refused.
 *
 * THE SERVER DERIVES THE WINDOW. `checkInOpensAt = startsAt - 30 min` and
 * `checkInClosesAt = endsAt`, so a 00:00-23:59 UTC day opens 30 minutes before
 * its own midnight. That single fact is what makes midnight safe:
 *
 *   - the UTC day CONTAINING `now` opens at 23:30 on the PREVIOUS UTC day, so
 *     it is always already open, and it closes at 23:59 today;
 *   - the NEXT UTC day opens at 23:30 today, so it is only open once that
 *     moment has passed - and once it is, it buys a whole extra day of margin.
 *
 * So the second candidate is chosen exactly when it is genuinely open AND
 * gives more room, which is what stops a run starting at 23:5x UTC from
 * inheriting a window with minutes rather than hours left. The worst case that
 * remains - a run starting between 23:00 and 23:30 UTC - cannot be improved by
 * any single-date window at all, because 23:59 is the latest close the API can
 * express for the current UTC day; that is a property of the write contract,
 * not of the harness, and it is why the margin is verified and reported rather
 * than assumed.
 *
 * Times are UTC because that is what the server parses. Deriving them from the
 * machine's local clock would silently shift the window by the local UTC offset
 * (UTC+8 here), which is precisely how a "fixed 08:00-18:00" window ends up
 * already closed for a run that starts in the evening.
 */
export function checkInWindow(now: Date = new Date()) {
  const DAY_MS = 86_400_000;
  const OPEN_LEAD_MINUTES = 30;
  // The form's `Date` / `Start time` / `End time` fields are wall-clock
  // ASIA/MANILA, and the server parses them that way, so the day boundaries are
  // computed in Manila too. Deriving them from the UTC day - as this used to -
  // would silently move the window eight hours, which is the same class of bug
  // as the one being fixed, just in the harness: a run at 23:5x Manila would
  // pick a UTC day whose Manila window is already closed.
  //
  // Shifting `now` forward by the offset makes its UTC fields read as Manila
  // wall-clock fields; `Date.UTC(...)` of those is "Manila midnight expressed as
  // if it were UTC", so subtracting the offset again gives the real instant.
  const MANILA_OFFSET_MS = 8 * 3_600_000;
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  const dayStart = Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate()) - MANILA_OFFSET_MS;

  const todayStart = dayStart;
  const todayClose = todayStart + DAY_MS - 60_000; // 23:59 today
  const tomorrowStart = todayStart + DAY_MS;
  const tomorrowClose = tomorrowStart + DAY_MS - 60_000; // 23:59 tomorrow
  const tomorrowOpens = tomorrowStart - OPEN_LEAD_MINUTES * 60_000; // 23:30 today

  const todayMargin = todayClose - now.getTime();
  const tomorrowMargin = tomorrowClose - now.getTime();
  const useTomorrow = now.getTime() >= tomorrowOpens && tomorrowMargin > todayMargin;
  const day = useTomorrow ? tomorrowStart : todayStart;

  return {
    // The chosen day's MANILA calendar date, which is what the form wants.
    date: new Date(day + MANILA_OFFSET_MS).toISOString().slice(0, 10),
    start: '00:00',
    end: '23:59',
    // The late check-in cutoff, comfortably inside the window it belongs to.
    cutoff: '23:00',
    /** Minutes this window is guaranteed to stay open, as derived above. */
    marginMinutes: Math.round((useTomorrow ? tomorrowMargin : todayMargin) / 60_000),
    /** True when the run fell in the 23:00-23:30 UTC band the API cannot improve. */
    nearMidnight: !useTomorrow && todayMargin < 90 * 60_000,
  };
}

/**
 * Provisions ONE temporary QR event through the authenticated admin API and
 * returns its id.
 *
 * WHY A SPEC OWNS ITS EVENT. An event's check-in window is fixed at creation,
 * and once `checkInClosesAt` passes the server correctly reports
 * `can_check_in: false` and the card hides the attendance action. That is the
 * tracking-readiness rule working, but it means a spec asserting the scan
 * action starts failing the moment a fixed window elapses - which looks exactly
 * like a card regression. So the fixture is created OPEN relative to NOW, on
 * every run, and never depends on a window set up on an earlier day.
 *
 * THE SERVER OWNS THE WINDOW. There is deliberately no `startsAt`/`endsAt`/
 * `checkInOpensAt`/`checkInClosesAt` in this payload: the admin write contract
 * IGNORES those fields and derives the window from `date` + `start`/`end`/
 * `cutoff`. Sending them anyway is what let the stored window disagree with the
 * intent, so the window is expressed ONLY in the fields the server reads, and
 * `checkInWindow` derives them from the current UTC clock.
 *
 * Coordinates are the suite's own synthetic `VENUE`, labelled as synthetic. A
 * test must never be made to pass by pointing at the venue a person visits.
 *
 * `name` must be unique per run and per spec, so two workers - or a retry -
 * never share one mutable event. Use `ownedEventName`.
 */
export async function provisionQrEvent(
  context: BrowserContext,
  options: { name: string; requiredAttendanceMinutes?: number | null },
): Promise<string> {
  const window = checkInWindow();
  const created = await apiWrite(context, 'post', '/api/admin/events/', {
    name: options.name,
    description: 'Temporary fixture owned by an automated browser spec.',
    date: window.date,
    start: window.start,
    end: window.end,
    cutoff: window.cutoff,
    // The API's vocabulary. 'Approved', 'QR Code' and 'All' are the old UI's
    // words and are refused with a 400 by the write contract.
    status: 'published',
    method: 'qr',
    audience: 'all',
    // Registration is NOT required, so `can_check_in` never depends on a
    // registration row existing.
    requiredForAttendance: false,
    venue: 'Synthetic test venue (automated browser run)',
    ...(options.requiredAttendanceMinutes === undefined
      ? {}
      : { requiredAttendanceMinutes: options.requiredAttendanceMinutes }),
    // The server's real field names for the fence.
    venueLatitude: VENUE.latitude,
    venueLongitude: VENUE.longitude,
    venueRadiusMeters: 150,
    locationVerificationRequired: true,
  });

  expect(
    created.status(),
    `provisioning the fixture event failed: ${await created.text()}`,
  ).toBe(201);
  const id = String((await created.json()).id);

  // Prove the window the SERVER stored is open right now, rather than assuming
  // the fields above were honoured.
  //
  // Read from the QR STATUS endpoint, not the admin event detail: the admin
  // serializer reports the human-facing fields (date/start/end/status) and does
  // not expose the check-in window at all, so it cannot answer this question.
  const status = await (await context.request.get(`/api/admin/events/${id}/qr/status/`)).json();
  expect(status.issued, 'the normal automatic QR generation must have produced a credential').toBe(true);
  const opensAt = Date.parse(status.checkInOpensAt ?? '');
  const closesAt = Date.parse(status.checkInClosesAt ?? '');
  expect(
    Number.isFinite(opensAt) && opensAt <= Date.now(),
    `the fixture event must already be open; stored window ${status.checkInOpensAt} -> ${status.checkInClosesAt}`,
  ).toBe(true);
  expect(
    closesAt - Date.now(),
    'the fixture event must stay open with margin for a slow run; the UTC day '
    + 'containing "now" is the latest close this single-date write contract can '
    + 'express, so a run started between 23:00 and 23:30 UTC cannot do better',
  ).toBeGreaterThan(15 * 60_000);
  if (window.nearMidnight) {
    // Visible rather than silent: the run is inside the one band of the day the
    // API cannot improve, so a short margin here is expected, not a defect.
    console.warn(
      `fixture ${id}: started within 90 minutes of UTC midnight, so the window `
      + `closes in ${window.marginMinutes} min. This is the tightest margin the `
      + 'admin write contract can express; it is reported, not hidden.',
    );
  }

  return id;
}

/**
 * A fixture name that is unique per RUN, per TEST and per RETRY, and provably
 * ours.
 *
 * Uniqueness has to survive three things that really happen: two specs calling
 * this in the same millisecond, the same spec being retried inside one process,
 * and a whole second `playwright test` run against the same database. The run
 * token separates processes, the counter separates calls within one, and the
 * slug keeps the record identifiable.
 *
 * The prefix is the contract with `cleanup-e2e-test-event.mjs`: that script
 * refuses any record whose stored name does not start with a prefix it knows,
 * so this function and the script's allow-list have to be changed together.
 */
const RUN_TOKEN = (() => {
  const started = Date.now() - Math.round(process.uptime() * 1000);
  return `${started.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
})();

let ownedEventCounter = 0;

export function ownedEventName(prefix: string, testTitle: string): string {
  ownedEventCounter += 1;
  const slug = testTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${prefix}${RUN_TOKEN}-${ownedEventCounter}-${slug}`;
}

/**
 * Provisions a FRESH, uniquely owned event for one scanning test and returns
 * its id and current credential.
 *
 * WHY EACH SCANNING TEST OWNS AN EVENT INSTEAD OF SHARING A SEEDED ONE.
 * A successful scan starts a tracking session, and `startTrackingSession`
 * refuses to start when that attendee already holds a COMPLETED session for
 * the event - a real attendance rule, deliberately left intact. Checking out
 * does not help either: checkout *completes* the session, so a shared event
 * turns every leftover into a permanent blocker and the suite only passes on a
 * freshly seeded database.
 *
 * Owning the event removes the coupling entirely. A brand-new event has no
 * prior session for anybody, so the tracker starts whether this is the first
 * run, the second, or a retry. Nothing shared has to be reset: no attendance
 * rows are cleared, no shared fixture is touched, and `cleanupOwnedEvents`
 * removes the event together with every child row it accumulated.
 */
export async function ownScanEvent(
  browser: Browser,
  prefix: string,
  testTitle: string,
  options: { requiredAttendanceMinutes?: number | null } = {},
): Promise<{ id: string; token: string; name: string }> {
  // Checked at the point of the WRITE, not only at config load.
  isolatedMongoUri();
  const admin = await adminContext(browser);
  try {
    await expectIsolatedBackend(await admin.newPage());
    const name = ownedEventName(prefix, testTitle);
    const id = await provisionQrEvent(admin, {
      name,
      requiredAttendanceMinutes: options.requiredAttendanceMinutes ?? 20,
    });
    return { id, token: await backendIssuedToken(admin, id), name };
  } finally {
    await admin.close();
  }
}

/**
 * Removes every owned event a test created, and FAILS if any removal failed.
 *
 * A leftover fixture is not a cosmetic problem: it is an extra event in the
 * next run's event list, and while the counts still work today, nobody is
 * watching for them. So this reports by throwing rather than logging. Thrown
 * from `afterEach` it turns an otherwise-passing run red, which is the only
 * outcome that cannot be missed.
 *
 * It also re-throws when the test itself already failed, so a real assertion
 * failure is never hidden behind a cleanup error: both are reported, and the
 * original failure still appears in the summary.
 */
export function cleanupOwnedEvents(eventIds: readonly string[]): void {
  const failures: string[] = [];
  for (const eventId of eventIds) {
    if (!eventId) continue;
    try {
      removeTestEvent(eventId);
    } catch (error) {
      failures.push(`${eventId}: ${(error as Error).message}`);
    }
  }
  if (failures.length) {
    throw new Error(
      `cleanup of ${failures.length} test-owned event(s) FAILED, so this run is `
      + `not clean and the next run will see them: ${failures.join(' | ')}`,
    );
  }
}

/**
 * Removes one test-owned event and only the records that belong to it.
 *
 * Routed through the guarded cleanup script because the admin API has no
 * event-deletion endpoint by design - an event is cancelled, not destroyed,
 * because its attendance history is real information. The script refuses any
 * database that is not a test database, refuses any event whose stored name it
 * cannot verify as test-owned, and deletes strictly by exact event id.
 *
 * Best-effort by design: a leftover fixture must never turn a real assertion
 * failure into a confusing teardown error, so the caller decides whether to
 * report this.
 */
export function removeTestEvent(eventId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) return;
  const script = fileURLToPath(
    new URL('../../backend/scripts/cleanup-e2e-test-event.mjs', import.meta.url),
  );
  execFileSync(process.execPath, [script, '--event-id', eventId], {
    env: { ...process.env, MONGODB_URI: isolatedMongoUri() },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

