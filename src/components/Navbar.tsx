import React from 'react';
import { 
  Stethoscope, 
  Bot, 
  Plus,
  UserCheck,
  Menu,
  LogOut,
  Shield,
  Sparkles,
  Lock
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Doctor, UserRole } from '../types';
import { useAuth } from '../auth/AuthContext';
import { useNav } from '../nav/NavigationContext';
import { appViewToPath } from '../nav/surfaces';

export type NavView = 
  | 'welcome'
  | 'reception'
  | 'ambient' 
  | 'rx' 
  | 'smart-rx'
  | 'queue' 
  | 'opd-queue'
  | 'kiosk'
  | 'reports'
  | 'appointments' 
  | 'polyclinic' 
  | 'whatsapp' 
  | 'voicebot' 
  | 'pharmacy-hub'
  | 'billing' 
  | 'portal'
  | 'dhis'
  | 'team'
  | 'settings'
  | 'wellness'
  | 'therapy-session'
  | 'consult-practice'
  | 'physio-session'
  | 'dental-chart'
  | 'patients';

interface NavbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  currentDoctor: Doctor;
  onSelectDoctor: (doctor: Doctor) => void;
  allDoctors: Doctor[];
  onTogglePulse?: () => void;
  onToggleGemini?: () => void;
  onToggleHexa?: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  userName?: string;
  userRole?: UserRole;
  canOpenAdmin?: boolean;
  isSpecialtyLocked?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  currentDoctor,
  onSelectDoctor,
  allDoctors,
  onTogglePulse,
  onToggleGemini,
  onToggleHexa,
  onToggleSidebar,
  isSidebarCollapsed,
  userName,
  userRole,
  canOpenAdmin,
  isSpecialtyLocked,
}) => {
  const toggleCopilot = onTogglePulse || onToggleGemini || onToggleHexa || (() => {});
  const { logout } = useAuth();
  const { go, workspaceSlug } = useNav();
  const VIEW_TITLES: Record<NavView, string> = {
    welcome: 'Dashboard',
    reception: 'Intake',
    ambient: 'Scribe',
    rx: 'Consult',
    'smart-rx': 'Consult',
    queue: 'OPD',
    'opd-queue': 'OPD',
    kiosk: 'Kiosk',
    reports: 'Labs',
    appointments: 'Appointments',
    polyclinic: 'Roster',
    whatsapp: 'WhatsApp',
    voicebot: 'Voice',
    'pharmacy-hub': 'Pharmacy',
    billing: 'Billing',
    portal: 'Portal',
    dhis: 'Incentives',
    team: 'Team',
    settings: 'Settings',
    wellness: 'Wellness',
    'therapy-session': 'Therapy',
    'consult-practice': 'Consulting',
    'physio-session': 'Dashboard',
    'dental-chart': 'Dashboard',
    patients: 'Patients',
  };

  return (
    <header
      data-testid="app-topbar"
      className="h-14 bg-white border-b border-slate-200 text-slate-900 flex items-center justify-between gap-2 px-3 sm:px-5 shrink-0 select-none z-50 min-w-0 overflow-hidden"
    >
      {/* Left: Sidebar Toggle + Brand Logo + View Breadcrumb */}
      <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Open navigation"
            title="Toggle Navigation Sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {/* Logo */}
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900 truncate">
            {VIEW_TITLES[currentView] || "Dashboard"}
          </h1>
        </div>

      </div>

      {/* Right: Quick Actions & Doctor Profile */}
      <div className="flex items-center space-x-1.5 sm:space-x-3 min-w-0 shrink">
        {/* Doctor Profile (Locked during Doctor sessions to prevent accidental specialty switching) */}
        {userRole === 'doctor' || isSpecialtyLocked ? (
          <div 
            className="hidden md:flex items-center space-x-2 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg text-xs"
            title="Doctor profile and clinical workflow locked during consultation"
          >
            <div className="w-6 h-6 rounded-full overflow-hidden bg-blue-600/30 border border-blue-400/40 flex items-center justify-center shrink-0">
              {currentDoctor.avatarUrl ? (
                <img
                  src={currentDoctor.avatarUrl}
                  alt={currentDoctor.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserCheck className="w-3.5 h-3.5 text-blue-400" />
              )}
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-700 text-xs font-semibold max-w-[180px] truncate">
                {currentDoctor.name} ({currentDoctor.specialty})
              </span>
              <span className="hidden sm:flex text-[9px] px-1.5 py-0.5 rounded bg-slate-700/80 text-amber-300 font-mono font-bold uppercase items-center gap-0.5">
                <Lock className="w-2.5 h-2.5 text-amber-400" /> Locked
              </span>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex items-center space-x-2 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs">
            <div className="w-6 h-6 rounded-full overflow-hidden bg-blue-600/30 border border-blue-400/40 flex items-center justify-center shrink-0">
              {currentDoctor.avatarUrl ? (
                <img
                  src={currentDoctor.avatarUrl}
                  alt={currentDoctor.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserCheck className="w-3.5 h-3.5 text-blue-400" />
              )}
            </div>
            <select
              aria-label="Doctor Profile Selector"
              value={currentDoctor.id}
              onChange={(e) => {
                const doc = allDoctors.find((d) => d.id === e.target.value);
                if (doc) onSelectDoctor(doc);
              }}
              className="bg-transparent text-slate-700 text-xs font-medium focus:outline-none cursor-pointer max-w-[180px] truncate"
            >
              {allDoctors.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900 text-white">
                  {d.name} ({d.specialty})
                </option>
              ))}
            </select>
          </div>
        )}

        {userRole === "doctor" && (
          <Link
            to={appViewToPath('rx', workspaceSlug)}
            className="hidden sm:flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            title="Open a consult"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Consult</span>
          </Link>
        )}

        {/* Pulse AI Clinical Copilot button */}
        <button
          onClick={toggleCopilot}
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold transition-all shadow-sm shadow-purple-500/30"
          title="Open Pulse AI Clinical Decision Support"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-200 animate-pulse" />
          <span className="hidden sm:inline">Pulse AI</span>
          <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-white/20 text-white">AI</span>
        </button>

        {canOpenAdmin && (
          <Link
            to="/admin"
            className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white"
          >
            <Shield className="w-3.5 h-3.5 text-blue-300" />
            Admin
          </Link>
        )}
        <button
          type="button"
          onClick={() => go('landing', { explicitPublic: true })}
          className="hidden md:inline text-[11px] text-slate-400 hover:text-slate-700"
        >
          Exit to site
        </button>
        {userName && (
          <span className="hidden lg:inline text-[11px] text-slate-400">
            {userName}
            {userRole ? ` · ${userRole.replace('_', ' ')}` : ''}
          </span>
        )}
        <button
          onClick={() => logout().then(() => go('landing'))}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
