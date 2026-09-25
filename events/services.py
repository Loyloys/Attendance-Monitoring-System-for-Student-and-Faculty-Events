import hashlib
import secrets
import uuid
from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from .models import (
    AttendanceCode,
    Event,
    EventAttendance,
    EventRegistration,
    UserProfile,
)

QR_PREFIX = "COT-EVENT"


class DuplicateAttendance(APIException):
    status_code = 409
    default_detail = "Attendance is already recorded for this event."
    default_code = "duplicate_attendance"


def require_role(user, *roles):
    if not user.is_authenticated or user.profile.role not in roles:
        raise PermissionDenied("This action is not available for your role.")


def event_queryset_for_user(user):
    require_role(user, UserProfile.Role.STUDENT, UserProfile.Role.FACULTY)
    return (
        Event.objects.filter(
            Q(audience=Event.Audience.ALL) | Q(audience=user.profile.role),
            status=Event.Status.PUBLISHED,
        )
        .select_related("organizer__profile")
        .prefetch_related("supervisors", "registrations", "attendance", "feedback")
        .distinct()
    )


def managed_event_queryset(user):
    require_role(user, UserProfile.Role.FACULTY)
    return (
        Event.objects.filter(Q(organizer=user) | Q(supervisors=user))
        .select_related("organizer__profile")
        .prefetch_related("supervisors", "registrations", "attendance")
        .distinct()
    )


def get_managed_event(user, event_id):
    try:
        event = managed_event_queryset(user).get(pk=event_id)
    except (Event.DoesNotExist, ValueError, DjangoValidationError):
        raise ValidationError({"event": "Event not found or not assigned to you."})
    return event


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_checkin_code(event, faculty_user):
    if not event.is_supervisor(faculty_user):
        raise PermissionDenied("Only assigned faculty can generate this event code.")
    if event.attendance_method != Event.AttendanceMethod.QR:
        raise ValidationError({"event": "This event does not use QR check-in."})
    if not event.is_check_in_open():
        raise ValidationError({"event": "The event check-in window is not open."})

    now = timezone.now()
    expires_at = min(event.check_in_closes_at, now + timedelta(hours=1))
    AttendanceCode.objects.filter(event=event, active=True).update(active=False)
    secret = secrets.token_urlsafe(32)
    AttendanceCode.objects.create(
        event=event,
        created_by=faculty_user,
        token_hash=token_hash(secret),
        expires_at=expires_at,
    )
    return {
        "token": f"{QR_PREFIX}:{event.pk}:{secret}",
        "expiresAt": expires_at.isoformat(),
    }


def identifier_matches_user(user, identifier):
    if not identifier:
        return False
    supplied = identifier.strip().casefold()
    accepted = {
        user.username.casefold(),
        user.email.casefold(),
        (user.profile.card_identifier or "").casefold(),
    }
    return bool(supplied and supplied in accepted)


def resolve_scanned_event(raw_token, event_id, user):
    if raw_token:
        parts = raw_token.strip().split(":")
        if len(parts) != 3 or parts[0] != QR_PREFIX:
            raise ValidationError({"scan": "Invalid event QR code."})
        try:
            scanned_event_id = uuid.UUID(parts[1])
        except ValueError:
            raise ValidationError({"scan": "Invalid event QR code."})
        event = event_queryset_for_user(user).filter(pk=scanned_event_id).first()
        if not event:
            raise ValidationError({"scan": "This event is not available to your account."})
        code = AttendanceCode.objects.filter(
            event=event,
            token_hash=token_hash(parts[2]),
            active=True,
            expires_at__gt=timezone.now(),
        ).first()
        if not code:
            raise ValidationError({"scan": "This event QR code is invalid or expired."})
        return event

    if not event_id:
        raise ValidationError({"event": "Select the event being scanned."})
    event = event_queryset_for_user(user).filter(pk=event_id).first()
    if not event:
        raise ValidationError({"event": "Event not found or not available to your account."})
    return event


def record_event_attendance(user, *, token=None, event_id=None, identifier=None, method=None):
    require_role(user, UserProfile.Role.STUDENT, UserProfile.Role.FACULTY)
    if method not in Event.AttendanceMethod.values:
        raise ValidationError({"method": "Choose a supported event attendance method."})

    event = resolve_scanned_event(token, event_id, user)
    if event.attendance_method != method:
        raise ValidationError({"method": "This scan method is not enabled for the event."})
    if not event.allows(user):
        raise PermissionDenied("You are not allowed to attend this event.")
    if not event.is_check_in_open():
        raise ValidationError({"scan": "The event check-in window is closed."})
    if method != Event.AttendanceMethod.QR and not identifier_matches_user(user, identifier):
        raise PermissionDenied("The scanned ID does not belong to your account.")
    if (
        event.registration_required
        and user.profile.role == UserProfile.Role.STUDENT
        and not EventRegistration.objects.filter(
            event=event,
            attendee=user,
            status=EventRegistration.Status.REGISTERED,
        ).exists()
    ):
        raise ValidationError({"registration": "Register for this event before checking in."})

    now = timezone.now()
    status = (
        EventAttendance.Status.LATE
        if now > event.late_cutoff
        else EventAttendance.Status.PRESENT
    )
    with transaction.atomic():
        locked_event = Event.objects.select_for_update().get(pk=event.pk)
        if EventAttendance.objects.filter(event=locked_event, attendee=user).exists():
            raise DuplicateAttendance()
        try:
            record = EventAttendance.objects.create(
                event=locked_event,
                attendee=user,
                status=status,
                method=method,
                recorded_at=now,
            )
        except IntegrityError:
            raise DuplicateAttendance()
    return record

