/**
 * Full HTTPS verification of the isolated instance: TRUSTED certificate, real
 * password login, session cookie, authenticated requests, refresh and logout.
 *
 * WHY THIS EXISTS RATHER THAN A `curl -k`
 * ---------------------------------------------------------------------------
 * `curl -k` disables certificate verification, so it returns HTTP 200 against a
 * certificate NOBODY trusts. It proves only that a TLS socket opened and a
 * process is running. It cannot show the certificate is trusted, and it cannot
 * show a login session works, because it sends no cookies and never exercises
 * the CSRF layer.
 *
 * Every request below leaves certificate verification ON. A trusted test CA is
 * required: if trust is missing this must fail loudly rather than quietly
 * degrade into a weaker check.
 *
 * Usage (repository root):
 *   node backend/scripts/verify-https-frontend.mjs
 *
 * Environment:
 *   E2E_FRONTEND_URL  default https://localhost:5174
 *   E2E_IDENTIFIER    default E2E_STU001
 *   E2E_PASSWORD      default e2e-pass-123
 *
 * TRUST MODEL. Node's built-in `https` module is used rather than global
 * `fetch`, for one concrete reason: `fetch` takes an Undici *dispatcher* and
 * would need the `undici` package added as a dependency, while `https` is
 * built in and takes a `ca` directly. Critically, `rejectUnauthorized` is left
 * at its secure default of `true` in BOTH paths:
 *
 *   with an explicit `ca`   validation runs against that CA plus the system
 *                           roots, so an unrelated untrusted certificate is
 *                           still rejected;
 *   without one             validation runs against the system roots only, which
 *                           is what a normal browser does after the test CA is
 *                           installed into the trust store.
 *
 * Neither path ever sets `rejectUnauthorized: false`. That is the single setting
 * that would turn this script into the `curl -k` it exists to replace.
 */
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Optional: point at the test CA's rootCA.pem to trust it explicitly. */
const CA_FILE = process.env.E2E_TLS_CA_FILE || path.join(repoRoot, '.e2e', 'tls', 'rootCA.pem');
const ca = existsSync(CA_FILE) ? readFileSync(CA_FILE, 'utf8') : undefined;

const FRONTEND = process.env.E2E_FRONTEND_URL || 'https://localhost:5174';
const IDENTIFIER = process.env.E2E_IDENTIFIER || 'E2E_STU001';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-pass-123';

/**
 * One HTTPS request with verification ON. `rejectUnauthorized` is deliberately
 * never overridden; it is spelled out only to make that omission impossible to
 * mistake for an oversight.
 */
