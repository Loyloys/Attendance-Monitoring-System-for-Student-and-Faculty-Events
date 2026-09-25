# COT Event Attendance Monitoring System

A secure event-attendance system for the College of Technologies. The application is intentionally limited to **student and faculty event attendance**.

## Implemented workflow

- Server-assigned Student, Faculty, and Administrator roles.
- ID/username and password login backed by Django sessions and CSRF protection.
- Upcoming, ongoing, and completed event visibility with date, time, and venue.
- Student event registration with server-side duplicate protection.
- QR, barcode, and RFID/ID event check-in flows.
- Server-generated Present/Late status and confirmation only after persistence.
- Personal event history and attendance percentage.
- Faculty monitoring and PDF export limited to assigned events.
- Student and faculty profile updates with protected role and identity fields.
- Event feedback after attendance, with one response per user and event.
- Optional organizer-issued student participation certificates.

Administrator functionality remains in a separate workspace and is never exposed through student or faculty API permissions.

## Technology

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, QR Scanner, jsPDF.
- Backend: Django 6, Django REST Framework, SQLite by default.
- Authentication: Django server sessions, CSRF, HttpOnly session cookie.

## Requirements

- Python 3.12 or newer
- Node.js 20 or newer

## Start locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_event_demo --reset
python manage.py runserver
```

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`. The development server is configured to use port 5173 strictly; if that port is already occupied, stop the existing frontend process rather than opening the fallback port, because only the documented local origins are trusted for CSRF.

The VS Code **Run Attendance App** task runs both processes. If Python is not installed or the Microsoft Store alias is being used, install Python and reopen VS Code.

## Development accounts

`seed_event_demo` creates relative-date event data for testing:

| Role | ID | Default development password |
| --- | --- | --- |
| Student | `STU001` | `student123` |
| Faculty | `FAC001` | `faculty123` |
| Administrator | `ADM001` | `admin123` |

Override `DEMO_STUDENT_PASSWORD` and `DEMO_FACULTY_PASSWORD` before seeding when needed. These credentials are for local development only; do not use the seed command in production.

## Event API

- `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/`
- `GET/PATCH /api/profile/`
- `GET /api/events/`
- `GET /api/events/managed/` (Faculty, assigned events only)
- `POST /api/events/<id>/registrations/` (Student)
- `POST /api/events/<id>/check-in-code/` (assigned Faculty, QR)
- `POST /api/attendance/scan/`
- `GET /api/attendance/me/`
- `GET /api/events/<id>/attendance/` (assigned Faculty)
- `POST /api/events/<id>/feedback/`
- `GET /api/reports/me.pdf`
- `GET /api/reports/events/<id>.pdf` (assigned Faculty)
- `GET /api/certificates/<id>/download/` (owning Student)

## Data model

`UserProfile` is linked to Django's authenticated user. `Event` owns event-scoped `EventRegistration`, `EventAttendance`, `EventFeedback`, `EventCertificate`, and short-lived `AttendanceCode` records. Database constraints enforce one registration, attendance row, feedback response, and certificate per user and event.

## Security checks

The server, rather than the browser, validates the assigned role, event audience, registration prerequisite, check-in window, event method, own card identity, faculty assignment, and duplicate attendance. Profile updates explicitly reject role, ID, department assignment, and card-assignment changes. Personal reports and history have no user-selection parameter.

## Verification

```powershell
python manage.py test events
cd frontend
npm run lint
npm run build
```

The repository includes API tests for role isolation, owner-only history, duplicate scans, self-only card matching, protected roles, authorized faculty monitoring/export, feedback gating, and certificate ownership.
