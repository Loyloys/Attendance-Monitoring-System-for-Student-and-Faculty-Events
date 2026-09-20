import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, LogOut, ShieldCheck, User, Bell } from 'lucide-react';
import { AuthService } from '../../data/authService';

interface NavbarProps {
  onMenuClick: () => void;
  userRole: 'student' | 'faculty' | 'lecturer' | 'admin';
}

const Navbar: React.FC<NavbarProps> = ({ onMenuClick, userRole }) => {
  const navigate = useNavigate();

  const getRoleDisplay = () => {
    switch (userRole) {
      case 'student': return 'Student Portal';
      case 'faculty':
      case 'lecturer': return 'Faculty Portal';
      case 'admin': return 'Admin Portal';
      default: return 'COT Attendance Web';
    }
  };

  const getDashboardPath = () => `/` + userRole + `/dashboard`;

  const handleLogout = () => {
    AuthService.logout();
    navigate('/login');
  };

  return (
    <nav className="sticky top-0 z-[100] w-full bg-white/60 backdrop-blur-xl border-b border-white/20 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-8">
        <div className="flex justify-between h-20">
          <div className="flex items-center gap-4">
            {/* Mobile Menu Toggle - Liquid Style */}
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2.5 rounded-2xl bg-slate-50 text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all active:scale-90"
            >
              <Menu size={22} strokeWidth={2.5} />
            </button>

            {/* Logo Group */}
            <Link 
              to={getDashboardPath()} 
              className="flex items-center gap-2 group"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-700 rounded-[14px] flex items-center justify-center shadow-lg shadow-orange-500/20 group-hover:scale-105 transition-transform">
                <ShieldCheck className="text-white" size={22} />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-black leading-none tracking-tight text-slate-900">
                  {getRoleDisplay()}
                </h1>
                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-[0.2em] mt-1">
                  College of Technologies
                </p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-3 sm:gap-6">
            {/* Notification Bell - Modern Indicator */}
            <button className="relative p-2.5 text-slate-400 hover:text-orange-600 transition-colors group">
              <Bell size={22} />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 border-2 border-white rounded-full" />
            </button>

            {/* Vertical Divider */}
            <div className="h-8 w-[1px] bg-slate-200 hidden sm:block" />

            {/* User Profile Action */}
            <div className="flex items-center gap-3">
              <div className="hidden text-right md:block">
                <p className="text-sm font-black leading-none capitalize text-slate-900">
                  {userRole}
                </p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-1">
                  Active Session
                </p>
              </div>
              
              <div className="w-10 h-10 bg-slate-100 border-2 border-white rounded-full flex items-center justify-center text-slate-600 shadow-sm overflow-hidden group hover:border-orange-300 transition-all cursor-pointer">
                <User size={20} />
              </div>

              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-black rounded-xl hover:bg-[#F97316] shadow-lg shadow-slate-900/10 transition-all active:scale-95 uppercase tracking-widest"
              >
                <LogOut size={14} strokeWidth={3} />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;