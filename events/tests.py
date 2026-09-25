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
