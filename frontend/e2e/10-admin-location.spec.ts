import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, cleanupOwnedEvents, ownedEventName, reapplyLocation, setLocation,
} from './helpers';

/**
 * GST004 "Use my current location" in the Administrator's event form.
 *
 * WHAT IS ACTUALLY VERIFIED HERE - AND WHAT IS NOT.
 *
 * LOCATION IS SIMULATED. Every reading in this file comes from Playwright's
 * geolocation emulator, so these tests prove the FORM's behaviour: that a
 * reading is requested only on demand, that it is shown for confirmation before
 * anything is written, that quality limits are enforced, that failures change
 * nothing, and that nothing reaches the database before an explicit save.
 *
 * THEY DO NOT VERIFY REAL GPS. No physical device was used, so nothing here
 * says anything about a real phone's fix quality, indoor accuracy, or a real
 * browser permission prompt on iOS or Android.
 *
 * The denied/unavailable/timeout cases are produced by making the browser
 * return that error, not by a person refusing a real prompt.
 */
const OWNED_PREFIX = 'E2E-SCAN-';
const VENUE_NAME = 'BukSU Main Campus \u2014 campus-area test';

let owned: string[] = [];
test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

/**
 * An admin session on the Events section, with geolocation granted.
 *
 * GEOLOCATION IS RE-ASSERTED AFTER NAVIGATION, and this is not cosmetic.
 *
 * `adminEvents` navigates at least twice (the sign-in redirect, then
 * `/admin/events`). Measured on this machine rather than assumed: a geolocation
 * override supplied at `newContext` time is served on the FIRST document but is
 * not served once the page has navigated - `getCurrentPosition` then stalls for
 * its full 15 s and the app reports "Taking a location reading took too long",
 * so `use-my-location-review` never appears.
 *
 * That is a harness artefact with nothing to do with the behaviour under test,
 * and it is intermittent: the reading is usually still warm from the login page,
 * so the suite passes and then fails on a later run with no code change. Same
 * reasoning as `eventCard.spec.ts` and `reapplyLocation` in helpers.ts.
 *
 * The fix is `setLocation` before signing in (which records the context's
 * intended position) followed by `reapplyLocation` once the final document is
 * in place. It grants, clears and alters NO permission and removes NO
 * assertion, so the denial/unavailable/timeout coverage in this file is
 * unaffected: those tests install their own geolocation stub and never reach
 * here with an intended position.
 */
async function adminEvents(context: import('@playwright/test').BrowserContext) {
  const page = await context.newPage();
  await page.goto('/login/administrator');
  await page.locator('#identifier').fill(ACCOUNTS.admin);
  await page.locator('#password').fill('e2e-pass-123');
  await page.locator('form#auth-panel-signin button[type="submit"]').click();
  await page.waitForURL(/\/admin\//, { timeout: 30_000 });
  await page.goto('/admin/events');
  await reapplyLocation(context);
  return page;
}

/**
 * An admin context reporting a FIXED position, ready for `adminEvents`.
 *
 * `setLocation` is called once here so the position is recorded as this
 * context's intent; `adminEvents` then re-asserts it after its navigations.
 * Creating the context with the same coordinates as well is deliberate: it means
 * the FIRST document reports the right fix too, so a reading requested before
 * the re-assert cannot come back as somewhere else.
 */
const adminContextAt = async (
  browser: import('@playwright/test').Browser,
  fix: { latitude: number; longitude: number; accuracy: number },
) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    permissions: ['geolocation'],
    geolocation: fix,
  });
  // `accuracy` is passed as its own argument on purpose. `setLocation` takes
  // `coordinates` and `accuracy` SEPARATELY, with accuracy defaulting to 10, so
  // handing it the whole fix object would silently reset every accuracy to 10
  // and quietly destroy the poor-reading coverage below.
  await setLocation(context, { latitude: fix.latitude, longitude: fix.longitude }, fix.accuracy);
  return context;
};

const openCreate = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /create event/i }).first().click();
  await page.getByTestId('use-my-location-button').waitFor({ state: 'visible', timeout: 15_000 });
};

