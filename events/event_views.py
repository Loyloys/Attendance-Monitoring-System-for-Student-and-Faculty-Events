from django.db import IntegrityError
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import Event, EventAttendance, EventFeedback, EventRegistration
from .serializers import EventContextSerializer
from .services import (
    DuplicateAttendance,
    create_checkin_code,
    event_queryset_for_user,
    get_managed_event,
    managed_event_queryset,
    record_event_attendance,
    require_role,
)


@api_view(["GET"])
def event_list(request):
    events = event_queryset_for_user(request.user)
    return Response(EventContextSerializer(events, many=True, context={"request": request}).data)


@api_view(["GET"])
def managed_event_list(request):
    events = managed_event_queryset(request.user)
    return Response(EventContextSerializer(events, many=True, context={"request": request}).data)


@api_view(["POST"])
def check_in_code(request, event_id):
    require_role(request.user, "faculty")
    event = get_managed_event(request.user, event_id)
    return Response(create_checkin_code(event, request.user))


@api_view(["POST"])
def scan_attendance(request):
    record = record_event_attendance(
        request.user,
        token=request.data.get("token"),
        event_id=request.data.get("eventId"),
        identifier=request.data.get("identifier"),
        method=request.data.get("method"),
    )
    event = record.event
    return Response(
        {
            "attendanceId": record.id,
            "eventId": str(event.id),
            "eventName": event.name,
            "eventDate": event.starts_at.isoformat(),
            "eventTime": f"{event.starts_at:%H:%M} - {event.ends_at:%H:%M}",
            "status": record.status,
            "method": record.method,
            "recordedAt": record.recorded_at.isoformat(),
            "message": "Your event attendance was recorded successfully.",
        },
        status=201,
    )


@api_view(["POST"])
def register_event(request, event_id):
    require_role(request.user, "student")
    event = event_queryset_for_user(request.user).filter(pk=event_id).first()
    if not event:
        raise ValidationError({"event": "Event not found."})
    if not event.registration_required:
        raise ValidationError({"event": "This event does not require registration."})
    if event.effective_status != "upcoming":
        raise ValidationError({"event": "Registration is closed for this event."})
    if event.registration_deadline and timezone.now() > event.registration_deadline:
        raise ValidationError({"event": "The registration deadline has passed."})

    registration, created = EventRegistration.objects.get_or_create(
        event=event,
        attendee=request.user,
        defaults={"status": EventRegistration.Status.REGISTERED},
    )
    if not created and registration.status != EventRegistration.Status.REGISTERED:
        registration.status = EventRegistration.Status.REGISTERED
        registration.save(update_fields=["status"])
        created = True
    return Response(
        {
            "registered": True,
            "created": created,
            "message": "Registration confirmed."
            if created
            else "You are already registered for this event.",
        },
        status=201 if created else 200,
    )


@api_view(["GET"])
def my_attendance(request):
    require_role(request.user, "student", "faculty")
    records = list(
        EventAttendance.objects.filter(attendee=request.user)
        .select_related("event", "attendee__profile")
        .order_by("-event__starts_at")
    )
    present = sum(record.status == EventAttendance.Status.PRESENT for record in records)
    late = sum(record.status == EventAttendance.Status.LATE for record in records)
    absent = sum(record.status == EventAttendance.Status.ABSENT for record in records)
    denominator = present + late + absent
    percentage = round((present + late) * 100 / denominator) if denominator else 0
    return Response(
        {
            "summary": {
                "present": present,
                "late": late,
                "absent": absent,
                "attendancePercentage": percentage,
            },
            "records": [
                {
                    "id": record.id,
                    "eventId": str(record.event.id),
                    "eventName": record.event.name,
                    "eventDate": record.event.starts_at.isoformat(),
                    "status": record.status,
                    "method": record.method,
                    "recordedAt": record.recorded_at.isoformat(),
                }
                for record in records
            ],
        }
    )


@api_view(["GET"])
def event_attendance(request, event_id):
    require_role(request.user, "faculty")
    event = get_managed_event(request.user, event_id)
    records = list(
        event.attendance.select_related("attendee__profile").order_by(
            "attendee__profile__display_name"
        )
    )
    expected = event.registrations.filter(
        status=EventRegistration.Status.REGISTERED,
        attendee__profile__role="student",
    ).count()
    present = sum(record.status == EventAttendance.Status.PRESENT for record in records)
    late = sum(record.status == EventAttendance.Status.LATE for record in records)
    explicit_absent = sum(
        record.status == EventAttendance.Status.ABSENT for record in records
    )
    attended = len(
        {
            record.attendee_id
            for record in records
            if record.status != EventAttendance.Status.ABSENT
        }
    )
    absent = max(explicit_absent, max(0, expected - attended))
    return Response(
        {
            "event": {"id": str(event.id), "name": event.name, "venue": event.venue},
            "summary": {
                "present": present,
                "late": late,
                "absent": absent,
                "total": max(len(records), expected),
                "registered": expected,
            },
            "attendees": [
                {
                    "id": record.attendee.username,
                    "name": record.attendee.profile.display_name,
                    "role": record.attendee.profile.role,
                    "status": record.status,
                    "method": record.method,
                    "recordedAt": record.recorded_at.isoformat(),
                }
                for record in records
            ],
        }
    )


@api_view(["POST"])
def submit_feedback(request, event_id):
    require_role(request.user, "student", "faculty")
    event = event_queryset_for_user(request.user).filter(pk=event_id).first()
    if not event:
        raise ValidationError({"event": "Event not found."})
    attendance = EventAttendance.objects.filter(
        event=event, attendee=request.user
    ).first()
    if not attendance or attendance.status == EventAttendance.Status.ABSENT:
        raise ValidationError(
            {"feedback": "Feedback is available only after event attendance."}
        )
    try:
        rating = int(request.data.get("rating", 0))
    except (TypeError, ValueError):
        rating = 0
    if rating < 1 or rating > 5:
        raise ValidationError({"rating": "Choose a rating from 1 to 5."})
    try:
        feedback = EventFeedback.objects.create(
            event=event,
            attendee=request.user,
            rating=rating,
            comments=str(request.data.get("comments", "")).strip()[:2000],
        )
    except IntegrityError:
        return Response(
            {"detail": "Feedback was already submitted for this event."}, status=409
        )
    return Response(
        {"id": feedback.id, "message": "Thank you. Your event feedback was submitted."},
        status=201,
    )

