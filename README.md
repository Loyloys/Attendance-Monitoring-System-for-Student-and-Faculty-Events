# COT Event Attendance Monitoring System

A secure **event-attendance** system for the College of Technologies. The application remains intentionally limited to student and faculty event attendance; the conversion did not introduce class attendance or change the existing workflows.

## Preserved functionality

- Server-assigned Student, Faculty, and Administrator roles.
- ID/username login, MongoDB-backed sessions, CSRF protection, logout, and session restoration after refresh.
- Upcoming, ongoing, completed, and cancelled event visibility.
- Student event registration with duplicate protection.
- QR, barcode, and RFID/ID check-in using the existing scanner formats.
- Server-calculated Present/Late status; success is displayed only after MongoDB persistence.
- Personal attendance history, percentage, and PDF report.
- Faculty monitoring and PDF export limited to assigned events.
- Student and faculty profile updates with administrator-managed identity fields protected.
- One feedback response per authenticated user and event.
- Owner-only participation-certificate download.
- Administrator event management, account management, manual attendance, reports, and evaluation-form administration backed by MongoDB.

Branding, colors, assets, routes, layouts, responsive behavior, validation messages, and API response fields remain unchanged. The administrator workspace keeps its existing design; only its data operations now use authenticated Express endpoints instead of browser storage.

## Technology

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, QR Scanner, jsPDF.
- **Backend:** JavaScript `.js`, Node.js 20+, Express 4, Mongoose.
- **Database:** MongoDB.
- **Authentication:** HttpOnly server session cookie, MongoDB session store, session CSRF token, trusted-origin checks, login throttling, and server-derived roles.

## Project structure

```text
frontend/                 React/TypeScript application
backend/
  src/config/             Environment and MongoDB connection
  src/models/             Mongoose schemas and indexes
  src/routes/             Express routes
  src/controllers/        HTTP request/response handling
  src/services/           Business rules and PDF generation
  src/middleware/         Authentication, CSRF, validation, errors, rate limits
  src/utils/              Password, ID, event, and validation helpers
  scripts/                SQLite migration, verification, and separate demo seed
  tests/                  Node integration tests
  .env.example
  package.json
legacy/django/            Archived pre-conversion Django source and SQLite database
start-app.ps1             Windows launcher for MongoDB + Express + Vite
```

## Requirements

- Node.js 20 or newer and npm.
- MongoDB Community/Enterprise 6 or newer, reachable at the URI in `backend/.env`.
- Windows PowerShell is required only for `start-app.ps1`; the application itself runs with standard `npm` commands.

## Configuration

Create the backend environment file:

```powershell
cd backend
Copy-Item .env.example .env
```

Replace `SESSION_SECRET` with a random value of at least 32 characters. Important variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port; defaults to `8000`. |
| `MONGODB_URI` | MongoDB connection string. |
| `SESSION_SECRET` | Signs session cookies; keep secret. |
| `TRUSTED_ORIGINS` | Comma-separated browser origins allowed to call the API. |
| `SECURE_COOKIES` | Set `true` behind HTTPS in production. |
| `SQLITE_SOURCE` | Legacy SQLite source used only by the migration script. |
| `MIGRATION_BACKUP_DIR` | Destination for pre-migration SQLite backups. |
| `DEMO_*_PASSWORD` | Passwords for optional, separately tagged demo accounts. |

Backend secrets are read only by the backend. No backend secret is exposed through Vite or frontend configuration.

## Install

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

The frontend and backend have separate dependency trees and startup commands.

## Migrate the existing database

The original SQLite database is preserved at `legacy/django/db.sqlite3`. The migration:

1. Verifies the source exists and calculates its SHA-256 fingerprint.
2. Creates a timestamped backup in `backend/backups/` before writing.
3. Maps legacy numeric user IDs to MongoDB references while preserving public account IDs.
4. Preserves event UUIDs and numeric registration, attendance, feedback, certificate, and check-in-code IDs.
5. Imports users, profiles, events, supervisor relationships, attendance, feedback, certificates, and active attendance codes.
6. Verifies record counts and every relationship.
7. Skips writes when the same source fingerprint was already migrated, protecting later MongoDB edits.