test.describe('Administrator: use my current location', () => {
  test('a reading is requested only on click, then confirmed before it is applied', async ({ browser }) => {
    const context = await adminContextAt(browser, { latitude: 8.15629, longitude: 125.12395, accuracy: 12 });
    const page = await adminEvents(context);
    await openCreate(page);

    // NOTHING is requested by merely opening the form: no panel, no reading.
    await expect(page.getByTestId('use-my-location')).toBeVisible();
    await expect(page.getByTestId('use-my-location-review')).toHaveCount(0);
    await expect(page.getByTestId('use-my-location-error')).toHaveCount(0);
    await expect(page.getByTestId('venue-latitude')).toHaveValue('');

    await page.getByTestId('use-my-location-button').click();

    // Shown for review - latitude, longitude AND accuracy - and NOT yet applied.
    await expect(page.getByTestId('use-my-location-review')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('detected-latitude')).toHaveText('8.15629');
    await expect(page.getByTestId('detected-longitude')).toHaveText('125.12395');
    await expect(page.getByTestId('detected-accuracy')).toHaveText(/\u00b1\d+ m/);
    // Confirmation is required: the form is untouched until Apply is pressed.
    await expect(page.getByTestId('venue-latitude')).toHaveValue('');

    await page.getByTestId('apply-detected-location').click();
    await expect(page.getByTestId('venue-latitude')).toHaveValue('8.15629');
    await expect(page.getByTestId('venue-longitude')).toHaveValue('125.12395');
    // And the panel closes: the reading is not silently re-applied later.
    await expect(page.getByTestId('use-my-location-review')).toHaveCount(0);
    await context.close();
  });


  test('the radius and required minutes are never inferred from a device fix', async ({ browser }) => {
    const context = await adminContextAt(browser, { latitude: 1.5, longitude: 2.5, accuracy: 20 });
    const page = await adminEvents(context);
    await openCreate(page);

    // The administrator sets the venue size and the attendance rule first.
    await page.getByTestId('venue-radius').fill('275');
    await page.getByLabel('Required in-zone minutes (live tracking)').fill('45');

    await page.getByTestId('use-my-location-button').click();
    await expect(page.getByTestId('use-my-location-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('apply-detected-location').click();

    await expect(page.getByTestId('venue-latitude')).toHaveValue('1.5');
    await expect(page.getByTestId('venue-longitude')).toHaveValue('2.5');
    // A device cannot know how big a building is: these are left untouched.
    await expect(page.getByTestId('venue-radius')).toHaveValue('275');
    await expect(page.getByLabel('Required in-zone minutes (live tracking)')).toHaveValue('45');
    await context.close();
  });

  test('a zero coordinate is a real coordinate and survives', async ({ browser }) => {
    // The equator and prime meridian. A truthiness check would silently drop
    // these, so this pins that 0 is a value, not "empty".
    const context = await adminContextAt(browser, { latitude: 0, longitude: 0, accuracy: 5 });
    const page = await adminEvents(context);
    await openCreate(page);

    await page.getByTestId('use-my-location-button').click();
    await expect(page.getByTestId('use-my-location-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('apply-detected-location').click();

    await expect(page.getByTestId('venue-latitude')).toHaveValue('0');
    await expect(page.getByTestId('venue-longitude')).toHaveValue('0');
    await context.close();
  });

  test('cancelling leaves the form exactly as it was', async ({ browser }) => {
    const context = await adminContextAt(browser, { latitude: 9.9, longitude: 8.8, accuracy: 15 });
    const page = await adminEvents(context);
    await openCreate(page);

    await page.getByTestId('venue-latitude').fill('14.5995');
    await page.getByTestId('venue-longitude').fill('120.9842');

    await page.getByTestId('use-my-location-button').click();
    await expect(page.getByTestId('use-my-location-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('cancel-detected-location').click();

    // Cancelling changes nothing that was already typed.
    await expect(page.getByTestId('venue-latitude')).toHaveValue('14.5995');
    await expect(page.getByTestId('venue-longitude')).toHaveValue('120.9842');
    await expect(page.getByTestId('use-my-location-review')).toHaveCount(0);
    await context.close();
  });

  test('a poor reading is refused with an actionable message and changes nothing', async ({ browser }) => {
    // The isolated instance publishes maxAccuracyMeters = 100. A 5000 m fix is
    // far worse, so the SAME policy a real check-in applies must refuse it here.
    const context = await adminContextAt(browser, { latitude: 3.3, longitude: 4.4, accuracy: 5000 });
    const page = await adminEvents(context);
    await openCreate(page);

    await page.getByTestId('venue-latitude').fill('11.1111');
    await page.getByTestId('use-my-location-button').click();

    const error = page.getByTestId('use-my-location-error');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText(/accurate to about 5000 m/i);
    await expect(error).toContainText(/100 m or better/i);
    // Actionable: a retry is offered.
    await expect(page.getByTestId('use-my-location-retry')).toBeVisible();
    // No reading is offered for confirmation, and the form is untouched.
    await expect(page.getByTestId('use-my-location-review')).toHaveCount(0);
    await expect(page.getByTestId('venue-latitude')).toHaveValue('11.1111');
    await context.close();
  });

  test('a denied permission is reported and changes nothing', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      permissions: ['geolocation'],
    });
    // Drives OUR denial handling via a real PERMISSION_DENIED callback. See
    // stubGeolocationError for why revoking the permission is not equivalent.
    await stubGeolocationError(context, 1);
    const page = await adminEvents(context);
    await openCreate(page);
    await page.getByTestId('venue-latitude').fill('22.2222');

    await page.getByTestId('use-my-location-button').click();
    await expect(page.getByTestId('use-my-location-error')).toContainText(/permission/i, { timeout: 20_000 });
    // A denial must be reported as a PERMISSION problem, not as a timeout: the
    // user needs to know to change a browser setting, not to move outdoors.
    await expect(page.getByTestId('use-my-location-error')).not.toContainText(/too long/i);
    // Nothing is offered for confirmation and the form is left exactly as typed.
    await expect(page.getByTestId('use-my-location-review')).toHaveCount(0);
    await expect(page.getByTestId('venue-latitude')).toHaveValue('22.2222');
    await context.close();
  });

  test('an unavailable fix and a timeout are reported distinctly', async ({ browser }) => {
    // Driven through the same helper the real device uses, by stubbing the
    // browser API to return each failure. This exercises OUR handling of the
    // error, not a real device's inability to produce a fix.
    for (const [code, expected] of [[2, /unavailable/i], [3, /too long/i]] as const) {
      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, permissions: ['geolocation'] });
      await context.addInitScript((errorCode) => {
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: {
            getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) => {
              fail?.({ code: errorCode, message: 'stubbed', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as unknown as GeolocationPositionError);
            },
            watchPosition: () => 0,
            clearWatch: () => undefined,
          },
        });
      }, code);
      const page = await adminEvents(context);
      await openCreate(page);
      await page.getByTestId('venue-latitude').fill('33.3333');
      await page.getByTestId('use-my-location-button').click();
      await expect(page.getByTestId('use-my-location-error')).toContainText(expected, { timeout: 20_000 });
      await expect(page.getByTestId('venue-latitude')).toHaveValue('33.3333');
      await context.close();
    }
  });
});


