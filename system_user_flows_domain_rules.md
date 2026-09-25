# COT Event Attendance — User Flows and Domain Rules

## Purpose

This document is the source of truth for the current event-attendance implementation. The system serves **events only** for students and faculty. Other attendance domains are outside this application.

## Roles and boundaries

### Student

A student can sign in, view available events, register when required, record personal event attendance, view personal event history and percentage, submit feedback for attended events, update a protected personal profile, export a personal PDF, and download an optional certificate for their own event.

### Faculty

A faculty member can sign in, view events, record personal event attendance, view personal event history and percentage, submit feedback, update a protected personal profile, export a personal PDF, and monitor or export attendance only for events they organize or supervise.

### Administrator

Administrator functions remain separate. Student and faculty sessions cannot call administrator APIs or routes. Role assignment and identity administration are not self-service profile operations.

## Event lifecycle

1. An administrator or authorized organizer publishes an event.
2. The event stores its date, start/end time, venue, audience, attendance method, registration rule, and check-in window.
3. The event is visible as upcoming, ongoing, completed, or cancelled.
4. A student may register only while registration is open and required.
5. A student or faculty member checks in through the event's enabled method.
6. The server determines Present or Late from the event's late cutoff and records the result once.
7. After attendance, feedback is available once per user and event.
8. An organizer may issue an optional certificate for a student/event pair.

## Event relationships

- User ? Event ? Attendance
- User ? Event ? Registration
- User ? Event ? Feedback
- User ? Event ? Certificate
- Event ? short-lived attendance code

Every attendance, registration, feedback, and certificate row requires an event. There are no parallel attendance aggregates.

## Validation rules

- Sessions and CSRF protect authenticated browser requests.
- The server, not the client, assigns the role.
- The event audience must permit the signed-in user.
- Registration is required when the event says it is required.
- The check-in window and enabled method must match.
- RFID/barcode identifiers must match the signed-in user's own account.
- A user can have only one attendance row per event.
- Faculty monitoring and event PDF export require organizer/supervisor assignment.
- A student can access only their own history, report, and certificate.
- Profile updates reject role, ID, department assignment, and card assignment changes.

## Audit and reporting

A successful scan is the only source of a success confirmation. Reports are generated on the server from persisted event-scoped records. Faculty reports are limited to assigned events; personal reports are derived from the authenticated user.
