export type DemoRole = 'student' | 'faculty' | 'admin';
export type DemoAttendanceStatus = 'Present' | 'Late' | 'Absent';
export type DemoEventStatus = 'Approved' | 'Ongoing' | 'Completed' | 'Cancelled';

export interface DemoEvent {
  id: string;
  name: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  organizer: string;
  type: 'Student Event' | 'Faculty Event' | 'College Event';
  attendanceMethod: 'QR Code' | 'Barcode' | 'RFID/ID scanning';
  cutoffTime: string;
  status: DemoEventStatus;
}

export interface DemoAttendanceRecord {
  id: string;
  eventId: string;
  userId: string;
  userName: string;
  role: 'Student' | 'Faculty';
  department: string;
  timeIn: string;
  status: DemoAttendanceStatus;
}

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: DemoRole;
  department: string;
  status: 'Active' | 'Inactive';
  studentId?: string;
  employeeId?: string;
  course?: string;
  year?: number;
}

export const demoUsers: DemoUser[] = [
  {
    id: 'STU001',
    name: 'Alice Johnson',
    email: 'student',
    password: 'student123',
    role: 'student',
    department: 'Bachelor of Science in Information Technology (BSIT)',
    status: 'Active',
    studentId: 'STU001',
    course: 'BSIT',
    year: 3,
  },
  {
    id: 'FAC001',
    name: 'Dr. Sarah Johnson',
    email: 'faculty',
    password: 'faculty123',
    role: 'faculty',
    department: 'Bachelor of Science in Information Technology (BSIT)',
    status: 'Active',
    employeeId: 'EMP001',
  },
  {
    id: 'ADM001',
    name: 'System Administrator',
    email: 'admin',
    password: 'admin123',
    role: 'admin',
    department: 'Administration',
    status: 'Active',
  },
];

export const demoEvents: DemoEvent[] = [
  {
    id: 'EVT-001',
    name: 'College of Technologies Seminar',
    description: 'A campus-wide seminar on digital transformation and academic innovation.',
    date: '2026-09-18',
    startTime: '08:00',
    endTime: '10:00',
    venue: 'Innovation Hall',
    organizer: 'College of Technologies',
    type: 'College Event',
    attendanceMethod: 'QR Code',
    cutoffTime: '08:15',
    status: 'Approved',
  },
  {
    id: 'EVT-002',
    name: 'Student Developers Meetup',
    description: 'A student-focused workshop for project demos and technical networking.',
    date: '2026-09-14',
    startTime: '10:00',
    endTime: '13:00',
    venue: 'Innovation Lab 2',
    organizer: 'Tech Students Association',
    type: 'Student Event',
    attendanceMethod: 'QR Code',
    cutoffTime: '10:15',
    status: 'Ongoing',
  },
  {
    id: 'EVT-003',
    name: 'Faculty Research Colloquium',
    description: 'Faculty-led presentations and collaborative research discussion.',
    date: '2026-09-11',
    startTime: '14:00',
    endTime: '17:00',
    venue: 'Senate Room',
    organizer: 'Research Office',
    type: 'Faculty Event',
    attendanceMethod: 'RFID/ID scanning',
    cutoffTime: '14:15',
    status: 'Completed',
  },
];

export const demoAttendance: DemoAttendanceRecord[] = [
  {
    id: 'ATT-001',
    eventId: 'EVT-002',
    userId: 'STU001',
    userName: 'Alice Johnson',
    role: 'Student',
    department: 'Bachelor of Science in Information Technology (BSIT)',
    timeIn: '10:04',
    status: 'Present',
  },
  {
    id: 'ATT-002',
    eventId: 'EVT-002',
    userId: 'STU002',
    userName: 'Bob Smith',
    role: 'Student',
    department: 'Bachelor of Science in Information Technology (BSIT)',
    timeIn: '10:22',
    status: 'Late',
  },
  {
    id: 'ATT-003',
    eventId: 'EVT-002',
    userId: 'FAC001',
    userName: 'Dr. Sarah Johnson',
    role: 'Faculty',
    department: 'Bachelor of Science in Information Technology (BSIT)',
    timeIn: '09:58',
    status: 'Present',
  },
  {
    id: 'ATT-004',
    eventId: 'EVT-001',
    userId: 'STU001',
    userName: 'Alice Johnson',
    role: 'Student',
    department: 'Bachelor of Science in Information Technology (BSIT)',
    timeIn: '08:08',
    status: 'Present',
  },
];

export const findDemoUserByCredentials = (email: string, password: string) => {
  return demoUsers.find((user) => user.email === email && user.password === password);
};

export const calculateAttendancePercentage = (attended: number, required: number) => {
  if (!required) return 0;
  return Math.round((attended / required) * 100);
};

export const determineAttendanceStatus = (eventStart: string, cutoffTime: string, scannedTime: string) => {
  const [startHour, startMinute] = eventStart.split(':').map(Number);
  const [cutHour, cutMinute] = cutoffTime.split(':').map(Number);
  const [scanHour, scanMinute] = scannedTime.split(':').map(Number);

  const startTotal = startHour * 60 + startMinute;
  const cutTotal = cutHour * 60 + cutMinute;
  const scanTotal = scanHour * 60 + scanMinute;

  if (scanTotal > cutTotal && scanTotal >= startTotal) {
    return 'Late';
  }

  return 'Present';
};

export const getUserAttendance = (userId: string) => {
  return demoAttendance.filter((record) => record.userId === userId);
};

export const getEventAttendance = (eventId: string) => {
  return demoAttendance.filter((record) => record.eventId === eventId);
};

export const getAdminSummary = () => {
  const present = demoAttendance.filter((record) => record.status === 'Present').length;
  const late = demoAttendance.filter((record) => record.status === 'Late').length;
  const absent = Math.max(0, demoEvents.length * 2 - present - late);

  return {
    totalStudents: demoUsers.filter((user) => user.role === 'student').length,
    totalFaculty: demoUsers.filter((user) => user.role === 'faculty').length,
    totalEvents: demoEvents.length,
    approvedEvents: demoEvents.filter((event) => event.status === 'Approved').length,
    ongoingEvents: demoEvents.filter((event) => event.status === 'Ongoing').length,
    present,
    late,
    absent,
    attendancePercentage: calculateAttendancePercentage(present, present + late + absent),
  };
};

export const getStudentSummary = (userId: string) => {
  const records = getUserAttendance(userId);
  const present = records.filter((record) => record.status === 'Present').length;
  const late = records.filter((record) => record.status === 'Late').length;
  const absent = records.filter((record) => record.status === 'Absent').length;

  return {
    totalEventsAttended: records.length,
    present,
    late,
    absent,
    attendancePercentage: calculateAttendancePercentage(present + late, Math.max(records.length + 2, 1)),
  };
};
