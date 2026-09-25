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

