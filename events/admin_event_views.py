from datetime import datetime, timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from .models import Event, UserProfile
from .serializers import AdminEventSerializer, AdminEventWriteSerializer
from .services import admin_event_queryset, require_role


def _event_datetime(date_value, time_value):
    return timezone.make_aware(
        datetime.combine(date_value, time_value), timezone.get_current_timezone()
    )


def _event_values(data, user, event=None):
    current_start = timezone.localtime(event.starts_at) if event else None
    current_end = timezone.localtime(event.ends_at) if event else None
    current_cutoff = timezone.localtime(event.late_cutoff) if event else None

    date_value = data.get("date", current_start.date() if current_start else None)
    start_value = data.get("start", current_start.time().replace(tzinfo=None) if current_start else None)
    end_value = data.get("end", current_end.time().replace(tzinfo=None) if current_end else None)
    cutoff_value = data.get("cutoff", current_cutoff.time().replace(tzinfo=None) if current_cutoff else None)
    starts_at = _event_datetime(date_value, start_value)
    ends_at = _event_datetime(date_value, end_value)
    if ends_at <= starts_at:
        raise ValidationError({"end": "End time must be later than start time."})

    values = {
        "name": data.get("name", event.name if event else "").strip(),
        "description": data.get("description", event.description if event else "").strip(),
        "starts_at": starts_at,
        "ends_at": ends_at,
        "venue": data.get("venue", event.venue if event else "").strip(),
        "audience": data.get("audience", event.audience if event else Event.Audience.ALL),
        "status": data.get("status", event.status if event else Event.Status.PUBLISHED),
        "late_cutoff": _event_datetime(date_value, cutoff_value),
        "attendance_method": data.get(
            "method", event.attendance_method if event else Event.AttendanceMethod.QR
        ),
        "registration_required": data.get(
            "requiredForAttendance", event.registration_required if event else False
        ),
    }
    if event is None:
        values.update(
            organizer=user,
            check_in_opens_at=starts_at - timedelta(minutes=30),
            check_in_closes_at=ends_at,
            registration_deadline=None,
        )
    elif any(field in data for field in ("date", "start", "end")):
        values.update(
            check_in_opens_at=starts_at - timedelta(minutes=30),
            check_in_closes_at=ends_at,
        )
    return values


def _get_event(event_id):
    try:
        return admin_event_queryset().get(pk=event_id)
    except (Event.DoesNotExist, ValueError, DjangoValidationError):
        raise NotFound("Event not found.")


@api_view(["GET", "POST"])
def event_list(request):
    require_role(request.user, UserProfile.Role.ADMIN)
    if request.method == "GET":
        events = admin_event_queryset().order_by("-starts_at", "name")
        return Response(AdminEventSerializer(events, many=True).data)

    serializer = AdminEventWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        with transaction.atomic():
            event = Event(**_event_values(serializer.validated_data, request.user))
            event.full_clean()
            event.save()
    except DjangoValidationError as error:
        raise ValidationError(error.message_dict)
    return Response(AdminEventSerializer(event).data, status=201)


@api_view(["GET", "PATCH"])
def event_detail(request, event_id):
    require_role(request.user, UserProfile.Role.ADMIN)
    event = _get_event(event_id)
    if request.method == "PATCH":
        serializer = AdminEventWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                for field, value in _event_values(serializer.validated_data, request.user, event).items():
                    setattr(event, field, value)
                event.full_clean()
                event.save()
        except DjangoValidationError as error:
            raise ValidationError(error.message_dict)
    return Response(AdminEventSerializer(event).data)


@api_view(["POST"])
def cancel_event(request, event_id):
    require_role(request.user, UserProfile.Role.ADMIN)
    event = _get_event(event_id)
    event.status = Event.Status.CANCELLED
    event.save(update_fields=["status"])
    return Response(AdminEventSerializer(event).data)
