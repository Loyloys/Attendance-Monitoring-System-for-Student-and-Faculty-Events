import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * DEDICATED Vite configuration for the isolated HTTPS test instance.
 *
 * This is a SEPARATE file from vite.config.ts on purpose. The live development
 * config keeps its plain-HTTP behaviour on port 5173 exactly as before; loading
 * TLS material or rewriting proxy behaviour is only ever wanted by the isolated
 * verification stack, so the two can never interfere.
 *
 * Run it explicitly:
 *   npx vite --config vite.test.config.ts
 *
 * ---------------------------------------------------------------------------
 * WHY THE CERTIFICATE AND KEY ARE READ WITH readFileSync (issue 1)
 * ---------------------------------------------------------------------------
 * `server.https` expects the PEM *text*, not a path. Handing it a filename is
 * the classic way this breaks, and it breaks QUIETLY: Node tries to parse the
 * literal string "C:\...\localhost-key.pem" as a PEM block, finds no
 * "-----BEGIN" marker, and falls back to a self-signed certificate that nothing
 * trusts. The server starts, the URL is https, and the only symptom is a
 * browser warning - which looks exactly like an untrusted CA and sends you
 * hunting in the certificate store instead of here.
 *
 * readFileSync(file, 'utf8') returns the actual file CONTENTS, which is what
 * `key`/`cert` are specified to take. The assertion below then verifies the
 * loaded text really is PEM before the server starts, so a mistake fails loudly
 * and names the real file.
 */
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..');

/** Reads a PEM file's CONTENTS, or throws a message naming the real path. */
function readPem(label: string, filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing ${label}: ${filePath}\n`
      + 'Generate one with mkcert (see docs/ISOLATED-HTTPS-TEST.md). '
      + 'This is a path that does not exist, not an unreadable certificate.',
    );
  }
  const contents = readFileSync(filePath, 'utf8');
  // A filename passed through by mistake fails here, loudly and specifically.
  if (!contents.includes('-----BEGIN')) {
    throw new Error(
      `${label} at ${filePath} does not look like PEM data: the file was read `
      + 'but contains no "-----BEGIN" marker.',
    );
  }
  return contents;
}

// Both are required. An HTTPS run with an untrusted certificate would quietly
// become "accept whatever warning appears", which is the thing this run exists
// to disprove.
const KEY_FILE = process.env.E2E_TLS_KEY_FILE || path.join(repoRoot, '.e2e', 'tls', 'localhost-key.pem');
const CERT_FILE = process.env.E2E_TLS_CERT_FILE || path.join(repoRoot, '.e2e', 'tls', 'localhost.pem');

const key = readPem('TLS private key', KEY_FILE);
const cert = readPem('TLS certificate', CERT_FILE);

/** The isolated API. Loopback only - never the live backend on 8000. */
const API_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8100';

/**
 * Refuse to point the test frontend at the live API.
 *
 * The proxy target is the most dangerous value in this file: one typo resolving
 * to the live backend would create accounts, publish events and record
 * attendance in the real database while the banner still claimed to be a test
 * instance. This fails at config load, before any request is made.
 */
{
  const { hostname, port } = new URL(API_TARGET);
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(`Refusing to start: VITE_API_PROXY_TARGET is ${API_TARGET}, which is not loopback.`);
  }
  if (port === '8000' || port === '5173') {
    throw new Error(`Refusing to start: ${API_TARGET} is the LIVE backend. This instance uses 8100.`);
  }
}

/**
 * The proxy, and why each option is set (issue 2).
 *
 * The browser speaks HTTPS to Vite; Vite then speaks PLAIN HTTP to the API on
 * loopback. That downgrade is deliberate and is not a weakness: the hop never
 * leaves the machine, and it lets the real certificate terminate at Vite while
 * the API stays an ordinary HTTP server.
 *
 * What matters is that the API is told the TRUTH about the original request.
 * `secure` controls TLS verification OF THE UPSTREAM, which is irrelevant here
 * because the upstream is plain http:// - setting it would only mislead a reader
 * into thinking the hop itself had been secured. The option that actually
 * matters is `xfwd`, which makes http-proxy send:
 *
 *   X-Forwarded-Proto: https
 *
 * Without `xfwd`, the API sees a bare HTTP request and `request.secure` is
 * false. express-session then REFUSES to set a `secure` cookie for an
 * "insecure" request, so the login response arrives with no session cookie, the
 * browser silently stays signed out, and every later write fails CSRF. The
 * Express app sets `trust proxy` to 1, so with `xfwd` present `request.secure`
 * is correctly true and the Secure cookie is issued.
 *
 * `changeOrigin` rewrites Host to the loopback API so the origin guard sees one
 * consistent host, while the `Origin` header itself is left intact - the API
 * must still see the browser's real https:// origin in order to accept it.
 */
const apiProxy: ProxyOptions = {
  target: API_TARGET,
  changeOrigin: true,
  xfwd: true,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.E2E_FRONTEND_PORT || 5174),
    strictPort: true,
    https: { key, cert },
    // Loopback by default. A phone needs a routable address, which is a
    // separate and explicitly approved exposure decision - documented in
    // docs/ISOLATED-HTTPS-TEST.md, never enabled implicitly.
    host: process.env.E2E_HTTPS_HOST || '127.0.0.1',
    proxy: { '/api': apiProxy },
  },
});