function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers,
      ca,
      rejectUnauthorized: true,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON is fine */ }
        resolve({ status: response.statusCode, body: parsed, text, headers: response.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let failures = 0;
const ok = (message) => console.log(`  PASS  ${message}`);
const fail = (message, detail) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
  if (detail) console.log(`        ${String(detail).split('\n')[0]}`);
};
const check = (condition, message, detail) => (condition ? ok(message) : fail(message, detail));

/** A cookie jar, so a session is actually carried between requests. */
class Jar {
  constructor() { this.cookies = new Map(); }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  absorb(response) {
    for (const raw of response.headers['set-cookie'] ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
}

async function call(jar, url, { method = 'GET', json, headers = {} } = {}) {
  const all = { ...headers };
  const cookieHeader = jar.header();
  if (cookieHeader) all.Cookie = cookieHeader;
  if (json !== undefined) all['Content-Type'] = 'application/json';
  const response = await request(url, {
    method,
    headers: all,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  jar.absorb(response);
  return response;
}

console.log('HTTPS frontend verification');
console.log(`  target   : ${FRONTEND}`);
console.log(`  identity : ${IDENTIFIER}`);
console.log('');

console.log('1. Certificate trust (verification ON, no -k)');
console.log(`        CA: ${ca ? CA_FILE : 'system trust store only'}`);
let trusted = false;
try {
  const response = await request(FRONTEND);
  trusted = true;
  ok(`TLS handshake succeeded against a trusted chain (HTTP ${response.status})`);
} catch (error) {
  fail(
    'TLS handshake failed against the trusted chain',
    `${error.code || ''} ${error.message} - install the test CA (docs/ISOLATED-HTTPS-TEST.md). Do NOT work around this with -k.`,
  );
}
console.log('');

// Without trust there is no valid session to check: every later request would
// fail on the handshake and report a misleading "login failed". Stop here with
// one accurate cause instead of a cascade of symptoms.
if (!trusted) {
  console.log('Stopping: every remaining check needs a trusted connection first.');
  console.log('1 CHECK(S) FAILED');
  process.exit(1);
}

console.log('2. Password login issues a session cookie');
const jar = new Jar();
try {
  const csrf = await call(jar, `${FRONTEND}/api/auth/csrf/`);
  check(csrf.status === 200, 'CSRF token issued', `status ${csrf.status}`);
  if (csrf.status !== 200 || !csrf.body?.csrfToken) {
    throw new Error(`no CSRF token (status ${csrf.status}); is the isolated API running on 8100?`);
  }

  const login = await call(jar, `${FRONTEND}/api/auth/login/`, {
    method: 'POST',
    json: { identifier: IDENTIFIER, password: PASSWORD },
    headers: { 'X-CSRFToken': csrf.body.csrfToken, Origin: FRONTEND },
  });
  check(login.status === 200, `login accepted for ${IDENTIFIER}`, `status ${login.status} ${login.text.slice(0, 150)}`);

  const setCookies = login.headers['set-cookie'] ?? [];
  const session = setCookies.find((cookie) => /^e2e_sessionid=/.test(cookie));
  check(Boolean(session), 'a session cookie was actually issued', `Set-Cookie: ${setCookies.join(' | ') || '(none)'}`);
  if (session) {
    check(/;\s*Secure/i.test(session), 'session cookie is marked Secure', session);
    check(/;\s*HttpOnly/i.test(session), 'session cookie is HttpOnly', session);
  }
  check(
    setCookies.some((cookie) => /^e2e_csrftoken=/.test(cookie)),
    'a CSRF cookie was issued alongside it',
    setCookies.join(' | '),
  );
} catch (error) {
  fail('login flow threw', error.message);
}
console.log('');

console.log('3. Authenticated requests use the session');
try {
  const me = await call(jar, `${FRONTEND}/api/auth/me/`);
  check(me.status === 200, 'GET /api/auth/me/ succeeds with the session cookie', `status ${me.status}`);
  check(me.body?.username === IDENTIFIER, 'the session resolves to the signed-in account', `got ${me.body?.username}`);
  const events = await call(jar, `${FRONTEND}/api/events/`);
  check(events.status === 200, 'GET /api/events/ succeeds (a protected read)', `status ${events.status}`);
} catch (error) {
  fail('authenticated request threw', error.message);
}
console.log('');

console.log('4. Session refresh (no re-authentication)');
try {
  const refreshed = new Jar();
  for (const [name, value] of jar.cookies) refreshed.cookies.set(name, value);
  const me = await call(refreshed, `${FRONTEND}/api/auth/me/`);
  check(me.status === 200, 'the session survives a refresh', `status ${me.status}`);
  check(me.body?.username === IDENTIFIER, 'the refreshed session is the same account', `got ${me.body?.username}`);
} catch (error) {
  fail('refresh threw', error.message);
}
console.log('');

console.log('5. Logout destroys the session');
try {
  const csrf = await call(jar, `${FRONTEND}/api/auth/csrf/`);
  const logout = await call(jar, `${FRONTEND}/api/auth/logout/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': csrf.body?.csrfToken ?? '', Origin: FRONTEND },
  });
  check(logout.status === 204, 'logout returns 204', `status ${logout.status}`);
  const after = await call(jar, `${FRONTEND}/api/auth/me/`);
  check(after.status === 401, 'the session is no longer accepted after logout', `status ${after.status}`);
} catch (error) {
  fail('logout flow threw', error.message);
}
console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
