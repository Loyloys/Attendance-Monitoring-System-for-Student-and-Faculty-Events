from django.contrib import admin

from .models import (
    AttendanceCode,
    Event,
    EventAttendance,
    EventCertificate,
    EventFeedback,
    EventRegistration,
    UserProfile,
)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "display_name", "department")
    list_filter = ("role",)
    search_fields = ("user__username", "display_name", "user__email")


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("name", "starts_at", "venue", "organizer", "status")
    list_filter = ("status", "audience", "attendance_method")
    search_fields = ("name", "venue")


admin.site.register(EventRegistration)
admin.site.register(EventAttendance)
admin.site.register(EventFeedback)
admin.site.register(EventCertificate)
admin.site.register(AttendanceCode)

admin.site.site_header = "COT Event Attendance Administration"
