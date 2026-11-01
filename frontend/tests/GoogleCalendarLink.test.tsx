// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoogleCalendarLink from '../src/components/event/GoogleCalendarLink';
import EventDashboard from '../src/components/event/EventDashboard';
import type { AuthUser, EventRecord, PersonalAttendanceData } from '../src/types/eventAttendance';

vi.mock('../src/data/eventApi', () => ({
  eventApi: {
    googleCalendarStatus: vi.fn().mockResolvedValue({
      enabled: true,
      settingAvailable: true,
      configured: true,
      connected: false,
      missing: [],
    }),
  },
}));

const user = (role: AuthUser['role']): AuthUser => ({
  id: `${role}-1`, username: role, name: role, email: `${role}@example.test`, role, phone: '',
});
const attendance: PersonalAttendanceData = {
  summary: { present: 0, late: 0, absent: 0, attendancePercentage: 0 },
  records: [],
};
const events = [] as EventRecord[];

describe('GoogleCalendarLink', () => {
  afterEach(cleanup);
  beforeEach(() => vi.clearAllMocks());

  it('opens the synced event in a new tab', () => {
    render(<GoogleCalendarLink url="https://calendar.google.com/calendar/u/0/r/eventedit/event-123" />);
    const link = screen.getByRole('link', { name: 'Open Google Calendar' });
    expect(link).toHaveAttribute('href', 'https://calendar.google.com/calendar/u/0/r/eventedit/event-123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each(['student', 'faculty'] as const)('shows the personal Calendar for %s dashboards', async (role) => {
    render(
      <EventDashboard
        user={user(role)}
        events={events}
        attendance={attendance}
        onNavigate={() => undefined}
        onScan={() => undefined}
        onCertificate={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open Google Calendar' })).toHaveAttribute(
      'href',
      'https://calendar.google.com/calendar/u/0/r',
    ));
    expect(screen.getByRole('link', { name: 'Open Google Calendar' })).toHaveAttribute('target', '_blank');
    cleanup();
  });

  it('keeps the general Calendar destination usable when no synced event link exists', () => {
    render(<GoogleCalendarLink url="https://calendar.google.com/calendar/u/0/r" reason={null} />);
    expect(screen.getByRole('link', { name: 'Open Google Calendar' })).toHaveAttribute(
      'href',
      'https://calendar.google.com/calendar/u/0/r',
    );
  });

  it('explains when an event was not synced', () => {
    render(<GoogleCalendarLink url={null} />);
    expect(screen.queryByRole('link', { name: 'Open Google Calendar' })).not.toBeInTheDocument();
    expect(screen.getByText('Google Calendar unavailable')).toHaveAttribute(
      'title',
      'This event has not been synced to Google Calendar.',
    );
  });

  it('explains when the stored Calendar link is unavailable for the account', () => {
    render(<GoogleCalendarLink url={null} reason="permission_unavailable" />);
    expect(screen.getByText('Google Calendar unavailable')).toHaveAttribute(
      'title',
      'Google Calendar unavailable for this account. Check Calendar permissions.',
    );
  });

  it('starts the existing authorization flow when disconnected', () => {
    render(<GoogleCalendarLink url={null} reason="permission_unavailable" authorizeUrl="/api/auth/google/calendar/authorize/" />);
    expect(screen.getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute(
      'href',
      '/api/auth/google/calendar/authorize/',
    );
  });

  it('opens the Admin Calendar when connected', () => {
    render(<GoogleCalendarLink url="https://calendar.google.com/calendar/u/0/r" />);
    expect(screen.getByRole('link', { name: 'Open Google Calendar' })).toHaveAttribute(
      'href',
      'https://calendar.google.com/calendar/u/0/r',
    );
  });

  it('explains when Calendar is disabled by an Admin', () => {
    render(<GoogleCalendarLink url={null} reason="calendar_disabled" />);
    expect(screen.getByText('Google Calendar unavailable')).toHaveAttribute(
      'title',
      'Google Calendar has been disabled by an Admin.',
    );
  });
});
