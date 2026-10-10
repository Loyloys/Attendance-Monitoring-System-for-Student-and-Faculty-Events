import { defineConfig, devices } from '@playwright/test';

/**
 * BROWSER VERIFICATION against a DEDICATED, ISOLATED test stack.
 *
 * The target is NOT the live app. It is a private instance:
 *   - MongoDB  127.0.0.1:27019   university_attendance_e2e_test
 *   - Backend  127.0.0.1:8100    (the live API is 8000 and is never used here)
 *   - Frontend localhost:5174    (the live UI is 5173 and is never used here)
 *
 * `localhost` rather than `127.0.0.1`: Vite's default dev-server listen address
 * resolves to the IPv6 loopback on Windows, so an IPv4-only base URL is refused
 * with ERR_CONNECTION_REFUSED. `localhost` reaches whichever loopback is bound,
 * and it is still a strictly different origin from the live 5173 app.
 *
 * ISOLATION IS A SAFETY PROPERTY, NOT A CONVENIENCE. `E2E_FRONTEND_URL` must
 * resolve to a port this project owns for testing. If it is left pointing at the
 * live origin, this suite would create accounts, publish events and record
 * attendance in the real database, so the guard refuses to run instead.
 */
const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:5174';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:8100';

/**
 * Hosts the isolated instance answers on. Port 5174 is the test UI; 8100 is the
 * test API; 8000/5173 are the LIVE app and are refused below.
 *
 * `new URL(value).host` is hostname + PORT and deliberately excludes the scheme,
 * so one entry covers both `http://localhost:5174` and `https://localhost:5174`.
 * That is correct and safe: both are the same isolated instance, and TLS
 * terminating at Vite does not make it a different target. The live origins are
 * still refused in either scheme.
 */
const ALLOWED_FRONTEND_HOSTS = ['127.0.0.1:5174', 'localhost:5174'];
const ALLOWED_BACKEND_HOSTS = ['127.0.0.1:8100', 'localhost:8100'];

/**
 * The live origins, refused explicitly and by name.
 *
 * A test run creates accounts, publishes events and records attendance, so
 * pointing it at the live app would write real data. Listing these separately
 * means the error says "that is the LIVE application" instead of the more
 * confusing "not in the allowed list".
 */
const LIVE_HOSTS = new Set(['127.0.0.1:5173', 'localhost:5173', '127.0.0.1:8000', 'localhost:8000']);

const forbidden = (value: string, allowed: string[], label: string) => {
  const host = new URL(value).host;
  if (LIVE_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run: ${label} is ${value}, which is the LIVE application. `
      + 'These tests write data; they may only target the isolated instance.',
    );
  }
  if (!allowed.includes(host)) {
    throw new Error(
      `Refusing to run: ${label} is ${value} (host ${host}). `
      + `These tests write data, so they may only target the isolated instance. `
      + `Allowed: ${allowed.join(', ')}. The live app must never be a test target.`,
    );
  }
};
forbidden(FRONTEND, ALLOWED_FRONTEND_HOSTS, 'E2E_FRONTEND_URL');
forbidden(BACKEND, ALLOWED_BACKEND_HOSTS, 'E2E_BACKEND_URL');

export default defineConfig({
  testDir: './e2e',
  // Scans share ONE seeded event and ONE attendance row per person, so they must
  // not interleave. `fullyParallel: false` keeps the duplicate-scan assertions
  // about a known starting state rather than about test ordering luck.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../.e2e/artifacts',
  use: {
    baseURL: FRONTEND,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    // CERTIFICATE TRUST IS NEVER BYPASSED. This is Playwright's default, stated
    // explicitly so nobody "fixes" an HTTPS run by turning it on. Setting it to
    // `true` would make every certificate acceptable, which is precisely the
    // `curl -k` mistake this suite exists to avoid: it would report success
    // against a certificate no device trusts, proving nothing about trust.
    //
    // An HTTPS run therefore REQUIRES the test CA to be installed on the machine
    // (docs/ISOLATED-HTTPS-TEST.md). If it is missing, the run must fail.
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Playwright's bundled Chromium could not be downloaded in this
        // environment (the CDN repeatedly timed out), so the already-installed
        // Google Chrome is driven through the same Playwright protocol. This is
        // a locally installed browser, never the live app.
        channel: 'chrome',
        viewport: { width: 1440, height: 1000 },
        launchOptions: {
          args: [
            // A camera is SIMULATED for the scanner tests. This does NOT prove
            // anything about a real iPhone camera, a real phone's Safari, or
            // real lens/screen glare; it only proves the app's decode-and-submit
            // path works against a synthetic video source.
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
        permissions: ['camera', 'geolocation'],
      },
    },
  ],
});
