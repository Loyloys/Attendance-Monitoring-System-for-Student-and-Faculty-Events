from django.urls import path

from . import auth_views, admin_event_views, event_views, report_views

urlpatterns = [
    path("auth/csrf/", auth_views.csrf, name="auth-csrf"),
    path("auth/login/", auth_views.login_view, name="auth-login"),
    path("auth/logout/", auth_views.logout_view, name="auth-logout"),
    path("auth/me/", auth_views.me, name="auth-me"),
    path("profile/", auth_views.profile, name="profile"),
    path("admin/events/", admin_event_views.event_list, name="admin-event-list"),
    path("admin/events/<uuid:event_id>/", admin_event_views.event_detail, name="admin-event-detail"),
    path("admin/events/<uuid:event_id>/cancel/", admin_event_views.cancel_event, name="admin-event-cancel"),
    path("events/", event_views.event_list, name="event-list"),
    path("events/managed/", event_views.managed_event_list, name="managed-event-list"),
    path("events/<uuid:event_id>/", event_views.event_detail, name="event-detail"),
    path("events/<uuid:event_id>/registrations/", event_views.register_event, name="event-register"),
    path("events/<uuid:event_id>/check-in-code/", event_views.check_in_code, name="event-check-in-code"),
    path("events/<uuid:event_id>/attendance/", event_views.event_attendance, name="event-attendance"),
    path("events/<uuid:event_id>/feedback/", event_views.submit_feedback, name="event-feedback"),
    path("attendance/scan/", event_views.scan_attendance, name="attendance-scan"),
    path("attendance/me/", event_views.my_attendance, name="my-attendance"),
    path("reports/me.pdf", report_views.my_attendance_pdf, name="my-attendance-pdf"),
    path("reports/events/<uuid:event_id>.pdf", report_views.event_attendance_pdf, name="event-attendance-pdf"),
    path("certificates/<int:certificate_id>/download/", report_views.certificate_pdf, name="certificate-pdf"),
]
