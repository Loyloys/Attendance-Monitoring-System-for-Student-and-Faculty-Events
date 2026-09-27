import uuid

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="UserProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("student", "Student"), ("faculty", "Faculty"), ("admin", "Administrator")], max_length=16)),
                ("display_name", models.CharField(max_length=150)),
                ("phone", models.CharField(blank=True, max_length=40)),
                ("department", models.CharField(blank=True, max_length=150)),
                ("card_identifier", models.CharField(blank=True, max_length=120, null=True, unique=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="profile", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="Event",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=180)),
                ("description", models.TextField(blank=True)),
                ("starts_at", models.DateTimeField()),
                ("ends_at", models.DateTimeField()),
                ("venue", models.CharField(max_length=180)),
                ("audience", models.CharField(choices=[("all", "Students and faculty"), ("student", "Students"), ("faculty", "Faculty")], default="all", max_length=16)),
                ("status", models.CharField(choices=[("published", "Published"), ("cancelled", "Cancelled")], default="published", max_length=16)),
                ("registration_required", models.BooleanField(default=False)),
                ("registration_deadline", models.DateTimeField(blank=True, null=True)),
                ("check_in_opens_at", models.DateTimeField()),
                ("check_in_closes_at", models.DateTimeField()),
                ("late_cutoff", models.DateTimeField()),
                ("attendance_method", models.CharField(choices=[("qr", "QR code"), ("barcode", "Barcode"), ("rfid", "RFID or ID card")], max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("organizer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="organized_events", to=settings.AUTH_USER_MODEL)),
                ("supervisors", models.ManyToManyField(blank=True, related_name="supervised_events", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("starts_at", "name")},
        ),
        migrations.AddConstraint(
            model_name="event",
            constraint=models.CheckConstraint(condition=models.Q(("ends_at__gt", models.F("starts_at"))), name="event_ends_after_start"),
        ),
        migrations.AddConstraint(
            model_name="event",
            constraint=models.CheckConstraint(condition=models.Q(("check_in_closes_at__gt", models.F("check_in_opens_at"))), name="event_check_in_window_valid"),
        ),
        migrations.CreateModel(
            name="EventRegistration",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("registered", "Registered"), ("cancelled", "Cancelled")], max_length=16)),
                ("registered_at", models.DateTimeField(auto_now_add=True)),
                ("attendee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="event_registrations", to=settings.AUTH_USER_MODEL)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="registrations", to="events.event")),
            ],
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.UniqueConstraint(fields=("event", "attendee"), name="unique_event_registration"),
        ),
        migrations.CreateModel(
            name="EventAttendance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("present", "Present"), ("late", "Late"), ("absent", "Absent")], max_length=12)),
                ("method", models.CharField(choices=[("qr", "QR code"), ("barcode", "Barcode"), ("rfid", "RFID or ID card")], max_length=16)),
                ("recorded_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("attendee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="event_attendance", to=settings.AUTH_USER_MODEL)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="attendance", to="events.event")),
            ],
            options={"ordering": ("-recorded_at",)},
        ),
        migrations.AddConstraint(
            model_name="eventattendance",
            constraint=models.UniqueConstraint(fields=("event", "attendee"), name="unique_event_attendance"),
        ),
        migrations.CreateModel(
            name="EventFeedback",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("rating", models.PositiveSmallIntegerField(validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(5)])),
                ("comments", models.TextField(blank=True, max_length=2000)),
                ("submitted_at", models.DateTimeField(auto_now_add=True)),
                ("attendee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="event_feedback", to=settings.AUTH_USER_MODEL)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="feedback", to="events.event")),
            ],
        ),
        migrations.AddConstraint(
            model_name="eventfeedback",
            constraint=models.UniqueConstraint(fields=("event", "attendee"), name="unique_event_feedback"),
        ),
        migrations.CreateModel(
            name="EventCertificate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reference", models.CharField(max_length=80, unique=True)),
                ("message", models.CharField(blank=True, max_length=240)),
                ("issued_at", models.DateTimeField(auto_now_add=True)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="certificates", to="events.event")),
                ("issued_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="issued_event_certificates", to=settings.AUTH_USER_MODEL)),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="event_certificates", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name="eventcertificate",
            constraint=models.UniqueConstraint(fields=("event", "student"), name="unique_event_certificate"),
        ),
        migrations.CreateModel(
            name="AttendanceCode",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("expires_at", models.DateTimeField()),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="created_attendance_codes", to=settings.AUTH_USER_MODEL)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="attendance_codes", to="events.event")),
            ],
        ),
    ]
