import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import AttendanceScanner from '../components/common/AttendanceScanner';
import EventDashboard from '../components/event/EventDashboard';
import EventList from '../components/event/EventList';
import AttendanceHistory from '../components/event/AttendanceHistory';
import FacultyMonitor from '../components/event/FacultyMonitor';
import AttendanceTracker from '../components/event/AttendanceTracker';
import EventFeedback from '../components/event/EventFeedback';
import ProfilePanel from '../components/event/ProfilePanel';
import Announcements from '../components/event/Announcements';
import { useAuth } from '../context/AuthContext';
import { eventApi } from '../data/eventApi';
import type { AttendanceSession, EventRecord, MonitoredEventAttendance, MonitoredSession, PersonalAttendanceData } from '../types/eventAttendance';

type View = 'dashboard' | 'events' | 'attendance' | 'history' | 'monitor' | 'feedback' | 'profile' | 'announcements';
const emptyAttendance: PersonalAttendanceData = { summary: { present: 0, late: 0, absent: 0, attendancePercentage: 0 }, records: [] };

export default function Portal() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const initialView: View = ['dashboard', 'events', 'attendance', 'history', 'monitor', 'feedback', 'profile', 'announcements'].includes(requestedView || '') ? requestedView as View : 'dashboard';
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [attendance, setAttendance] = useState<PersonalAttendanceData>(emptyAttendance);
  const [managedEvents, setManagedEvents] = useState<EventRecord[]>([]);
  const [monitored, setMonitored] = useState<MonitoredEventAttendance | null>(null);
  const [monitoredId, setMonitoredId] = useState('');
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  // Which event the scanner is scoped to, or '' for the GENERAL scanner. A card
  // button passes its own event id so the action applies to that event only; every
  // other entry point passes nothing and behaves exactly as before.
  const [scannerEventId, setScannerEventId] = useState('');
  const openScanner = useCallback((eventId?: string) => {
    setScannerEventId(eventId || '');
    setShowScanner(true);
  }, []);
  const closeScanner = useCallback(() => { setShowScanner(false); setScannerEventId(''); }, []);
  // GST006: the tracking session is restored from the SERVER, so a refresh or a
  // closed scanner recovers the same session and its earned time.
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [monitoredSessions, setMonitoredSessions] = useState<MonitoredSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isFaculty = user?.role === 'faculty';
  const view: View = initialView === 'monitor' && !isFaculty ? 'dashboard' : initialView;

  /** Restores an in-progress session for any of the user's current events. */
  const restoreSession = useCallback(async (eventData: EventRecord[]) => {
    const open = eventData.filter(event => event.status === 'ongoing' || event.can_check_in);
    for (const event of open) {
      try {
        const result = await eventApi.myAttendanceSession(event.id);
        if (result.session) { setActiveSession(result.session); return result.session; }
      } catch { /* tracking disabled or not configured for this event */ }
    }
    setActiveSession(null);
    return null;
  }, []);

  /**
   * Reloads events, attendance and the managed list.
   *
   * `silent: true` re-reads that data WITHOUT flipping `loading`. It exists
   * because `loading` tears the whole view down (see the `content` IIFE), so
   * calling this from an action that lives INSIDE the rendered view unmounts
   * that view mid-action. Feedback hit exactly that: `refresh()` replaced the
   * feedback form with the loading panel, so when control returned the form
   * remounted empty and the "Thank you" confirmation had nowhere to render -
   * the response was stored correctly and the student was told nothing. The
   * transient loading panel is also a bad experience for an inline action that
   * only changes one field, so the data is refreshed underneath it instead.
   */
  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!user) return;
    if (!options.silent) setLoading(true);
    setError('');
    try {
      const [eventData, attendanceData, managedData] = await Promise.all([
        eventApi.events(), eventApi.myAttendance(), isFaculty ? eventApi.managedEvents() : Promise.resolve([]),
      ]);
      setEvents(eventData); setAttendance(attendanceData); setManagedEvents(managedData);
      // Restore any in-progress tracking session from the server.
      await restoreSession(eventData);
      if (!monitoredId && managedData[0]) setMonitoredId(managedData[0].id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Event data could not be loaded.'); }
    finally { if (!options.silent) setLoading(false); }
  }, [isFaculty, monitoredId, restoreSession, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadMonitor = useCallback(async () => {
    if (!isFaculty || !monitoredId) return;
    setMonitorLoading(true);
    try {
      setMonitored(await eventApi.eventAttendance(monitoredId));
      // GST007: authorized Faculty/Admin monitoring, scoped by the server.
      const tracked = await eventApi.monitoredAttendanceSessions(monitoredId);
      setMonitoredSessions(tracked.sessions);
    }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Attendance could not be loaded.'); }
    finally { setMonitorLoading(false); }
  }, [isFaculty, monitoredId]);

  useEffect(() => {
    if (view !== 'monitor' || !monitoredId) return;
    void loadMonitor();
    const timer = window.setInterval(() => { void loadMonitor(); }, 15000);
    return () => window.clearInterval(timer);
  }, [loadMonitor, monitoredId, view]);

  const go = useCallback((next: View) => navigate(`/portal?view=${next}`), [navigate]);
  const handleRegister = async (event: EventRecord) => {
    try { const result = await eventApi.register(event.id); toast.success(result.message); await refresh(); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Registration failed.'); }
  };
  const handleRecorded = async (confirmation: { eventName: string; status: string }) => {
    toast.success(confirmation.status === 'pending'
      ? `${confirmation.eventName}: check-in recorded; qualification is pending verified attendance time.`
      : `${confirmation.eventName}: ${confirmation.status.toUpperCase()} attendance recorded.`);
    await refresh();
  };
  const handleDownload = async (kind: 'mine' | 'event' | 'certificate', id?: string) => {
    try {
      if (kind === 'mine') await eventApi.downloadMyAttendance();
      else if (kind === 'event' && id) await eventApi.downloadEventAttendance(id);
      else if (kind === 'certificate' && id) await eventApi.downloadCertificate(id);
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'The PDF could not be generated.'); }
  };
  const handleFeedback = async (eventId: string, rating: number, comments: string) => {
    await eventApi.feedback(eventId, rating, comments);
    // Silent: the list still has to update, so the event turns into
    // "already submitted" straight away, but a full refresh would replace this
    // form with the loading panel and swallow the confirmation message.
    await refresh({ silent: true });
  };
  const handleProfile = async (values: { name: string; email: string; phone: string }) => { const updated = await eventApi.updateProfile(values); updateUser(updated); };

  const content = (() => {
    if (!user) return null;
    if (view === 'announcements') return <Announcements />;
    if (loading) return <div className="app-card p-12 text-center text-sm text-[#64748B]">Loading your event workspace…</div>;
    if (error) return <div className="app-card p-8"><h1 className="app-page-title">Unable to load events</h1><p className="mt-2 text-sm text-rose-600">{error}</p><button type="button" onClick={() => void refresh()} className="app-button-primary mt-5">Try again</button></div>;
    if (view === 'dashboard') return <EventDashboard user={user} events={events} attendance={attendance} onNavigate={next => go(next as View)} onScan={openScanner} onCertificate={id => void handleDownload('certificate', id)} />;
    if (view === 'events') return <EventList events={events} onRegister={handleRegister} onScan={openScanner} />;
    if (view === 'attendance') {
      // GST007: the restored session lives OUTSIDE the scanner modal, so closing
      // it or refreshing the page does not lose earned time.
      if (activeSession && activeSession.state !== 'completed') {
        return <div className="space-y-5">
          <AttendanceTracker session={activeSession} onCheckout={setActiveSession} />
          <button type="button" onClick={() => openScanner()} className="app-button-secondary">Scan another event</button>
        </div>;
      }
      return <section className="app-card p-8"><p className="app-label">Secure check-in</p><h1 className="app-page-title">Scan event attendance</h1><p className="app-page-subtitle">Choose the event method and scan the official event code or your own card value. Confirmation appears only after the server records your attendance.</p><button type="button" onClick={() => openScanner()} className="app-button-primary mt-6">Open event scanner</button></section>;
    }
    if (view === 'history') return <AttendanceHistory data={attendance} onDownload={() => handleDownload('mine')} />;
    if (view === 'monitor' && isFaculty) return <FacultyMonitor events={managedEvents} selectedId={monitoredId} data={monitored} sessions={monitoredSessions} onSelect={setMonitoredId} onRefresh={() => void loadMonitor()} onDownload={() => handleDownload('event', monitoredId)} loading={monitorLoading} />;
    if (view === 'feedback') return <EventFeedback events={events} onSubmit={handleFeedback} />;
    return <ProfilePanel user={user} onSave={handleProfile} />;
  })();

  if (!user) return null;
  return <AppShell role={user.role}>
    {content}
    {showScanner && <AttendanceScanner events={events} initialEventId={scannerEventId || undefined} onClose={closeScanner} onRecorded={handleRecorded} onSessionStarted={setActiveSession} />}
  </AppShell>;
}
