import os
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from events.models import (
    Event,
    EventAttendance,
    EventCertificate,
    EventRegistration,
    UserProfile,
)

User = get_user_model()
DEMO_EVENT_IDS = [
    uuid.UUID("11111111-1111-4111-8111-111111111111"),
    uuid.UUID("22222222-2222-4222-8222-222222222222"),
    uuid.UUID("33333333-3333-4333-8333-333333333333"),
    uuid.UUID("44444444-4444-4444-8444-444444444444"),
]


class Command(BaseCommand):
    help = "Create development users and event-attendance workflow data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Clear demo event-attendance records first.",
        )

    def account(self, username, email, name, role, department, password, card=None):
        user, _ = User.objects.update_or_create(
            username=username,
            defaults={"email": email, "is_active": True},
        )
        user.set_password(password)
        user.save(update_fields=["password"])
        UserProfile.objects.update_or_create(
            user=user,
            defaults={
                "role": role,
                "display_name": name,
                "department": department,
                "card_identifier": card,
            },
        )
        return user

    def handle(self, *args, **options):
        now = timezone.now()
        if options["reset"]:
            EventAttendance.objects.filter(event_id__in=DEMO_EVENT_IDS).delete()
            EventRegistration.objects.filter(event_id__in=DEMO_EVENT_IDS).delete()
            EventCertificate.objects.filter(event_id__in=DEMO_EVENT_IDS).delete()
            Event.objects.filter(pk__in=DEMO_EVENT_IDS[3:]).delete()

        student = self.account(
            "STU001", "student@cot.edu", "Alice Johnson", UserProfile.Role.STUDENT,
            "Information Technology", os.getenv("DEMO_STUDENT_PASSWORD", "student123"), "RFID-STU001",
        )
        second_student = self.account(
            "STU002", "bob.smith@cot.edu", "Bob Smith", UserProfile.Role.STUDENT,
            "Information Technology", "student123", "BARCODE-STU002",
        )
        faculty = self.account(
            "FAC001", "faculty@cot.edu", "Dr. Sarah Johnson", UserProfile.Role.FACULTY,
            "College of Technologies", os.getenv("DEMO_FACULTY_PASSWORD", "faculty123"), "RFID-FAC001",
        )
        other_faculty = self.account(
            "FAC002", "michael@cot.edu", "Prof. Michael Brown", UserProfile.Role.FACULTY,
            "College of Technologies", "faculty123", "RFID-FAC002",
        )
        admin = self.account(
            "ADM001", "admin@cot.edu", "System Administrator", UserProfile.Role.ADMIN,
            "Administration", "admin123",
        )
        admin.is_staff = admin.is_superuser = True
        admin.save(update_fields=["is_staff", "is_superuser"])

        common = {
            "description": "Development data for the COT event-attendance workflow.",
            "status": Event.Status.PUBLISHED,
            "organizer": faculty,
        }
        ongoing, _ = Event.objects.update_or_create(
            id=DEMO_EVENT_IDS[0],
            defaults={
                **common,
                "name": "Technology Innovation Summit",
                "starts_at": now - timedelta(hours=1),
                "ends_at": now + timedelta(hours=3),
                "venue": "Innovation Hall",
                "audience": Event.Audience.ALL,
                "registration_required": False,
                "check_in_opens_at": now - timedelta(minutes=30),
                "check_in_closes_at": now + timedelta(hours=2),
                "late_cutoff": now + timedelta(minutes=15),
                "attendance_method": Event.AttendanceMethod.QR,
            },
        )
        upcoming, _ = Event.objects.update_or_create(
            id=DEMO_EVENT_IDS[1],
            defaults={
                **common,
                "name": "Student Developers Meetup",
                "starts_at": now + timedelta(days=1),
                "ends_at": now + timedelta(days=1, hours=3),
                "venue": "Innovation Lab 2",
                "audience": Event.Audience.STUDENT,
                "registration_required": True,
                "registration_deadline": now + timedelta(hours=18),
                "check_in_opens_at": now + timedelta(days=1) - timedelta(minutes=15),
                "check_in_closes_at": now + timedelta(days=1, hours=3),
                "late_cutoff": now + timedelta(days=1, minutes=15),
                "attendance_method": Event.AttendanceMethod.BARCODE,
            },
        )
        completed, _ = Event.objects.update_or_create(
            id=DEMO_EVENT_IDS[2],
            defaults={
                **common,
                "name": "COT Faculty Research Colloquium",
                "starts_at": now - timedelta(days=2),
                "ends_at": now - timedelta(days=2) + timedelta(hours=3),
                "venue": "COT Conference Room",
                "audience": Event.Audience.ALL,
                "registration_required": False,
                "check_in_opens_at": now - timedelta(days=2) - timedelta(minutes=15),
                "check_in_closes_at": now - timedelta(days=2) + timedelta(hours=3),
                "late_cutoff": now - timedelta(days=2) + timedelta(minutes=15),
                "attendance_method": Event.AttendanceMethod.RFID,
            },
        )
        Event.objects.update_or_create(
            id=DEMO_EVENT_IDS[3],
            defaults={
                **common,
                "organizer": other_faculty,
                "name": "Unauthorized Faculty Briefing",
                "starts_at": now + timedelta(days=2),
                "ends_at": now + timedelta(days=2, hours=2),
                "venue": "Board Room",
                "audience": Event.Audience.FACULTY,
                "registration_required": False,
                "check_in_opens_at": now + timedelta(days=2) - timedelta(minutes=15),
                "check_in_closes_at": now + timedelta(days=2, hours=2),
                "late_cutoff": now + timedelta(days=2, minutes=15),
                "attendance_method": Event.AttendanceMethod.QR,
            },
        )
        ongoing.supervisors.add(faculty)
        EventRegistration.objects.get_or_create(
            event=upcoming,
            attendee=student,
            defaults={"status": EventRegistration.Status.REGISTERED},
        )
        EventAttendance.objects.get_or_create(
            event=completed,
            attendee=student,
            defaults={
                "status": EventAttendance.Status.PRESENT,
                "method": completed.attendance_method,
                "recorded_at": completed.starts_at,
            },
        )
        EventAttendance.objects.get_or_create(
            event=completed,
            attendee=second_student,
            defaults={
                "status": EventAttendance.Status.LATE,
                "method": completed.attendance_method,
                "recorded_at": completed.late_cutoff,
            },
        )
        EventAttendance.objects.get_or_create(
            event=completed,
            attendee=faculty,
            defaults={
                "status": EventAttendance.Status.PRESENT,
                "method": completed.attendance_method,
                "recorded_at": completed.starts_at,
            },
        )
        EventCertificate.objects.get_or_create(
            event=completed,
            student=student,
            defaults={
                "issued_by": faculty,
                "reference": "COT-EVT-111-STU001",
                "message": "Awarded for participation and contribution.",
            },
        )
        self.stdout.write(self.style.SUCCESS("Event-attendance demo data is ready."))
        self.stdout.write("Student: STU001 / configured DEMO_STUDENT_PASSWORD")
        self.stdout.write("Faculty: FAC001 / configured DEMO_FACULTY_PASSWORD")
        self.stdout.write("Admin: ADM001 / admin123 (development only)")
