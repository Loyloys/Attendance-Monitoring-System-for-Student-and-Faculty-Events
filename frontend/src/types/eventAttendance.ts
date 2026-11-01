export type UserRole = 'student' | 'faculty' | 'admin';
export type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
export type AttendanceStatus = 'present' | 'late' | 'absent';
export type AttendanceMethod = 'qr' | 'barcode' | 'rfid';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  department: string;
  /** How this account can sign in. Google-only accounts have no password. */
  authProviders?: Array<'password' | 'google'>;
  googleLinked?: boolean;
  profileCompleted?: boolean;
  /**
   * Administrator-controlled access state. Registration always produces
   * `approved`, so this exists only to report an account an administrator has
   * blocked (`rejected`) or one left over from the old manual-approval policy
   * (`pending`). Both stay blocked, and neither is ever cleared automatically.
   */
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  picture?: string;
}

/**
 * GST006: the server-owned attendance session. The browser never computes these
 * values; it renders what the server confirmed on the last accepted update.
 */
export interface AttendanceSession {
  id: string;
  eventId: string;
  eventName: string;
  state: 'tracking' | 'paused' | 'completed';
  locationState: 'inside' | 'outside' | 'unknown';
  /** Server-verified seconds. This is the only number that counts. */
  creditedSeconds: number;
  creditedMinutes: number;
  creditedSecondsRemainder: number;
  requiredMinutes: number | null;
  remainingSeconds: number | null;
  durationOutcome: 'met' | 'in_progress' | 'incomplete' | 'unconfigured';
  /** Arrival classification; never rewritten by duration. */
  arrival: 'on_time' | 'late';
  pauseReason: string | null;
  derivedState: boolean;
  startedAt: string;
  checkedOutAt: string | null;
  endedAt: string | null;
  lastVerifiedAt: string | null;
  lastDistanceMeters: number | null;
  lastAccuracyMeters: number | null;
  eventStartsAt: string;
  eventEndsAt: string;
}

export interface MonitoredSession extends AttendanceSession {
  name: string;
  role: string;
}

export interface EventRecord {
  id: string;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  start_time: string;
  end_time: string;
  venue: string;
  audience: 'all' | 'student' | 'faculty';
  organizer_name: string;
  status: EventStatus;
  registration_required: boolean;
  registration_deadline: string | null;
  registration_status: 'registered' | 'required' | 'not_required';
  can_register: boolean;
  /**
   * Why registration is not available RIGHT NOW, when it is required but closed.
   * `null` means registration is open. The card shows this sentence instead of
   * hiding the Register action, which is what produced the dead end where the
   * badge demanded registration and nothing on the screen could satisfy it.
   */
  registration_unavailable_reason: string | null;
  attendance_status: AttendanceStatus | null;
  can_check_in: boolean;
  feedback_submitted: boolean;
  certificate_id: string | null;
  check_in_opens_at: string;
  check_in_closes_at: string;
  late_cutoff: string;
  attendance_method: AttendanceMethod;
  is_organizer: boolean;
  /**
   * GST002: the event's TOTAL LENGTH in whole minutes, computed server-side.
   *
   * This is how long the event runs, NOT how long anyone must stay. An event can
   * run for hours and require only a couple of minutes of attendance. Do not
   * label this "required duration" - see `required_attendance_minutes`.
   */
  duration_minutes: number;
  /**
   * GST006: the administrator-configured MINIMUM verified attendance, in whole
   * minutes. This is the number the student actually has to stay for.
   *
   * Null means no requirement has been configured, which is a real state - it is
   * never backfilled from `duration_minutes`, because silently substituting the
   * event length would invent an attendance rule nobody set.
   */
  required_attendance_minutes: number | null;
  /** GST004: whether a location fix is required before this event can be scanned. */
  location_verification_required: boolean;
  /** GST004: whether the event actually has a usable venue fence configured. */
  venue_geofence_configured: boolean;
  /** Safe Google Calendar web URL, present only for successfully synced events. */
  calendar_url: string | null;
  calendar_link_reason: 'not_synced' | 'permission_unavailable' | 'calendar_disabled' | null;
}

export interface PersonalAttendanceSummary {
  present: number;
  late: number;
  absent: number;
  attendancePercentage: number;
}

export interface PersonalAttendanceRecord {
  id: number;
  eventId: string;
  eventName: string;
  eventDate: string;
  status: AttendanceStatus | 'pending';
  method: AttendanceMethod;
  recordedAt: string;
  /** GST009: server-verified in-zone seconds (0 when none). */
  verifiedSeconds?: number;
  /** GST009: required verified minutes for the event, null when unconfigured. */
  requiredAttendanceMinutes?: number | null;
  /** GST009: duration qualification, null when the event needs no duration. */
  qualification?: 'pending' | 'present' | 'late' | 'absent' | null;
}

export interface PersonalAttendanceData {
  summary: PersonalAttendanceSummary;
  records: PersonalAttendanceRecord[];
}

export interface AttendanceConfirmation {
  attendanceId: number;
  eventId: string;
  eventName: string;
  eventDate: string;
  eventTime: string;
  status: AttendanceStatus | 'pending';
  method: AttendanceMethod;
  recordedAt: string;
  qualification?: 'pending' | AttendanceStatus | null;
  requiredAttendanceMinutes?: number | null;
  /** GST004: true when the server accepted and stored a verified position. */
  locationVerified?: boolean;
  /** How precise the accepted fix was, in metres (±). Null when not verified. */
  locationAccuracyMeters?: number | null;
  locationDistanceMeters?: number | null;
  message: string;
}

export interface AttendanceQrPreview {
  eventId: string;
  eventName: string;
  method: AttendanceMethod;
  eligible: boolean;
  reason: string | null;
  locationRequired: boolean;
  requiredAttendanceMinutes: number | null;
}

export interface MonitoredEventAttendance {
  event: { id: string; name: string; venue: string; calendar_url: string | null };
  summary: { present: number; late: number; absent: number; total: number; registered: number };
  attendees: Array<{
    id: string;
    name: string;
    role: UserRole;
    status: AttendanceStatus;
    method: AttendanceMethod;
    recordedAt: string;
  }>;
}
