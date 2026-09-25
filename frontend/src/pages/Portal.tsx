import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import AttendanceScanner from '../components/common/AttendanceScanner';
import EventDashboard from '../components/event/EventDashboard';
import EventList from '../components/event/EventList';
import AttendanceHistory from '../components/event/AttendanceHistory';
import FacultyMonitor from '../components/event/FacultyMonitor';
import EventFeedback from '../components/event/EventFeedback';
import ProfilePanel from '../components/event/ProfilePanel';
import { useAuth } from '../context/AuthContext';
import { eventApi } from '../data/eventApi';
import type { EventRecord, MonitoredEventAttendance, PersonalAttendanceData } from '../types/eventAttendance';

type View = 'dashboard' | 'events' | 'attendance' | 'history' | 'monitor' | 'feedback' | 'profile';
const emptyAttendance: PersonalAttendanceData = { summary: { present: 0, late: 0, absent: 0, attendancePercentage: 0 }, records: [] };

export default function Portal() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const initialView: View = ['dashboard', 'events', 'attendance', 'history', 'monitor', 'feedback', 'profile'].includes(requestedView || '') ? requestedView as View : 'dashboard';
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [attendance, setAttendance] = useState<PersonalAttendanceData>(emptyAttendance);
  const [managedEvents, setManagedEvents] = useState<EventRecord[]>([]);
  const [monitored, setMonitored] = useState<MonitoredEventAttendance | null>(null);
  const [monitoredId, setMonitoredId] = useState('');
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isFaculty = user?.role === 'faculty';
  const view: View = initialView === 'monitor' && !isFaculty ? 'dashboard' : initialView;

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const [eventData, attendanceData, managedData] = await Promise.all([
        eventApi.events(), eventApi.myAttendance(), isFaculty ? eventApi.managedEvents() : Promise.resolve([]),
      ]);
      setEvents(eventData); setAttendance(attendanceData); setManagedEvents(managedData);
      if (!monitoredId && managedData[0]) setMonitoredId(managedData[0].id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Event data could not be loaded.'); }
    finally { setLoading(false); }
  }, [isFaculty, monitoredId, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadMonitor = useCallback(async () => {
    if (!isFaculty || !monitoredId) return;
    setMonitorLoading(true);
    try { setMonitored(await eventApi.eventAttendance(monitoredId)); }
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
    toast.success(`${confirmation.eventName}: ${confirmation.status.toUpperCase()} attendance recorded.`);
    await refresh();
  };
  const handleDownload = async (kind: 'mine' | 'event' | 'certificate', id?: string) => {
    try {
      if (kind === 'mine') await eventApi.downloadMyAttendance();
      else if (kind === 'event' && id) await eventApi.downloadEventAttendance(id);
      else if (kind === 'certificate' && id) await eventApi.downloadCertificate(id);
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'The PDF could not be generated.'); }
  };
  const handleFeedback = async (eventId: string, rating: number, comments: string) => { await eventApi.feedback(eventId, rating, comments); await refresh(); };
  const handleProfile = async (values: { name: string; email: string; phone: string }) => { const updated = await eventApi.updateProfile(values); updateUser(updated); };

  const content = (() => {
    if (!user) return null;
    if (loading) return <div className="app-card p-12 text-center text-sm text-white/50">Loading your event workspace…</div>;
    if (error) return <div className="app-card p-8"><h1 className="app-page-title">Unable to load events</h1><p className="mt-2 text-sm text-rose-200">{error}</p><button type="button" onClick={() => void refresh()} className="app-button-primary mt-5">Try again</button></div>;
    if (view === 'dashboard') return <EventDashboard user={user} events={events} attendance={attendance} onNavigate={next => go(next as View)} onScan={() => setShowScanner(true)} onCertificate={id => void handleDownload('certificate', id)} />;
    if (view === 'events') return <EventList events={events} onRegister={handleRegister} onScan={() => setShowScanner(true)} />;
    if (view === 'attendance') return <section className="app-card p-8"><p className="app-label">Secure check-in</p><h1 className="app-page-title">Scan event attendance</h1><p className="app-page-subtitle">Choose the event method and scan the official event code or your own card value. Confirmation appears only after the server records your attendance.</p><button type="button" onClick={() => setShowScanner(true)} className="app-button-primary mt-6">Open event scanner</button></section>;
    if (view === 'history') return <AttendanceHistory data={attendance} onDownload={() => handleDownload('mine')} />;
    if (view === 'monitor' && isFaculty) return <FacultyMonitor events={managedEvents} selectedId={monitoredId} data={monitored} onSelect={setMonitoredId} onRefresh={() => void loadMonitor()} onDownload={() => handleDownload('event', monitoredId)} loading={monitorLoading} />;
    if (view === 'feedback') return <EventFeedback events={events} onSubmit={handleFeedback} />;
    return <ProfilePanel user={user} onSave={handleProfile} />;
  })();

  if (!user) return null;
  return <AppShell role={user.role}>
    {content}
    {showScanner && <AttendanceScanner events={events} onClose={() => setShowScanner(false)} onRecorded={handleRecorded} />}
  </AppShell>;
}
