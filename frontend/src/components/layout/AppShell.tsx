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

  return <div className="app-workspace min-h-screen bg-[#090b10] text-slate-100 lg:flex lg:h-screen lg:overflow-hidden">
    <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 focus:translate-y-0">Skip to content</a>
    {mobileOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col border-r border-white/[0.07] bg-[#0d1016] transition-[width,transform] duration-300 lg:static lg:translate-x-0 ${collapsed ? 'lg:w-20' : 'lg:w-64'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Primary navigation">
      <div className={`flex h-20 items-center border-b border-white/[0.06] ${collapsed ? 'justify-center px-3' : 'gap-3 px-5'}`}>
        <img src="/brand/sbo-logo.jpg" alt="College of Technologies Student Body Organization" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
        <div className={`min-w-0 ${collapsed ? 'hidden' : ''}`}><p className="truncate text-[15px] font-bold text-white">COT Event Attendance</p><p className="truncate text-[9px] font-semibold uppercase tracking-[0.18em] text-white/35">Event portal</p></div>
        <button type="button" aria-label="Close navigation" className="ml-auto rounded-lg p-2 text-white/45 hover:bg-white/[0.06] hover:text-white lg:hidden" onClick={() => setMobileOpen(false)}><X size={19} /></button>
      </div>
      <nav className={`app-scrollbar flex-1 space-y-1 overflow-y-auto py-5 ${collapsed ? 'px-3' : 'px-4'}`}>
        {!collapsed && <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-white/25">Workspace</p>}
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = item.path === activePath;
          return <button key={item.path} type="button" title={collapsed ? item.label : undefined} onClick={() => { navigate(item.path); setMobileOpen(false); }} className={`group relative flex h-11 w-full items-center rounded-xl text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-blue-400/60 ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${isActive ? 'bg-blue-500/[0.12] text-white ring-1 ring-inset ring-blue-400/20' : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85'}`}>
            {isActive && <span className="absolute left-0 h-5 w-0.5 rounded-full bg-blue-400" />}
            <Icon size={19} className={isActive ? 'text-blue-400' : 'text-white/40 group-hover:text-white/70'} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>;
        })}
      </nav>
      <div className={`border-t border-white/[0.06] p-3 ${collapsed ? 'lg:px-2' : ''}`}>
        <div className={`mb-2 flex items-center rounded-xl bg-white/[0.035] ${collapsed ? 'justify-center p-2' : 'gap-3 p-3'}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">{getInitials(displayName)}</div>
          {!collapsed && <div className="min-w-0"><p className="truncate text-xs font-semibold text-white/85">{displayName}</p><p className="truncate text-[10px] text-white/35">{roleLabels[resolvedRole]}</p></div>}
        </div>
        <button type="button" onClick={logout} title={collapsed ? 'Log out' : undefined} className={`flex h-10 w-full items-center rounded-xl text-sm font-medium text-white/45 transition hover:bg-rose-500/10 hover:text-rose-300 ${collapsed ? 'justify-center' : 'gap-3 px-3'}`}><LogOut size={18} />{!collapsed && <span>Log out</span>}</button>
        <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} onClick={() => setCollapsed(value => !value)} className="mt-1 hidden h-10 w-full items-center justify-center rounded-xl text-white/35 transition hover:bg-white/[0.05] hover:text-white lg:flex"><ChevronLeft size={18} className={collapsed ? 'rotate-180' : ''} /></button>
      </div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col lg:h-screen">
      <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#090b10]/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><button type="button" aria-label="Open navigation" className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-white/60 transition hover:bg-white/[0.08] hover:text-white lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">College of Technologies</p><p className="truncate text-base font-semibold text-white/90">{activeItem?.label || roleLabels[resolvedRole]}</p></div></div>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-1.5 text-xs text-emerald-300 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Secure session</div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-xs font-bold text-white/80 ring-1 ring-white/10">{getInitials(displayName)}</div></div>
      </header>
      <main id="main-content" className="app-scrollbar min-w-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{children}</div></main>
    </div>
  </div>;
}
