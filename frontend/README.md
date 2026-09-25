# COT Event Attendance Frontend

This Vite app is the student/faculty portal for the COT event-attendance system. The canonical user workspace is `/portal`; the sidebar changes according to the server-assigned role.

## Development

```powershell
npm install
npm run dev
```

The development server proxies `/api` to Django on port 8000. Run `python manage.py migrate` and `python manage.py seed_event_demo --reset` from the repository root first.

## Frontend structure

- `src/data/eventApi.ts` — CSRF-aware session API client.
- `src/types/eventAttendance.ts` — event, attendance, monitoring, and profile contracts.
- `src/components/event/` — dashboard, event directory, personal history, faculty monitor, feedback, and profile panels.
- `src/components/common/AttendanceScanner.tsx` — server-confirmed QR, barcode, and RFID/ID check-in UI.
- `src/components/common/EventQRCode.tsx` — server-generated short-lived event QR code.
- `src/pages/Portal.tsx` — the single event-attendance workspace for both roles.
- `src/context/AuthContext.tsx` — session restoration and logout state.

The browser stores no password, role claim, or attendance record. Attendance success is rendered only after the Django API returns a persisted record.

## Checks

```powershell
npm run lint
npm run build
```
