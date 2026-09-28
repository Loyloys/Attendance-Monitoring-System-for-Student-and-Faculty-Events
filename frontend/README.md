# COT Event Attendance Frontend

This Vite application is the React/TypeScript frontend for the COT event-attendance system. The canonical user workspace is `/portal`; the sidebar changes according to the server-assigned role. Administrator tools are served from `/admin` and use authenticated Express APIs backed by MongoDB.

## Development

```powershell
npm install
npm run dev
```

The development server proxies `/api` to the Express server at `http://127.0.0.1:8000`. Configure the target with `VITE_API_PROXY_TARGET` if the API uses another address.

## Frontend structure

- `src/data/eventApi.ts` — CSRF-aware session, event, attendance, report, and administrator API client.
- `src/data/adminStore.ts` — MongoDB-backed administrator state and mutations; the previous local-storage seed is archived once through the API.
- `src/types/eventAttendance.ts` — event, attendance, monitoring, and profile contracts.
- `src/components/event/` — dashboard, event directory, personal history, faculty monitor, feedback, and profile panels.
- `src/components/common/AttendanceScanner.tsx` — server-confirmed QR, barcode, and RFID/ID check-in UI.
- `src/components/common/EventQRCode.tsx` — server-generated short-lived event QR code.
- `src/pages/Portal.tsx` — the event-attendance workspace for students and faculty.
- `src/pages/admin/Workspace.tsx` — MongoDB-backed administrator workspace.
- `src/context/AuthContext.tsx` — session restoration and logout state.

The browser stores no password, role claim, or attendance record. Attendance success is rendered only after the Express API returns a MongoDB-persisted record.

## Checks

```powershell
npm run lint
npm run build
```
