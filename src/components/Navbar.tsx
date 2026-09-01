import React from 'react';
import { 
  Stethoscope, 
  Sparkles, 
  Users, 
  Calendar, 
  FileText, 
  Receipt, 
  MessageSquare, 
  PhoneCall, 
  Building2, 
  Bot, 
  Activity,
  Plus,
  UserCheck,
  Menu,
  ChevronRight,
  ShieldAlert
} from 'lucide-react';
import { Doctor } from '../types';

export type NavView = 
  | 'ambient' 
  | 'rx' 
  | 'queue' 
  | 'kiosk'
  | 'reports'
  | 'appointments' 
  | 'polyclinic' 
  | 'whatsapp' 
  | 'voicebot' 
  | 'billing' 
  | 'portal';

interface NavbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  currentDoctor: Doctor;
  onSelectDoctor: (doctor: Doctor) => void;
  allDoctors: Doctor[];
  onToggleHexa: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  currentDoctor,
  onSelectDoctor,
  allDoctors,
  onToggleHexa,
  onToggleSidebar,
  isSidebarCollapsed,
}) => {
  const VIEW_TITLES: Record<NavView, string> = {
    ambient: 'Ambient AI Scribe & SOAP',
    rx: 'Smart Rx & Specialty Studio',
    queue: 'Live OPD Queue & Triage',
    kiosk: 'Waiting Room TV Kiosk',
    reports: 'AI Lab OCR & Biomarker Trends',
    appointments: 'Appointments Calendar',
    polyclinic: 'Polyclinic Specialty Roster',
    billing: 'Billing & GST Invoices',
    whatsapp: 'WhatsApp AI Suite',
    voicebot: 'AI Voice Receptionist',
    portal: 'Patient EMR Portal',
  };

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 text-white flex items-center justify-between px-4 sm:px-6 shrink-0 select-none z-30 shadow-sm">
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
        <div 
          className="flex items-center space-x-2.5 cursor-pointer" 
          onClick={() => onSelectView('ambient')}
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
        </div>

        {/* Breadcrumb Separator & Current View */}
        <div className="hidden md:flex items-center space-x-2 text-xs text-slate-400 pl-2 border-l border-slate-800">
          <span className="text-slate-200 font-medium">{VIEW_TITLES[currentView] || 'Clinical Workspace'}</span>
        </div>
      </div>

      {/* Right: Quick Actions & Doctor Profile */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Doctor Switcher Dropdown */}
        <div className="flex items-center space-x-1.5 bg-slate-800 border border-slate-700/80 px-2.5 py-1.5 rounded-lg text-xs">
          <UserCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <select
            aria-label="Doctor Profile Selector"
            value={currentDoctor.id}
            onChange={(e) => {
              const doc = allDoctors.find((d) => d.id === e.target.value);
              if (doc) onSelectDoctor(doc);
            }}
            className="bg-transparent text-slate-200 text-xs font-medium focus:outline-none cursor-pointer max-w-[130px] sm:max-w-[190px] truncate"
          >
            {allDoctors.map((d) => (
              <option key={d.id} value={d.id} className="bg-slate-900 text-white">
                {d.name} ({d.specialty})
              </option>
            ))}
          </select>
        </div>

        {/* Quick New Rx Action */}
        <button
          onClick={() => onSelectView('rx')}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-sm shadow-blue-600/30"
          title="Create New Digital Prescription"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Rx</span>
        </button>

        {/* Hexa AI Copilot button */}
        <button
          onClick={onToggleHexa}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold transition-all shadow-sm shadow-indigo-500/20"
          title="Open HEXA AI Clinical Decision Support"
        >
          <Bot className="w-3.5 h-3.5 text-blue-200" />
          <span className="hidden sm:inline">HEXA AI</span>
        </button>
      </div>
    </header>
  );
};
