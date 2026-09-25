from django.http import HttpResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import EventAttendance, EventCertificate, EventRegistration
from .pdf import build_simple_pdf
from .services import get_managed_event, require_role


def _pdf_response(content, filename):
    response = HttpResponse(content, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _summary(records, expected=0):
    present = sum(record.status == EventAttendance.Status.PRESENT for record in records)
    late = sum(record.status == EventAttendance.Status.LATE for record in records)
    explicit_absent = sum(
        record.status == EventAttendance.Status.ABSENT for record in records
    )
    attended = len({record.attendee_id for record in records if record.status != EventAttendance.Status.ABSENT})
    absent = max(explicit_absent, max(0, expected - attended))
    total = max(len(records), expected)
    return {
        "present": present,
        "late": late,
        "absent": absent,
        "total": total,
    }


@api_view(["GET"])
def my_attendance_pdf(request):
    require_role(request.user, "student", "faculty")
    records = list(
        EventAttendance.objects.filter(attendee=request.user)
        .select_related("event")
        .order_by("-event__starts_at")
    )
    summary = _summary(records)
    total_attended = summary["present"] + summary["late"]
    denominator = total_attended + summary["absent"]
    percentage = round(total_attended * 100 / denominator) if denominator else 0
    rows = [
        [
            record.event.name,
            record.event.starts_at.strftime("%Y-%m-%d %H:%M"),
            record.status.title(),
            record.get_method_display(),
        ]
        for record in records
    ]
    content = build_simple_pdf(
        "Personal Event Attendance Report",
        f"{request.user.profile.display_name} ({request.user.username})",
        f"Attendance percentage: {percentage}% | Records: {len(records)}",
        [("Event", 30), ("Date and time", 17), ("Status", 10), ("Method", 12)],
        rows,
    )
    return _pdf_response(content, "personal-event-attendance.pdf")


@api_view(["GET"])
def event_attendance_pdf(request, event_id):
    require_role(request.user, "faculty")
    event = get_managed_event(request.user, event_id)
    records = list(
        event.attendance.select_related("attendee__profile").order_by("attendee__profile__display_name")
    )
    expected = event.registrations.filter(
        status=EventRegistration.Status.REGISTERED,
        attendee__profile__role="student",
    ).count()
    summary = _summary(records, expected)
    rows = [
        [
            record.attendee.profile.display_name,
            record.attendee.username,
            record.attendee.profile.role.title(),
            record.status.title(),
            record.recorded_at.strftime("%Y-%m-%d %H:%M"),
        ]
        for record in records
    ]
    content = build_simple_pdf(
        "Authorized Event Attendance Report",
        event.name,
        f"Present: {summary['present']} | Late: {summary['late']} | Absent: {summary['absent']} | Total: {summary['total']}",
        [("Attendee", 25), ("ID", 12), ("Role", 10), ("Status", 10), ("Recorded", 18)],
        rows,
    )
    return _pdf_response(content, "event-attendance-report.pdf")


@api_view(["GET"])
def certificate_pdf(request, certificate_id):
    require_role(request.user, "student")
    try:
        certificate = EventCertificate.objects.select_related("event").get(
            pk=certificate_id, student=request.user
        )
    except EventCertificate.DoesNotExist:
        return Response({"detail": "Certificate not found."}, status=404)
    content = build_simple_pdf(
        "Event Participation Certificate",
        certificate.event.name,
        f"This certificate is issued to {request.user.profile.display_name} ({request.user.username}).",
        [("Reference", 22), ("Event date", 18), ("Organizer", 28)],
        [[
            certificate.reference,
            certificate.event.starts_at.strftime("%Y-%m-%d"),
            certificate.event.organizer.profile.display_name,
        ]],
    )
    return _pdf_response(content, "event-participation-certificate.pdf")