```powershell
cd backend
npm run migrate
npm run verify:migration
```

The migration is rerun-safe: legacy records are upserted by stable IDs, and a completed source fingerprint is not imported again. Demo data is never mixed with migrated data.

### Existing browser administrator data

The previous administrator prototype stored data under `cot-admin-requirements-v1` in browser storage. On the first administrator load after conversion, the frontend sends that snapshot once to the authenticated Express endpoint. MongoDB archives it in `legacybrowsersnapshots` with a SHA-256 fingerprint, credential fields are removed before storage, and the browser removes the key only after archival succeeds. The archive does not overwrite canonical migrated users or events and is duplicate-safe, including concurrent requests.

## Optional demo data

Demo records are separate from migrated data and use `DEMO_*` account IDs:

```powershell
cd backend
npm run seed
```

| Role | ID | Default development password |
| --- | --- | --- |
| Student | `DEMO_STU001` | `student123` |
| Faculty | `DEMO_FAC001` | `faculty123` |
| Administrator | `DEMO_ADM001` | `admin123` |

Override the `DEMO_*_PASSWORD` values before seeding when needed. Never run demo seeding in production.

## Start the application

Start MongoDB first. Then either run the VS Code **Run Attendance App** task or use two terminals.

Backend:

```powershell
cd backend
npm start
```

Frontend:

```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`. Port 5173 is strict because only the documented local origins are trusted for CSRF.

