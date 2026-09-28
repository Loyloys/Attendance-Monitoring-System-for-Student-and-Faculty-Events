import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  QrCode,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { UserType } from '../../data/authService';
import type { UserRole } from '../../types/eventAttendance';

export type AppNavItem = { label: string; path: string; icon: ElementType };
type AppShellProps = { children: ReactNode; role: UserType };

const roleLabels: Record<UserRole, string> = {
  student: 'Student portal',
  faculty: 'Faculty portal',
  admin: 'Administrator portal',
};

const navByRole: Record<UserRole, AppNavItem[]> = {
  student: [
    { label: 'Dashboard', path: '/portal?view=dashboard', icon: LayoutDashboard },
    { label: 'Available events', path: '/portal?view=events', icon: CalendarDays },
    { label: 'Scan event attendance', path: '/portal?view=attendance', icon: QrCode },
    { label: 'My event attendance', path: '/portal?view=history', icon: ClipboardCheck },
    { label: 'Event feedback', path: '/portal?view=feedback', icon: MessageSquare },
    { label: 'My profile', path: '/portal?view=profile', icon: Users },
  ],
  faculty: [
    { label: 'Dashboard', path: '/portal?view=dashboard', icon: LayoutDashboard },
    { label: 'Available events', path: '/portal?view=events', icon: CalendarDays },
    { label: 'Scan event attendance', path: '/portal?view=attendance', icon: QrCode },
    { label: 'My event attendance', path: '/portal?view=history', icon: BarChart3 },
    { label: 'Monitor assigned events', path: '/portal?view=monitor', icon: ClipboardCheck },
    { label: 'Event feedback', path: '/portal?view=feedback', icon: MessageSquare },
    { label: 'My profile', path: '/portal?view=profile', icon: Users },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'User management', path: '/admin/users', icon: Users },
    { label: 'Event management', path: '/admin/events', icon: CalendarDays },
    { label: 'Event attendance', path: '/admin/attendance', icon: ClipboardCheck },
    { label: 'Event reports', path: '/admin/reports', icon: FileText },
    { label: 'Feedback & evaluations', path: '/admin/feedback', icon: MessageSquare },
  ],
};

const storageKey = 'cot-attendance-sidebar-collapsed';
const getInitials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

export default function AppShell({ children, role }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout: endSession } = useAuth();
  const resolvedRole: UserRole = user?.role || (role === 'lecturer' ? 'faculty' : role);
  const navItems = navByRole[resolvedRole];
  const displayName = user?.name || 'COT User';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(storageKey) === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* storage may be restricted */ } }, [collapsed]);
  const activePath = `${location.pathname}${location.search}`;
  const activeItem = navItems.find(item => item.path === activePath);
  const logout = async () => { await endSession(); navigate('/login', { replace: true }); };

  return <div className="app-workspace min-h-screen bg-[#F5F4EC] text-[#334155] lg:flex lg:h-screen lg:overflow-hidden">
    <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg focus:translate-y-0">Skip to content</a>
    {mobileOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col border-r border-[#E2E3DF] bg-white transition-[width,transform] duration-300 lg:static lg:translate-x-0 ${collapsed ? 'lg:w-20' : 'lg:w-64'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Primary navigation">
      <div className={`flex h-20 items-center border-b border-[#E2E3DF] ${collapsed ? 'justify-center px-3' : 'gap-3 px-5'}`}>
        <img src="/brand/sbo-logo.jpg" alt="College of Technologies Student Body Organization" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-[#E2E3DF]" />
        <div className={`min-w-0 ${collapsed ? 'hidden' : ''}`}><p className="truncate text-[15px] font-bold text-[#10203B]">COT Event Attendance</p><p className="truncate text-[9px] font-semibold uppercase tracking-[0.18em] text-[#64748B]">Event portal</p></div>
        <button type="button" aria-label="Close navigation" className="ml-auto rounded-lg p-2 text-[#64748B] transition hover:bg-[#FFF1E6] hover:text-[#9A3412] focus-visible:ring-2 focus-visible:ring-[#F97316] lg:hidden" onClick={() => setMobileOpen(false)}><X size={19} /></button>
      </div>
      <nav className={`app-scrollbar flex-1 space-y-1 overflow-y-auto py-5 ${collapsed ? 'px-3' : 'px-4'}`}>
        {!collapsed && <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-[#94A3B8]">Workspace</p>}
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = item.path === activePath;
          return <button key={item.path} type="button" title={collapsed ? item.label : undefined} onClick={() => { navigate(item.path); setMobileOpen(false); }} className={`group relative flex h-11 w-full items-center rounded-xl text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-1 ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${isActive ? 'bg-[#FFF1E6] text-[#9A3412] ring-1 ring-inset ring-[#F97316]/25' : 'text-[#64748B] hover:bg-[#FAF9F5] hover:text-[#10203B]'}`}>
            {isActive && <span className="absolute left-0 h-5 w-0.5 rounded-full bg-[#F97316]" />}
            <Icon size={19} className={isActive ? 'text-[#C2410C]' : 'text-[#94A3B8] group-hover:text-[#C2410C]'} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>;
        })}
      </nav>
      <div className={`border-t border-[#E2E3DF] p-3 ${collapsed ? 'lg:px-2' : ''}`}>
        <div className={`mb-2 flex items-center rounded-xl bg-[#FAF9F5] ${collapsed ? 'justify-center p-2' : 'gap-3 p-3'}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F97316] to-[#C2410C] text-xs font-bold text-white">{getInitials(displayName)}</div>
          {!collapsed && <div className="min-w-0"><p className="truncate text-xs font-semibold text-[#334155]">{displayName}</p><p className="truncate text-[10px] text-[#64748B]">{roleLabels[resolvedRole]}</p></div>}
        </div>
        <button type="button" onClick={logout} title={collapsed ? 'Log out' : undefined} className={`flex h-10 w-full items-center rounded-xl text-sm font-medium text-[#64748B] transition hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-[#F97316] ${collapsed ? 'justify-center' : 'gap-3 px-3'}`}><LogOut size={18} />{!collapsed && <span>Log out</span>}</button>
        <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} onClick={() => setCollapsed(value => !value)} className="mt-1 hidden h-10 w-full items-center justify-center rounded-xl text-[#94A3B8] transition hover:bg-[#FAF9F5] hover:text-[#C2410C] focus-visible:ring-2 focus-visible:ring-[#F97316] lg:flex"><ChevronLeft size={18} className={collapsed ? 'rotate-180' : ''} /></button>
      </div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col lg:h-screen">
      <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between border-b border-[#E2E3DF] bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><button type="button" aria-label="Open navigation" className="rounded-xl border border-[#E2E3DF] bg-white p-2.5 text-[#64748B] transition hover:bg-[#FFF1E6] hover:text-[#C2410C] focus-visible:ring-2 focus-visible:ring-[#F97316] lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">College of Technologies</p><p className="truncate text-base font-semibold text-[#10203B]">{activeItem?.label || roleLabels[resolvedRole]}</p></div></div>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Secure session</div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFF1E6] text-xs font-bold text-[#9A3412] ring-1 ring-[#F97316]/20">{getInitials(displayName)}</div></div>
      </header>
      <main id="main-content" className="app-scrollbar min-w-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{children}</div></main>
    </div>
  </div>;
}
