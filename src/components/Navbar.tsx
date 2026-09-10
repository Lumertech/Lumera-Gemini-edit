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
  | 'billing' 
  | 'portal'
  | 'dhis'
  | 'team'
  | 'settings'
  | 'wellness'
  | 'therapy-session'
  | 'consult-practice'
  | 'physio-session'
  | 'dental-chart';

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
  const { go } = useNav();
  const VIEW_TITLES: Record<NavView, string> = {
    welcome: 'Welcome & Initial Setup',
    reception: 'OPD Reception & ABHA Intake',
    ambient: 'Ambient AI Scribe & SOAP',
    rx: 'Smart Rx & Specialty Studio',
    'smart-rx': 'Smart Rx & Specialty Studio',
    queue: 'Live OPD Queue & Triage',
    'opd-queue': 'Live OPD Queue & Triage',
    kiosk: 'Waiting Room TV Kiosk',
    reports: 'AI Lab OCR & Diagnostic Trends',
    appointments: 'Appointments & Schedule',
    polyclinic: 'Polyclinic Specialty Roster',
    billing: 'Billing, Claims & E-Invoicing',
    whatsapp: 'WhatsApp Suite & Patient Engagement',
    voicebot: 'AI Voice Receptionist',
    portal: 'Patient EMR Portal',
    dhis: 'DHIS Incentive & Analytics Meter',
    team: 'Clinic Team & Staff',
    settings: 'Clinic & Doctor Profile Settings',
    wellness: 'Wellness & salon book',
    'therapy-session': 'Therapy session desk',
    'consult-practice': 'Consultant workspace',
    'physio-session': 'Physio session board',
    'dental-chart': 'Dental chair & odontogram',
  };

  return (
    <header
      data-testid="app-topbar"
      className="h-14 bg-slate-900 border-b border-slate-800 text-white flex items-center justify-between px-4 sm:px-6 shrink-0 select-none z-30 shadow-sm"
    >
      {/* Left: Sidebar Toggle + Brand Logo + View Breadcrumb */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Toggle Navigation Sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {/* Logo */}
        <Link
          to={appViewToPath('ambient')}
          className="flex items-center space-x-2.5 cursor-pointer"
        >
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm shadow-blue-500/30">
            <Stethoscope className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm tracking-tight text-white">
                Lumera<span className="text-blue-400 font-extrabold">Studio</span>
              </span>
              <span className="hidden sm:inline-block px-1.5 py-0.2 text-[9px] uppercase font-bold tracking-wider rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                EMR Suite
              </span>
            </div>
          </div>
        </Link>

        {/* Breadcrumb Separator & Current View */}
        <div className="hidden md:flex items-center space-x-2 text-xs text-slate-400 pl-2 border-l border-slate-800">
          <span className="text-slate-200 font-medium">{VIEW_TITLES[currentView] || 'Clinical Workspace'}</span>
        </div>
      </div>

      {/* Right: Quick Actions & Doctor Profile */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Doctor Profile (Locked during Doctor sessions to prevent accidental specialty switching) */}
        {userRole === 'doctor' || isSpecialtyLocked ? (
          <div 
            className="flex items-center space-x-2 bg-slate-800/95 border border-slate-700/80 px-2.5 py-1 rounded-lg text-xs"
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
              <span className="text-slate-200 text-xs font-semibold max-w-[130px] sm:max-w-[180px] truncate">
                {currentDoctor.name} ({currentDoctor.specialty})
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/80 text-amber-300 font-mono font-bold uppercase flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5 text-amber-400" /> Locked
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center space-x-2 bg-slate-800 border border-slate-700/80 px-2 py-1 rounded-lg text-xs">
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
              className="bg-transparent text-slate-200 text-xs font-medium focus:outline-none cursor-pointer max-w-[130px] sm:max-w-[180px] truncate"
            >
              {allDoctors.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900 text-white">
                  {d.name} ({d.specialty})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quick New Rx Action */}
        <Link
          to={appViewToPath('rx')}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-sm shadow-blue-600/30"
          title="Create New Digital Prescription"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Rx</span>
        </Link>

        {/* Pulse AI Clinical Copilot button */}
        <button
          onClick={toggleCopilot}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold transition-all shadow-sm shadow-purple-500/30"
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
          className="hidden md:inline text-[11px] text-slate-400 hover:text-white"
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
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
