import React, { useState } from 'react';
import {
  Plus,
  Menu,
  LogOut,
  Shield,
  Lock
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Doctor, UserRole } from '../types';
import { useAuth } from '../auth/AuthContext';
import { useNav } from '../nav/NavigationContext';
import { appViewToPath } from '../nav/surfaces';
import { canOpenClinicalAssistant } from '../lib/pulseAssistantCopy';

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
  | 'gp-home'
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
  const [menuOpen, setMenuOpen] = useState(false);
  const platformAdmin = userRole === 'super_admin' || userRole === 'admin';
  const canConsult = userRole === "doctor" && !platformAdmin;
  const showLocked = userRole === "doctor" || Boolean(isSpecialtyLocked);
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
    'gp-home': 'Dashboard',
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

      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        {canConsult && (
          <Link
            to={appViewToPath('rx', workspaceSlug)}
            data-testid="topbar-start-consult"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            title="Start consult"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Start consult</span>
          </Link>
        )}
        <div className="relative">
          <button
            type="button"
            data-testid="account-menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-semibold flex items-center justify-center"
            title={userName || "Account"}
          >
            {(userName || currentDoctor.name || "U").charAt(0)}
          </button>
          {menuOpen && (
            <div
              role="menu"
              data-testid="account-menu-panel"
              className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-2 text-sm"
            >
              <p className="px-2 py-1 font-semibold text-slate-900 truncate">{userName || currentDoctor.name}</p>
              <p className="px-2 pb-2 text-[11px] text-slate-500 capitalize">{userRole?.replaceAll("_", " ")}</p>
              {showLocked && (
                <p className="mx-2 mb-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                  <Lock className="w-3 h-3" /> Locked
                </p>
              )}
              {!showLocked && allDoctors.length > 1 && (
                <label className="block px-2 pb-2 text-[11px] text-slate-500">
                  Clinician
                  <select
                    aria-label="Doctor Profile Selector"
                    value={currentDoctor.id}
                    onChange={(e) => {
                      const doc = allDoctors.find((d) => d.id === e.target.value);
                      if (doc) onSelectDoctor(doc);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800"
                  >
                    {allDoctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {canOpenClinicalAssistant(userRole) && (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-700"
                  onClick={() => {
                    setMenuOpen(false);
                    toggleCopilot();
                  }}
                >
                  Assistant
                </button>
              )}
              {canOpenAdmin && (
                <Link to="/admin" role="menuitem" className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-700" onClick={() => setMenuOpen(false)}>
                  <Shield className="w-3.5 h-3.5" /> Admin
                </Link>
              )}
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-700"
                onClick={() => {
                  setMenuOpen(false);
                  go("landing", { explicitPublic: true });
                }}
              >
                Exit to site
              </button>
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-700 inline-flex items-center gap-1"
                onClick={() => logout().then(() => go("landing"))}
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
