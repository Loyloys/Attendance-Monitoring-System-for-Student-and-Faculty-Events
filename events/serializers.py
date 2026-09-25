from collections.abc import Mapping

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from .models import Event, EventRegistration, UserProfile

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=150, trim_whitespace=True)
    password = serializers.CharField(max_length=1024, trim_whitespace=False)

    def validate(self, attrs):
        for field in ("identifier", "password"):
            if not isinstance(self.initial_data.get(field), str):
                raise serializers.ValidationError({field: "A string value is required."})
        return attrs

    def validate_identifier(self, value):
        value = value.strip()
        if not 3 <= len(value) <= 150:
            raise serializers.ValidationError("Enter a valid ID or username.")
        return value


class AuthUserSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="username")
    name = serializers.CharField(source="profile.display_name")
    role = serializers.CharField(source="profile.role")
    phone = serializers.CharField(source="profile.phone", allow_blank=True)
    department = serializers.CharField(source="profile.department", allow_blank=True)

    class Meta:
        model = User
        fields = ("id", "username", "email", "name", "role", "phone", "department")
        read_only_fields = fields


class ProfileUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)

    def validate(self, attrs):
        if not isinstance(self.initial_data, Mapping):
            raise serializers.ValidationError("Request body must be a JSON object.")
        protected = {"role", "username", "id", "department", "card_identifier"}
        supplied = protected.intersection(self.initial_data)
        if supplied:
            raise serializers.ValidationError(
                "Role, ID, department, and card assignments are administrator-managed."
            )
        if "name" in attrs:
            attrs["name"] = attrs["name"].strip()
            if not attrs["name"]:
                raise serializers.ValidationError({"name": "Name is required."})

        email = attrs.get("email")
        if email:
            request = self.context.get("request")
            users = User.objects.filter(email__iexact=email)
            if request and request.user.is_authenticated:
                users = users.exclude(pk=request.user.pk)
            if users.exists():
                raise serializers.ValidationError(
                    {"email": "This email address is already in use."}
                )
        return attrs


class AdminEventSerializer(serializers.ModelSerializer):
    date = serializers.SerializerMethodField()
    start = serializers.SerializerMethodField()
    end = serializers.SerializerMethodField()
    cutoff = serializers.SerializerMethodField()
    organizer = serializers.SerializerMethodField()
    origin = serializers.SerializerMethodField()
    audience = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    identifierRange = serializers.SerializerMethodField(method_name="get_identifier_range")
    method = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    requiredForAttendance = serializers.BooleanField(
        source="registration_required", read_only=True
    )
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = Event
        fields = (
            "id",
            "name",
            "description",
            "date",
            "start",
            "end",
            "venue",
            "organizer",
            "origin",
            "audience",
            "department",
            "method",
            "identifierRange",
            "cutoff",
            "status",
            "requiredForAttendance",
            "createdAt",
        )
        read_only_fields = fields

    @staticmethod
    def _local(value):
        return timezone.localtime(value)

    def get_date(self, event):
        return self._local(event.starts_at).date().isoformat()

    def get_start(self, event):
        return self._local(event.starts_at).strftime("%H:%M")

    def get_end(self, event):
        return self._local(event.ends_at).strftime("%H:%M")

    def get_cutoff(self, event):
        return self._local(event.late_cutoff).strftime("%H:%M")

    def get_organizer(self, event):
        profile = getattr(event.organizer, "profile", None)
        return profile.display_name if profile else event.organizer.get_username()

    def get_origin(self, event):
        profile = getattr(event.organizer, "profile", None)
        if profile and profile.role == UserProfile.Role.FACULTY:
            return "Faculty"
        return "Admin"

    def get_audience(self, event):
        return {
            Event.Audience.ALL: "All",
            Event.Audience.STUDENT: "Student",
            Event.Audience.FACULTY: "Faculty",
        }[event.audience]

    def get_department(self, event):
        profile = getattr(event.organizer, "profile", None)
        return profile.department if profile else ""

    def get_identifier_range(self, event):
        return "All active attendees" if event.audience == Event.Audience.ALL else (
            f"{event.audience.title()} audience"
        )

    def get_method(self, event):
        return {
            Event.AttendanceMethod.QR: "QR Code",
            Event.AttendanceMethod.BARCODE: "Barcode",
            Event.AttendanceMethod.RFID: "ID range",
        }[event.attendance_method]

    def get_status(self, event):
        if event.status == Event.Status.CANCELLED:
            return "Cancelled"
        return {
            "ongoing": "Ongoing",
            "completed": "Completed",
        }.get(event.effective_status, "Approved")


class AdminEventWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=180, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    date = serializers.DateField(required=False)
    start = serializers.TimeField(required=False)
    end = serializers.TimeField(required=False)
    venue = serializers.CharField(max_length=180, required=False)
    organizer = serializers.CharField(required=False, allow_blank=True)
    origin = serializers.ChoiceField(
        choices=("Admin", "Student organization", "Faculty"), required=False
    )
    audience = serializers.ChoiceField(choices=Event.Audience.choices, required=False)
    department = serializers.CharField(required=False, allow_blank=True)
    method = serializers.ChoiceField(
        choices=(
            Event.AttendanceMethod.QR,
            Event.AttendanceMethod.BARCODE,
            Event.AttendanceMethod.RFID,
        ),
        required=False,
    )
    identifierRange = serializers.CharField(required=False, allow_blank=True)
    cutoff = serializers.TimeField(required=False)
    status = serializers.ChoiceField(
        choices=Event.Status.choices, required=False
    )
    requiredForAttendance = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not isinstance(self.initial_data, Mapping):
            raise serializers.ValidationError("Request body must be a JSON object.")
        if not self.partial:
            required = (
                "name",
                "date",
                "start",
                "end",
                "cutoff",
                "venue",
                "audience",
                "method",
                "status",
            )
            missing = [field for field in required if field not in attrs]
            if missing:
                raise serializers.ValidationError(
                    {field: "This field is required." for field in missing}
                )
        if "start" in attrs and "end" in attrs and attrs["end"] <= attrs["start"]:
            raise serializers.ValidationError(
                {"end": "End time must be later than start time."}
            )
        return attrs


class EventContextSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)
    start_time = serializers.DateTimeField(source="starts_at", read_only=True)
    end_time = serializers.DateTimeField(source="ends_at", read_only=True)
    organizer_name = serializers.CharField(
        source="organizer.profile.display_name", read_only=True
    )
    status = serializers.SerializerMethodField()
    registration_status = serializers.SerializerMethodField()
    attendance_status = serializers.SerializerMethodField()
    feedback_submitted = serializers.SerializerMethodField()
    certificate_id = serializers.SerializerMethodField()
    can_register = serializers.SerializerMethodField()
    can_check_in = serializers.SerializerMethodField()
    is_organizer = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = (
            "id",
            "name",
            "description",
            "starts_at",
            "ends_at",
            "start_time",
            "end_time",
            "venue",
            "audience",
            "organizer_name",
            "status",
            "registration_required",
            "registration_deadline",
            "registration_status",
            "can_register",
            "attendance_status",
            "can_check_in",
            "feedback_submitted",
            "certificate_id",
            "check_in_opens_at",
            "check_in_closes_at",
            "late_cutoff",
            "attendance_method",
            "is_organizer",
        )

    def get_status(self, event):
        return event.effective_status

    def _registration(self, event):
        return event.registrations.filter(
            attendee=self.context["request"].user,
            status=EventRegistration.Status.REGISTERED,
        ).first()

    def _attendance(self, event):
        return event.attendance.filter(attendee=self.context["request"].user).first()

    def get_registration_status(self, event):
        if self._registration(event):
            return "registered"
        if event.registration_required:
            return "required"
        return "not_required"

    def get_attendance_status(self, event):
        record = self._attendance(event)
        return record.status if record else None

    def get_feedback_submitted(self, event):
        return event.feedback.filter(attendee=self.context["request"].user).exists()

    def get_certificate_id(self, event):
        user = self.context["request"].user
        if user.profile.role != UserProfile.Role.STUDENT:
            return None
        certificate = event.certificates.filter(student=user).first()
        return str(certificate.id) if certificate else None

    def get_can_register(self, event):
        user = self.context["request"].user
        now = timezone.now()
        return bool(
            user.profile.role == UserProfile.Role.STUDENT
            and event.registration_required
            and event.effective_status == "upcoming"
            and (not event.registration_deadline or now <= event.registration_deadline)
            and not self._registration(event)
        )

    def get_can_check_in(self, event):
        user = self.context["request"].user
        registration_ok = (
            not event.registration_required
            or user.profile.role != UserProfile.Role.STUDENT
            or self._registration(event) is not None
        )
        return bool(
            event.allows(user)
            and event.is_check_in_open()
            and registration_ok
            and not self._attendance(event)
        )

    def get_is_organizer(self, event):
        return event.is_supervisor(self.context["request"].user)