On Windows, the launcher checks Node and MongoDB, creates `backend/.env` from the example with a random development secret when needed, installs missing dependencies, and starts both processes:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-app.ps1
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health/
```

## Tests and builds

Backend integration tests use a separate `university_attendance_test` MongoDB database by default. Set `TEST_MONGODB_URI` to override it.

```powershell
cd backend
npm test
```

The tests cover invalid/valid login, lockout, CSRF/origin rejection, session restoration/logout, role isolation, protected profiles, event CRUD and visibility, idempotent registration, QR/RFID scanning, simultaneous duplicate scans, feedback, faculty assignment scope, personal/admin PDFs, certificate ownership, administrator CRUD, legacy browser archival, and persistence across a MongoDB reconnect.

`tests/googleAuth.test.js` adds 22 more: password login still works, CSRF covers the Google routes, linked identities keep their role, new identities register as passwordless students, profile completion cannot be bypassed, a browser-supplied role is rejected, matching emails never merge, deactivated accounts stay blocked, Google-only accounts reject password login, malformed / wrong-audience / wrong-issuer / expired / unverified-email / missing-subject credentials are rejected, the nonce must match and cannot be replayed, simultaneous registrations create one account, sessions survive refresh and logout invalidates them, linking refuses an already-owned subject and never overwrites the account email, unauthenticated linking is refused, a missing client id yields a clean unavailable state, the approved Workspace domain list is enforced against the verified `hd` claim, the decision comes from that claim rather than the email suffix, selecting Faculty cannot sign into a Student account (and no role is changed), a matching or invented selection behaves correctly, and a new identity chosen on the Faculty screen still registers as a Student.

Frontend checks:

```powershell
cd frontend
npm run lint
npm run build
```

The converted Express suite passes **43/43** against MongoDB (21 pre-existing plus 22 Google). The archived Django suite in `legacy/django/events/tests.py` contains 21 tests, so the original coverage was ported test-for-test. The Django suite itself was **not** re-executed during the conversion, because Django is not installed in this environment; parity was confirmed by test count and by behaviour observed through the live API. The production frontend build and ESLint complete successfully; Vite reports only its existing large-chunk advisory.

The Google tests substitute the token verifier through a single test-only seam, so they exercise this project's audience, issuer, expiry, verified-email, nonce and account-linking rules deterministically. Reaching Google's real endpoints, and a real popup in a browser, requires your own OAuth client id and is not covered by the automated run.

## API

The frontend-compatible paths are preserved:

- `GET /api/health/`
- `GET /api/auth/csrf/`
- `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/`
- `GET/PATCH /api/profile/`
- `GET /api/events/`, `GET /api/events/<id>/`
- `GET /api/events/managed/`
- `POST /api/events/<id>/registrations/`
- `POST /api/events/<id>/check-in-code/`
- `POST /api/attendance/scan/`, `GET /api/attendance/me/`
- `GET /api/events/<id>/attendance/`
- `POST /api/events/<id>/feedback/`
- `GET /api/reports/me.pdf`
- `GET /api/reports/events/<id>.pdf`
- `GET /api/certificates/<id>/download/`
- `GET/POST /api/admin/events/`, `PATCH /api/admin/events/<id>/`, `POST /api/admin/events/<id>/cancel/`
- `GET /api/admin/state/`
- `POST/PATCH/DELETE /api/admin/users/`
- `POST/PATCH/DELETE /api/admin/attendance/`
- `POST/DELETE /api/admin/forms/`
- `POST /api/admin/import-legacy-browser/`

## Google sign-in

Sign-in supports both the existing ID/password form and **Continue with Google**, using the Google Identity Services popup flow. Password accounts are unaffected.

### The two-step journey

1. **`/login` — Choose your account type.** A split screen: branding and welcome on the left, the account choices on the right. **Student** and **Faculty** are the primary choices, and **Administrator** stays available as a secondary option. Employee and Alumni are deliberately absent, because they are not roles in this system.
2. **`/login/student`, `/login/faculty`, `/login/administrator` — Sign in.** A white card with the existing email/username and password form, password visibility, the Sign In / Create Account tabs, an *or continue with* divider, and the official Google button next to *"Use your institutional Google account."* A **Back to account selection** link returns to step 1.

The account type chosen in step 1 **only chooses which screen you see**. It is never sent as a role, never written to the database, and never grants a permission. What actually opens is always decided by the stored profile role, exactly as before this change.

| Situation | Result |
| --- | --- |
| Google identity already linked, role matches the screen | Signed in directly |
| Google identity already linked, role differs from the screen | **409 `role_mismatch`**, the role is left untouched, and the UI offers a link to the correct sign-in |
| New identity, any screen | Short *Complete Your Profile* step, created as **Student** |
| Domain not on `GOOGLE_ALLOWED_HOSTED_DOMAINS`, or a personal Gmail account | **403 `google_domain_not_allowed`** with a clear message |

Google domain membership alone never proves faculty or administrator status. A mismatch is explained, never resolved by changing the stored role, and Administrator accounts stay pre-authorized.

### How it works

1. The sign-in card asks the backend for a client id and a single-use nonce (`GET /api/auth/google/config/`, then `POST /api/auth/google/session/`). Both live in the HttpOnly session cookie.
2. Google's official button opens the account chooser in a popup. Google returns an **ID token**; no authorization-code exchange and **no client secret** are involved, and the application never sees a Google password.
3. The ID token is posted to `POST /api/auth/google/`. The backend verifies it with Google's official `google-auth-library` and re-checks the signature, audience, issuer, expiry and `email_verified`, then matches the `nonce` that ties the credential to the browser session that started the flow.
4. The account is identified by Google's stable `sub` value.

### Account rules

| Situation | Result |
| --- | --- |
| `sub` already linked to an active account | Signs in, preserving role and records |
| `sub` linked to a deactivated account | **Blocked** |
| No link, but the email matches an account | **Refused (409).** No silent merge. Sign in with the existing password, then link Google |
| New identity | Short *Complete Your Profile* step |
| Two simultaneous registrations for one `sub` | One account, via a unique partial index |

New accounts are created as **Student** with **no password at all**. A browser-supplied `role` is rejected outright, so nobody can self-assign Faculty or Administrator. Google-only accounts cannot sign in with a password, and that attempt fails with the same generic message used for any wrong password.

Linking an identity to an account you are already signed in to is `POST /api/auth/google/link/`. It never overwrites the account's own email, and a `sub` already owned by another account is refused.

### Set up Google Cloud

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. Configure the OAuth consent screen: app name, support email, and the **test audience** (add your own Google address while the app is in *Testing*; the consent warning is expected and harmless for a Web client ID token flow).
3. Create credentials → **OAuth client ID** → application type **Web application**.
4. Under *Authorized JavaScript origins*, add every origin the frontend is served from. Register the exact host, including the port, with no trailing slash and no path:
   - `http://localhost:5173` (the Vite dev server, fixed by `strictPort` in `vite.config.ts`)
   - `http://127.0.0.1:5173`
   - your production origin, e.g. `https://attendance.cot.edu`
