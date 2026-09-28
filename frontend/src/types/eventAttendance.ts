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
  picture?: string;
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
  attendance_status: AttendanceStatus | null;
  can_check_in: boolean;
  feedback_submitted: boolean;
  certificate_id: string | null;
  check_in_opens_at: string;
  check_in_closes_at: string;
  late_cutoff: string;
  attendance_method: AttendanceMethod;
  is_organizer: boolean;
  /** GST002: how long attendance runs, in whole minutes, computed server-side. */
  duration_minutes: number;
  /** GST004: whether a location fix is required before this event can be scanned. */
  location_verification_required: boolean;
  /** GST004: whether the event actually has a usable venue fence configured. */
  venue_geofence_configured: boolean;
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
  status: AttendanceStatus;
  method: AttendanceMethod;
  recordedAt: string;
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
  status: AttendanceStatus;
  method: AttendanceMethod;
  recordedAt: string;
  /** GST004: true when the server accepted and stored a verified position. */
  locationVerified?: boolean;
  locationDistanceMeters?: number | null;
  message: string;
}

export interface MonitoredEventAttendance {
  event: { id: string; name: string; venue: string };
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