/**
 * Makes the browser's geolocation API fail with a SPECIFIC error code.
 *
 * WHY THIS EXISTS INSTEAD OF `context.grantPermissions([])`. Revoking the
 * permission through Playwright does not produce a `PERMISSION_DENIED` callback
 * in headless Chromium - the call simply hangs until the app's own timeout fires,
 * so the test saw a TIMEOUT message and failed. That tested Chrome's behaviour,
 * not ours.
 *
 * Stubbing the API to call back with code 1 exercises OUR handling of an actual
 * denial, which is the thing that can regress. It does not simulate a real
 * device's refusal to grant, and does not claim to.
 */
const stubGeolocationError = (
  context: import('@playwright/test').BrowserContext,
  code: 1 | 2 | 3,
) => context.addInitScript((errorCode) => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) => {
        fail?.({
          code: errorCode,
          message: 'stubbed',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as unknown as GeolocationPositionError);
      },
      watchPosition: () => 0,
      clearWatch: () => undefined,
    },
  });
}, code);

/**
 * The event form's own Cancel button.
 *
 * Scoped to the dialog on purpose: the admin events screen renders a Cancel
 * button on EVERY event card, so an unscoped `getByRole('button', {name:/cancel/})`
 * matches six elements and Playwright refuses the click under strict mode. The
 * meaningful assertion is which dialog was dismissed, so the locator names it.
 */
const eventFormCancel = (page: import('@playwright/test').Page) =>
  page.locator('form').filter({ has: page.getByLabel('Event name') })
    .getByRole('button', { name: /^cancel$/i });

/**
 * Installs a geolocation whose success callback the TEST holds, so a reading can
 * be left in flight while the administrator does something else and only then
 * delivered. That is the only honest way to prove a late result cannot land.
 */
const holdTheReading = (context: import('@playwright/test').BrowserContext, fix: { latitude: number; longitude: number; accuracy: number }) =>
  context.addInitScript((held) => {
    const w = window as unknown as { __releaseFix?: () => void };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) => { w.__releaseFix = () => ok({ coords: { ...held }, timestamp: Date.now() } as GeolocationPosition); },
        watchPosition: () => 0,
        clearWatch: () => undefined,
      },
    });
  }, fix);

const releaseTheReading = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const w = window as unknown as { __releaseFix?: () => void };
  w.__releaseFix?.();
});