5. Copy the client id. It looks like `1234567890-abc.apps.googleusercontent.com`.

### Environment variables

Backend — `backend/.env`:

```dotenv
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_ALLOWED_ISSUERS=accounts.google.com,https://accounts.google.com
GOOGLE_CLOCK_SKEW_SECONDS=60
# Required before going live. Ask your institution's Workspace administrator for
# the exact domain(s); do not guess them.
GOOGLE_ALLOWED_HOSTED_DOMAINS=youruniversity.edu
```

Frontend — `frontend/.env.local` (optional; see `frontend/.env.example`):

```dotenv
VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
```

The client id is public, so it is not a secret and there is no client secret to store. The **backend is the authority**: it decides whether sign-in is available, issues the nonce, and rejects any credential whose audience is not its own `GOOGLE_CLIENT_ID`. Setting only the frontend variable will not enable sign-in.

After changing either file, **restart both** the backend and the Vite dev server.

#### Institutional domains (`GOOGLE_ALLOWED_HOSTED_DOMAINS`)

This is the approved Google Workspace domain list, comma separated, written exactly as Google's `hd` claim reports it (`youruniversity.edu`; a leading `@` and any casing are normalised away).

The check runs **server-side against the verified `hd` claim** from the ID token, after `google-auth-library` has already validated the signature. It deliberately does **not** use the email address suffix, and it does not trust anything the browser sends. Personal Gmail accounts carry no `hd` claim at all and are refused with a clear message, as is any account on a domain that is not on the list.

> **Confirm the exact domain(s) with your institution's Google Workspace administrator before going live.** An empty list accepts any verified Google account, which is not acceptable for a real deployment. `GET /api/auth/google/config/` reports `domainRestricted` so you can confirm at a glance that the restriction is active.

### If Google is not configured

`GET /api/auth/google/config/` reports `enabled: false`, and the card shows *"Google sign-in is not configured on this server"* above a working ID/password form. No existing sign-in path is lost.

### New API endpoints

- `GET /api/auth/google/config/`
- `POST /api/auth/google/session/`
- `POST /api/auth/google/`
- `POST /api/auth/google/complete-profile/`
- `POST /api/auth/google/link/`

All unsafe routes sit behind the existing CSRF middleware and trusted-origin check.

### Browser headers

`backend/src/app.js` allows only `https://accounts.google.com` in the CSP for `script-src`, `frame-src` and `connect-src`, plus Google avatar hosts in `img-src`, and sets `Cross-Origin-Opener-Policy: same-origin-allow-popups` so the popup can return to this page. Nothing else was relaxed. **If you serve the built frontend from a host you control, give it the same CSP** — Vite's dev server does not set one:

```text
script-src 'self' https://accounts.google.com;
frame-src 'self' https://accounts.google.com;
connect-src 'self' https://accounts.google.com https://*.googleapis.com;
img-src 'self' data: blob: https://*.googleusercontent.com;
```

## Data model and constraints

MongoDB collections represent users, profiles, events, event registrations, attendance, feedback, certificates, short-lived attendance codes, evaluation forms/responses, revoked identifiers, login throttles, migration audit records, and archived browser snapshots.

Unique indexes enforce:

- normalized account ID, username, and card identifier;
- one registration per user and event;
- one attendance row per user and event, including concurrent requests;
- one feedback response per user and event;
- one certificate per student and event, plus unique certificate reference;
- unique active check-in token hashes;
- one account per Google `sub`, via a **partial** unique index so password-only accounts are unaffected.

The event workflow still uses the QR format `COT-EVENT:<event UUID>:<secret>`. Password hashes imported from Django remain `pbkdf2_sha256` values and are verified in Node.js; no plaintext conversion is performed.

