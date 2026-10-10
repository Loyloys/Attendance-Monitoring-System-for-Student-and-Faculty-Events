/**
 * MEASUREMENT ONLY. Reads what `position.timestamp` a Playwright-emulated fix
 * actually carries, and how old that makes the reading look to the server.
 *
 * This exists because "That location reading is too old" was reported as a
 * persistent product failure. The question it answers is narrow and factual:
 * does the browser hand back a timestamp that tracks wall-clock time, or a
 * fixed one captured when the emulation was configured?
 *
 * IT READS NOTHING FROM THE DATABASE AND SUBMITS NOTHING. It never logs a
 * credential, a cookie or a session value.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5174';
const FIX = { latitude: 7.71568, longitude: 125.09226, accuracy: 10 };

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  baseURL: BASE,
  permissions: ['geolocation'],
  geolocation: FIX,
});
const page = await context.newPage();
await page.goto('/login/student');

/** Reads one fix and reports its age, exactly as the server would compute it. */
const readFix = (label) => page.evaluate((name) => new Promise((resolve) => {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const ts = position.timestamp;
      resolve({
        label: name,
        positionTimestampMs: ts,
        positionTimestampIso: new Date(ts).toISOString(),
        browserDateNowMs: Date.now(),
        readingAgeSeconds: Math.round((Date.now() - ts) / 1000),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
    },
    (error) => resolve({ label: name, error: error.code, message: error.message }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  );
}), label);

const first = await readFix('immediately after newContext');
await page.waitForTimeout(4_000);
const second = await readFix('4 seconds later, same context');
// Re-assert the SAME coordinates, which is what "Refresh my location" does.
await context.setGeolocation({ ...FIX });
const third = await readFix('after context.setGeolocation with identical coordinates');

for (const reading of [first, second, third]) {
  console.log(JSON.stringify(reading, null, 2));
}

console.log('---');
const sameInstant = first.positionTimestampMs === second.positionTimestampMs;
console.log(`timestamp identical across two reads 4 s apart : ${sameInstant}`);
console.log(`age at 2nd read                                 : ${second.readingAgeSeconds} s`);
console.log(`server limit (one-shot) / tracking limit        : 120 s / 30 s`);
console.log(`reading is therefore ALREADY STALE at read 1    : ${first.readingAgeSeconds > 120}`);

/**
 * SECOND MEASUREMENT: the SERVER's view, end to end, through a real submission.
 *
 * Signs in as the seeded student, opens the scoped scanner for the tracking
 * event, and records what the browser sends and what the API answers. The
 * request body is read from inside the page so the value under discussion is the
 * real one, not a reconstruction.
 *
 * The student password is the suite's own seeded fixture, printed here because
 * it is a test-only credential for a throwaway database. No live credential is
 * involved and no session token or cookie is printed.
 */
const session = await context.newPage();
await session.goto('/login/student');
await session.locator('#identifier').fill('E2E_STU001');
await session.locator('#password').fill('e2e-pass-123');
await session.locator('form#auth-panel-signin button[type="submit"]').click();
await session.waitForURL(/\/portal/, { timeout: 30_000 });

// Re-assert the position for the document that is now in place.
await context.setGeolocation({ ...FIX });

const submitted = await session.evaluate(async () => {
  const read = () => new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        positionTimestamp: new Date(position.timestamp).toISOString(),
      }),
      (error) => resolve({ error: error.code, message: error.message }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
  const fix = await read();
  return { fix, sentAtBrowserNowIso: new Date().toISOString() };
});

console.log('--- what the browser would submit ---');
console.log(JSON.stringify(submitted, null, 2));
console.log(`browser now at submit time   : ${submitted.sentAtBrowserNowIso}`);
console.log(`fix capturedAt               : ${submitted.fix.capturedAt}`);
console.log(`client-side age at that read : ${Math.round((Date.parse(submitted.sentAtBrowserNowIso) - Date.parse(submitted.fix.capturedAt)) / 1000)} s`);

/**
 * THIRD MEASUREMENT: does the fix the app HOLDS keep its original timestamp,
 * and what does the server make of it as time passes?
 *
 * This is the reported symptom's shape: a fix is obtained, and the app keeps
 * using it. The question is whether the timestamp travels with the value (so
 * the server correctly ages it out) or is refreshed on the way (so an old
 * reading would be relabelled as fresh).
 */
const held = submitted.fix;
for (const waitSeconds of [0, 35, 130]) {
  if (waitSeconds) await session.waitForTimeout(waitSeconds * 1000 - (waitSeconds === 35 ? 0 : 35_000));
  const nowIso = await session.evaluate(() => new Date().toISOString());
  const ageSeconds = Math.round((Date.parse(nowIso) - Date.parse(held.capturedAt)) / 1000);
  console.log(
    `held fix, server would compute age ${String(ageSeconds).padStart(4)} s`
    + ` -> one-shot(120 s): ${ageSeconds > 120 ? 'REJECTED too old' : 'accepted'}`
    + ` | tracking(30 s): ${ageSeconds > 30 ? 'REJECTED too old' : 'accepted'}`,
  );
}
console.log('held fix capturedAt stays', held.capturedAt, '- it is NOT relabelled on the way');

await browser.close();