test.describe('Administrator: a late reading must never overwrite the form', () => {
  test('closing the form discards a reading that arrives afterwards', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, permissions: ['geolocation'] });
    await holdTheReading(context, { latitude: 7.77, longitude: 7.77, accuracy: 10 });
    const page = await adminEvents(context);
    await openCreate(page);

    // Start a reading, then close the form while it is still in flight.
    await page.getByTestId('use-my-location-button').click();
    await eventFormCancel(page).click();
    await expect(page.getByTestId('use-my-location-button')).toHaveCount(0);

    // Only NOW does the device answer.
    await releaseTheReading(page);
    await page.waitForTimeout(500);

    // Saving the event proves the late reading never reached the form: had it
    // been applied, the event would have persisted 7.77.
    const eventName = ownedEventName(OWNED_PREFIX, test.info().title);
    await openCreate(page);
    await page.getByLabel('Event name').fill(eventName);
    await page.getByLabel('Description').fill('Late reading must not be applied after the form closed.');
    await page.getByLabel('Date').fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel('Start time').fill('00:00');
    await page.getByLabel('End time').fill('23:59');
    await page.getByLabel('Cut-off time').fill('23:00');
    await page.getByLabel('Venue', { exact: true }).fill(eventName);
    await page.getByLabel('Department / group').fill('College of Technologies');
    await page.getByLabel('ID / barcode range or attendance group').fill('All active attendees');
    await expect(page.getByTestId('venue-latitude')).toHaveValue('');
    await page.getByRole('button', { name: /schedule event/i }).click();

    const card = page.locator('article').filter({ hasText: eventName }).first();
    await card.waitFor({ state: 'visible', timeout: 20_000 });
    const eventId = (await card.locator('span').first().textContent())?.trim() ?? '';
    owned.push(eventId);
    const saved = await (await page.request.get(`/api/admin/events/${eventId}/`)).json();
    expect(saved.venueLatitude, 'a reading delivered after the form closed must never be applied').toBeFalsy();
    await context.close();
  });

  test('choosing another venue wins over a reading already in flight', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, permissions: ['geolocation'] });
    await holdTheReading(context, { latitude: 1.11, longitude: 2.22, accuracy: 10 });
    const page = await adminEvents(context);
    const preset = (await (await page.request.get('/api/admin/venues/')).json())[0];
    expect(preset, 'the isolated instance must have a saved venue').toBeTruthy();

    await openCreate(page);
    await page.getByTestId('use-my-location-button').click(); // in flight
    // The administrator switches to the saved venue before it arrives.
    await page.getByTestId('saved-venue-select').selectOption(preset.id);
    await expect(page.getByTestId('venue-latitude')).toHaveValue(String(preset.latitude));

    await releaseTheReading(page);
    await page.waitForTimeout(500);

    // The saved venue's coordinates still stand, and no review panel was left
    // behind by the superseded request.
    await expect(page.getByTestId('venue-latitude')).toHaveValue(String(preset.latitude));
    await expect(page.getByTestId('venue-longitude')).toHaveValue(String(preset.longitude));
    await expect(page.getByTestId('use-my-location-review')).toHaveCount(0);
    await expect(page.getByTestId('use-my-location-error')).toHaveCount(0);
    await context.close();
  });
});
test.describe('Administrator: location, persistence and saved venues', () => {
  test('nothing is written until saving, and a confirmed location then survives a reopen', async ({ browser }) => {
    const context = await adminContextAt(browser, { latitude: 7.77061, longitude: 125.28505, accuracy: 18 });
    const page = await adminEvents(context);

    const before = await (await page.request.get('/api/admin/events/')).json();
    const beforeCount = before.length;

    await openCreate(page);
    const eventName = ownedEventName(OWNED_PREFIX, test.info().title);

    // Detect and confirm.
    await page.getByTestId('use-my-location-button').click();
    await expect(page.getByTestId('use-my-location-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('apply-detected-location').click();
    await expect(page.getByTestId('venue-latitude')).toHaveValue('7.77061');

    // NO WRITE. Confirming a location is a form edit, not a save.
    const midway = await (await page.request.get('/api/admin/events/')).json();
    expect(midway.length, 'detecting/applying a location must not create an event').toBe(beforeCount);

    await page.getByLabel('Event name').fill(eventName);
    await page.getByLabel('Description').fill('Saved with an administrator-confirmed device location.');
    await page.getByLabel('Date').fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel('Start time').fill('00:00');
    await page.getByLabel('End time').fill('23:59');
    await page.getByLabel('Cut-off time').fill('23:00');
    await page.getByLabel('Venue', { exact: true }).fill(eventName);
    await page.getByLabel('Department / group').fill('College of Technologies');
    await page.getByLabel('ID / barcode range or attendance group').fill('All active attendees');
    await page.getByTestId('venue-radius').fill('150');
    await page.getByRole('button', { name: /schedule event/i }).click();

    const card = page.locator('article').filter({ hasText: eventName }).first();
    await card.waitFor({ state: 'visible', timeout: 20_000 });
    const eventId = (await card.locator('span').first().textContent())?.trim() ?? '';
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i);
    owned.push(eventId);

    // The stored event really carries the confirmed coordinates.
    const saved = await (await page.request.get(`/api/admin/events/${eventId}/`)).json();
    expect(saved.venueLatitude).toBe(7.77061);
    expect(saved.venueLongitude).toBe(125.28505);
    expect(saved.venueRadiusMeters).toBe(150);

    // Reopening the event shows the same coordinates: editing the form did not
    // need saving to be kept, and the persisted record is the confirmed one.
    await card.getByRole('button', { name: /edit/i }).first().click();
    await expect(page.getByTestId('venue-latitude')).toHaveValue('7.77061');
    await expect(page.getByTestId('venue-longitude')).toHaveValue('125.28505');
    await expect(page.getByTestId('venue-radius')).toHaveValue('150');

    // THE DEFECT THIS BLOCK EXISTS FOR. A saved event's geofence must be
    // VISIBLE when the form is reopened.
    //
    // `openEdit` omitted the three venue fields, so a geofenced event reopened
    // with BLANK coordinates and radius. It did NOT delete the fence - an absent
    // field fails the server's `supplied !== 0 && supplied !== 3` check, so the
    // stored values survive a save untouched - but it made the zone invisible,
    // and it meant a one-field correction was rejected as "enter all three"
    // while an all-three retype silently replaced a fence the administrator had
    // never seen.
    //
    // The assertions above prove the form now shows the real values; the save
    // below proves an unrelated edit leaves them intact.
    const reopened = page.locator('form').filter({ has: page.getByLabel('Event name') });
    await reopened.getByLabel('Description').fill('Description edited after the geofence was set.');
    await reopened.getByRole('button', { name: /schedule event/i }).click();
    await expect(reopened).toHaveCount(0, { timeout: 20_000 });

    const afterEdit = await (await page.request.get(`/api/admin/events/${eventId}/`)).json();
    expect(afterEdit.venueLatitude, 'an unrelated edit must leave the geofence latitude intact').toBe(7.77061);
    expect(afterEdit.venueLongitude, 'an unrelated edit must leave the geofence longitude intact').toBe(125.28505);
    expect(afterEdit.venueRadiusMeters, 'an unrelated edit must leave the geofence radius intact').toBe(150);
    expect(afterEdit.description).toBe('Description edited after the geofence was set.');

    await context.close();
  });

  test('applying a device location does not modify the saved venue', async ({ browser }) => {
    const context = await adminContextAt(browser, { latitude: 5.5, longitude: 6.6, accuracy: 9 });
    const page = await adminEvents(context);
    const before = await (await page.request.get('/api/admin/venues/')).json();
    const preset = before.find((v: { name: string }) => v.name === VENUE_NAME);
    expect(preset, 'the isolated preset venue must exist').toBeTruthy();

    await openCreate(page);
    // Start from the saved venue, so the override is genuinely an override.
    await page.getByTestId('saved-venue-select').selectOption(preset.id);
    await expect(page.getByTestId('venue-latitude')).toHaveValue(String(preset.latitude));

    // Now apply an event-specific device location instead.
    await page.getByTestId('use-my-location-button').click();
    await expect(page.getByTestId('use-my-location-review')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('apply-detected-location').click();
    await expect(page.getByTestId('venue-latitude')).toHaveValue('5.5');
    // The picker stops claiming this event is the saved venue.
    await expect(page.getByTestId('saved-venue-select')).toHaveValue('');

    // The saved venue itself is untouched: same coordinates, same defaults.
    const after = await (await page.request.get('/api/admin/venues/')).json();
    const still = after.find((v: { id: string }) => v.id === preset.id);
    expect(still.latitude).toBe(preset.latitude);
    expect(still.longitude).toBe(preset.longitude);
    expect(still.radiusMeters).toBe(preset.radiusMeters);
    expect(still.default_required_attendance_minutes).toBe(preset.default_required_attendance_minutes);
    // Still exactly one record for that name - no duplicate was created.
    expect(after.filter((v: { name: string }) => v.name === VENUE_NAME)).toHaveLength(1);
    await context.close();
  });
});