## Security

- Roles are loaded from MongoDB on each authenticated request; the browser cannot supply its own role or user ID.
- Passwords are never returned by administrator APIs.
- Unsafe requests require a session-bound CSRF token and an allowed `Origin` when supplied.
- Login failures are persisted and throttled by IP plus identifier.
- Event audience, registration, check-in window/method, card ownership, faculty assignment, and duplicate attendance are validated on the server.
- Personal reports, history, and certificates have no user-selection parameter and are owner-scoped.
- Helmet headers, MongoDB session storage, HttpOnly cookies, and production HTTPS cookie support are enabled.

## Database backups

Take a backup **before** any migration or schema change. Backups go to `backend/backups/`, which is ignored by Git.

```powershell
cd backend
npm run backup                 # backend/backups/mongodb.<timestamp>/
npm run backup -- before-v2    # optional label
```

Every collection is written as Extended JSON, which preserves BSON types (dates, decimals, binary) so a restore does not degrade values. A `manifest.json` records the document count and a SHA-256 per collection.

Restore:

```powershell
# Safe default: inserts only documents whose _id is missing, so live records are
# never overwritten.
npm run restore -- backend/backups/mongodb.<timestamp>

# Destructive: replaces each collection wholesale. Use deliberately.
npm run restore -- backend/backups/mongodb.<timestamp> --replace
```

These scripts use the MongoDB driver directly, which is already a project dependency, so `mongodump` and `mongoexport` are **not** required.

### Change history for this database

| When | Change | Backup taken first? |
| --- | --- | --- |
| 2026-09-25 | SQLite → MongoDB migration | Yes, `backups/db.pre-mongodb.*.sqlite3` plus the untouched `legacy/django/db.sqlite3` |
| 2026-09-25 | Demo seed (`DEMO_*`, `dataSource: "demo"`) | n/a, additive and separate from migrated data |
| 2026-09-26 | Google sign-in schema (additive fields + `unique_google_sub` partial index) | **No.** Backed up afterwards to `backups/mongodb-post-google-schema-change.2026-09-26T11-55-05Z` |

The Google change was additive and was verified non-destructive after the fact: the original SQLite source still matched every migrated user record, so no data was lost. Only one **demo** document (`DEMO_STU001`) was rewritten, by ordinary sign-in, which added the new defaulted fields; its password hash and role were unchanged. The authoritative pre-change copy of the original data is `legacy/django/db.sqlite3` and the `db.pre-mongodb.*` backups, both of which predate the Google work.

### What the Google change does and does not touch

- Adds `googleSub`, `googleEmail`, `googleEmailNormalized`, `googlePictureUrl`, `googleLinkedAt`, `authProviders`, `profileCompleted` to `users`. Mongoose does not backfill defaults, so existing documents keep their original shape; the new fields simply appear on the next write.
- Relaxes `passwordHash` from required to optional. Existing hashes are untouched and still verify as `pbkdf2_sha256`.
- Adds the `unique_google_sub` **partial** unique index. It only applies where `googleSub` is a string, so every password-only account stays valid.
- **Never** drops or renames a collection, and **never** merges accounts by matching email. An unlinked Google identity whose email matches an existing account is refused with a 409 and must be linked through an existing sign-in.

## Recovery and known non-runtime warnings

The original Django source, original SQLite database, pre-migration backup, and Git history are retained. Migration failures leave the SQLite source untouched and create a backup before any MongoDB write.

The Vite build emits an advisory about a JavaScript chunk larger than 500 kB; this is not a build failure and existed independently of the backend conversion.

The frontend diff against commit `f7eb4ba` touches only the data layer and dev configuration: `src/data/eventApi.ts`, `src/data/adminStore.ts`, `src/pages/admin/Workspace.tsx`, `vite.config.ts`, and the READMEs. No component, layout, route, branding, or CSS file was modified, so the rendered design, navigation, and responsive behaviour are unchanged by construction. This is a source-level guarantee; a pixel-level screenshot comparison at desktop and mobile widths was not run in this environment, so the original and converted UIs have not been diffed screenshot-to-screenshot.
