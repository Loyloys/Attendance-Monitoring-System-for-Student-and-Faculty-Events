from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from .models import Event, EventRegistration, UserProfile

User = get_user_model()


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
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)

    def validate(self, attrs):
        protected = {"role", "username", "id", "department", "card_identifier"}
        supplied = protected.intersection(self.initial_data)
        if supplied:
            raise serializers.ValidationError(
                "Role, ID, department, and card assignments are administrator-managed."
            )
        attrs["name"] = attrs["name"].strip()
        if not attrs["name"]:
            raise serializers.ValidationError({"name": "Name is required."})
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
