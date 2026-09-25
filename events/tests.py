from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Event, EventAttendance, EventCertificate, EventRegistration, UserProfile
from .services import create_checkin_code

User = get_user_model()


class EventAttendanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = self.make_user("STU001", "student", "STU001")
        self.other_student = self.make_user("STU002", "student", "STU002")
        self.faculty = self.make_user("FAC001", "faculty", "FAC001")
        self.other_faculty = self.make_user("FAC002", "faculty", "FAC002")
        self.admin = self.make_user("ADM001", "admin", "ADM001")
        self.now = timezone.now()
        self.event = self.make_event(self.faculty)
        self.unauthorized_event = self.make_event(self.other_faculty)

    def make_user(self, username, role, card):
        user = User.objects.create_user(
            username=username,
            password="test-pass-123",
            email=f"{username.lower()}@cot.edu",
        )
        UserProfile.objects.create(
            user=user,
            role=role,
            display_name=username,
            department="COT",
            card_identifier=card,
        )
        return user

    def make_event(self, organizer, method=Event.AttendanceMethod.QR, registration=False):
        return Event.objects.create(
            name=f"Event {organizer.username}",
            starts_at=self.now - timedelta(hours=1),
            ends_at=self.now + timedelta(hours=2),
            check_in_opens_at=self.now - timedelta(minutes=30),
            check_in_closes_at=self.now + timedelta(hours=1),
            late_cutoff=self.now + timedelta(minutes=15),
            venue="Innovation Hall",
            audience=Event.Audience.ALL,
            organizer=organizer,
            registration_required=registration,
            attendance_method=method,
        )

    def test_login_rejects_non_object_payload(self):
        response = self.client.post(reverse("auth-login"), [], format="json")
        self.assertEqual(response.status_code, 400)

    def test_login_rejects_non_string_credentials(self):
        response = self.client.post(
            reverse("auth-login"),
            {"identifier": 123, "password": ["not", "a", "string"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_login_rejects_ambiguous_email(self):
        self.other_student.email = self.student.email
        self.other_student.save(update_fields=["email"])
        response = self.client.post(
            reverse("auth-login"),
            {"identifier": self.student.email, "password": "test-pass-123"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_profile_patch_allows_email_only(self):
        self.client.force_authenticate(self.student)
        response = self.client.patch(
            reverse("profile"),
            {"email": "new.student@cot.edu"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.email, "new.student@cot.edu")
        self.assertEqual(self.student.profile.display_name, "STU001")

    def test_profile_rejects_duplicate_email(self):
        self.client.force_authenticate(self.student)
        response = self.client.patch(
            reverse("profile"),
            {"email": self.other_student.email},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.student.refresh_from_db()
        self.assertEqual(self.student.email, "stu001@cot.edu")

    def test_login_returns_server_assigned_role(self):
        response = self.client.post(
            reverse("auth-login"),
            {"identifier": "stu001", "password": "test-pass-123"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["role"], UserProfile.Role.STUDENT)

    def test_login_accepts_both_local_frontend_origins(self):
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            with self.subTest(origin=origin):
                client = APIClient(enforce_csrf_checks=True)
                csrf_response = client.get(reverse("auth-csrf"))
                csrf_token = csrf_response.json()["csrfToken"]
                response = client.post(
                    reverse("auth-login"),
                    {"identifier": "STU001", "password": "test-pass-123"},
                    format="json",
                    HTTP_ORIGIN=origin,
                    HTTP_X_CSRFTOKEN=csrf_token,
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["role"], UserProfile.Role.STUDENT)

    def test_event_visibility_matrix_and_direct_access_are_role_scoped(self):
        future = (self.now + timedelta(days=2)).date().isoformat()
        payloads = {
            Event.Audience.STUDENT: {
                "name": "TEST STUDENT EVENT",
                "audience": Event.Audience.STUDENT,
            },
            Event.Audience.FACULTY: {
                "name": "TEST FACULTY EVENT",
                "audience": Event.Audience.FACULTY,
            },
            Event.Audience.ALL: {
                "name": "TEST ALL EVENT",
                "audience": Event.Audience.ALL,
            },
        }
        self.client.force_authenticate(self.admin)
        created = {}
        for audience, payload in payloads.items():
            response = self.client.post(
                reverse("admin-event-list"),
                {
                    **payload,
                    "description": "Visibility verification",
                    "date": future,
                    "start": "09:00",
                    "end": "10:00",
                    "venue": "Test Hall",
                    "cutoff": "09:15",
                    "method": Event.AttendanceMethod.QR,
                    "status": Event.Status.PUBLISHED,
                    "requiredForAttendance": False,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(response.data["audience"], payload["audience"].title())
            created[audience] = Event.objects.get(pk=response.data["id"])
            self.assertEqual(created[audience].audience, audience)

        self.client.force_authenticate(self.student)
        student_events = self.client.get(reverse("event-list"))
        self.assertEqual(student_events.status_code, 200)
        student_ids = {event["id"] for event in student_events.data}
        self.assertIn(str(created[Event.Audience.STUDENT].id), student_ids)
        self.assertIn(str(created[Event.Audience.ALL].id), student_ids)
        self.assertNotIn(str(created[Event.Audience.FACULTY].id), student_ids)
        self.assertEqual(
            self.client.get(reverse("event-detail", args=[created[Event.Audience.FACULTY].id])).status_code,
            404,
        )

        self.client.force_authenticate(self.faculty)
        faculty_events = self.client.get(reverse("event-list"))
        faculty_ids = {event["id"] for event in faculty_events.data}
        self.assertIn(str(created[Event.Audience.FACULTY].id), faculty_ids)
        self.assertIn(str(created[Event.Audience.ALL].id), faculty_ids)
        self.assertNotIn(str(created[Event.Audience.STUDENT].id), faculty_ids)
        self.assertEqual(
            self.client.get(reverse("event-detail", args=[created[Event.Audience.STUDENT].id])).status_code,
            404,
        )

        self.client.force_authenticate(self.admin)
        admin_events = self.client.get(reverse("admin-event-list"))
        self.assertEqual(admin_events.status_code, 200)
        admin_ids = {event["id"] for event in admin_events.data}
        for event in created.values():
            self.assertIn(str(event.id), admin_ids)
        admin_directory = self.client.get(reverse("event-list"))
        self.assertEqual(admin_directory.status_code, 200)
        self.assertTrue(set(event["id"] for event in admin_directory.data).issuperset(admin_ids))

    def test_admin_event_create_rejects_missing_cutoff(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            reverse("admin-event-list"),
            {
                "name": "Missing cutoff",
                "date": (self.now + timedelta(days=1)).date().isoformat(),
                "start": "09:00",
                "end": "10:00",
                "venue": "Test Hall",
                "audience": Event.Audience.STUDENT,
                "method": Event.AttendanceMethod.QR,
                "status": Event.Status.PUBLISHED,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cutoff", response.data)

    def test_non_admin_cannot_access_admin_event_api(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(reverse("admin-event-list")).status_code, 403)
        self.assertEqual(
            self.client.post(reverse("admin-event-list"), {}, format="json").status_code,
            403,
        )

    def test_admin_event_update_and_cancel_persist(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            reverse("admin-event-detail", args=[self.event.id]),
            {"audience": Event.Audience.FACULTY, "venue": "Updated Hall"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.event.refresh_from_db()
        self.assertEqual(self.event.audience, Event.Audience.FACULTY)
        self.assertEqual(self.event.venue, "Updated Hall")
        response = self.client.post(
            reverse("admin-event-cancel", args=[self.event.id]), format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.Status.CANCELLED)

    def test_student_cannot_view_faculty_monitoring(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(reverse("managed-event-list")).status_code, 403)

    def test_history_contains_only_signed_in_user(self):
        EventAttendance.objects.create(
            event=self.event, attendee=self.student,
            status=EventAttendance.Status.PRESENT, method=self.event.attendance_method,
        )
        EventAttendance.objects.create(
            event=self.event, attendee=self.other_student,
            status=EventAttendance.Status.PRESENT, method=self.event.attendance_method,
        )
        self.client.force_authenticate(self.student)
        response = self.client.get(reverse("my-attendance"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["records"]), 1)
        self.assertEqual(response.data["records"][0]["eventId"], str(self.event.id))

    def test_profile_cannot_change_role(self):
        self.client.force_authenticate(self.student)
        response = self.client.patch(
            reverse("profile"), {"name": "New Name", "role": "admin"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.student.profile.role, UserProfile.Role.STUDENT)

    def test_registration_is_idempotent(self):
        event = self.make_event(self.faculty, registration=True)
        event.starts_at = self.now + timedelta(days=1)
        event.ends_at = self.now + timedelta(days=1, hours=2)
        event.save(update_fields=["starts_at", "ends_at"])
        self.client.force_authenticate(self.student)
        url = reverse("event-register", args=[event.id])
        self.assertEqual(self.client.post(url).status_code, 201)
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assertEqual(
            EventRegistration.objects.filter(event=event, attendee=self.student).count(),
            1,
        )

    def test_qr_scan_records_once_and_confirms_server_result(self):
        code = create_checkin_code(self.event, self.faculty)["token"]
        self.client.force_authenticate(self.student)
        url = reverse("attendance-scan")
        response = self.client.post(
            url, {"token": code, "method": "qr"}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["eventId"], str(self.event.id))
        duplicate = self.client.post(
            url, {"token": code, "method": "qr"}, format="json"
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_id_scan_rejects_another_users_identifier(self):
        event = self.make_event(
            self.faculty, method=Event.AttendanceMethod.RFID
        )
        self.client.force_authenticate(self.student)
        response = self.client.post(
            reverse("attendance-scan"),
            {
                "eventId": str(event.id),
                "identifier": "RFID-STU002",
                "method": "rfid",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            EventAttendance.objects.filter(event=event, attendee=self.student).exists()
        )

    def test_feedback_requires_attendance(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            reverse("event-feedback", args=[self.event.id]),
            {"rating": 5},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_feedback_is_associated_with_attended_event(self):
        EventAttendance.objects.create(
            event=self.event,
            attendee=self.student,
            status=EventAttendance.Status.PRESENT,
            method=self.event.attendance_method,
        )
        self.client.force_authenticate(self.student)
        url = reverse("event-feedback", args=[self.event.id])
        self.assertEqual(
            self.client.post(url, {"rating": 5, "comments": "Useful"}).status_code,
            201,
        )
        self.assertEqual(self.client.post(url, {"rating": 4}).status_code, 409)

    def test_faculty_monitoring_and_pdf_are_assignment_scoped(self):
        self.client.force_authenticate(self.faculty)
        self.assertEqual(
            self.client.get(reverse("event-attendance", args=[self.event.id])).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(reverse("event-attendance-pdf", args=[self.event.id])).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                reverse("event-attendance", args=[self.unauthorized_event.id])
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.get(
                reverse("event-attendance-pdf", args=[self.unauthorized_event.id])
            ).status_code,
            400,
        )

    def test_student_pdf_and_certificate_are_owner_scoped(self):
        certificate = EventCertificate.objects.create(
            event=self.event,
            student=self.student,
            issued_by=self.faculty,
            reference="REF-1",
        )
        self.client.force_authenticate(self.student)
        pdf_response = self.client.get(reverse("my-attendance-pdf"))
        self.assertTrue(pdf_response.content.startswith(b"%PDF"))
        self.assertEqual(
            self.client.get(reverse("certificate-pdf", args=[certificate.id])).status_code,
            200,
        )
        self.client.force_authenticate(self.other_student)
        self.assertEqual(
            self.client.get(reverse("certificate-pdf", args=[certificate.id])).status_code,
            404,
        )
