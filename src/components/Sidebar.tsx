import React from 'react';
import { 
  Sparkles, 
  FileText, 
  Activity, 
  Monitor, 
  Calendar, 
  Building2, 
  Receipt, 
  MessageSquare, 
  PhoneCall, 
  Users, 
  User, 
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { NavView } from './Navbar';
import { Patient, Doctor } from '../types';

interface SidebarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  currentPatient: Patient;
  onSelectPatient: (patient: Patient) => void;
  allPatients: Patient[];
  currentDoctor: Doctor;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  isCollapsed,
  onToggleCollapse,
  currentPatient,
  onSelectPatient,
  allPatients,
  currentDoctor,
}) => {
  const NAV_SECTIONS = [
    {
      title: 'Clinical AI & Consultation',
      items: [
        {
          id: 'ambient' as NavView,
          label: 'Ambient AI Scribe',
          icon: Sparkles,
          badge: 'Live',
          badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        },
        {
          id: 'rx' as NavView,
          label: 'Smart Rx Studio',
          icon: FileText,
          badge: 'Rx',
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        },
        {
          id: 'reports' as NavView,
          label: 'AI Lab OCR & Trends',
          icon: Activity,
          badge: 'OCR',
          badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
        },
      ],
    },
    {
      title: 'OPD Flow & Diagnostics',
      items: [
        {
          id: 'queue' as NavView,
          label: 'OPD Queue & Vitals',
          icon: Users,
        },
        {
          id: 'kiosk' as NavView,
          label: 'TV Waiting Kiosk',
          icon: Monitor,
        },
        {
          id: 'appointments' as NavView,
          label: 'Appointments',
          icon: Calendar,
        },
        {
          id: 'polyclinic' as NavView,
          label: 'Polyclinic Roster',
          icon: Building2,
        },
      ],
    },
    {
      title: 'Practice & Engagement',
      items: [
        {
          id: 'billing' as NavView,
          label: 'Billing & Payments',
          icon: Receipt,
        },
        {
          id: 'whatsapp' as NavView,
          label: 'WhatsApp Suite',
          icon: MessageSquare,
        },
        {
          id: 'voicebot' as NavView,
          label: 'AI Voice Receptionist',
          icon: PhoneCall,
        },
        {
          id: 'portal' as NavView,
          label: 'Patient EMR Portal',
          icon: ShieldCheck,
        },
        {
          id: 'team' as NavView,
          label: 'Clinic team',
          icon: Stethoscope,
          badge: 'Staff',
          badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
        },
      ],
    },
  ];

  return (
    <aside
      className={`${
        isCollapsed ? 'w-16' : 'w-64'
      } flex-shrink-0 bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col justify-between transition-all duration-200 select-none z-20 overflow-hidden`}
    >
      {/* Top Section: Navigation Links */}
      <div className="flex-1 overflow-y-auto p-3 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {!isCollapsed && (
              <h3 className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {section.title}
              </h3>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectView(item.id)}
                    title={isCollapsed ? item.label : undefined}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center px-2' : 'justify-between px-3'
                    } py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white font-semibold shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-white' : 'text-slate-400'
                        }`}
                      />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </div>

                    {!isCollapsed && item.badge && (
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded border font-mono font-semibold ${
                          isActive
                            ? 'bg-white/20 text-white border-white/30'
                            : item.badgeColor
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Section: Active Patient & Doctor Context + Collapse Toggle */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/60 space-y-2.5 shrink-0">
        {!isCollapsed ? (
          <div className="bg-slate-800/80 rounded-lg p-2.5 border border-slate-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <User className="w-3 h-3 text-blue-400" />
                Active Patient
              </span>
              <span className="text-[9px] font-mono text-blue-300 bg-blue-500/20 px-1.5 py-0.2 rounded">
                {currentPatient.uhid}
              </span>
            </div>

            <div>
              <select
                aria-label="Quick Select Active Patient"
                value={currentPatient.id}
                onChange={(e) => {
                  const p = allPatients.find((pat) => pat.id === e.target.value);
                  if (p) onSelectPatient(p);
                }}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer"
              >
                {allPatients.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name} ({p.age}y/{p.gender.charAt(0)})
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[10px] text-slate-400 flex items-center justify-between pt-0.5">
              <span>Doctor:</span>
              <span className="text-slate-200 font-medium truncate max-w-[120px]">{currentDoctor.name}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div
              className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400 text-xs font-bold"
              title={`${currentPatient.name} (${currentPatient.uhid})`}
            >
              {currentPatient.name.charAt(0)}
            </div>
          </div>
        )}

        {/* Collapse / Expand Toggle Button */}
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center space-x-1.5 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-md transition-colors"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span className="text-[11px] font-medium">Collapse Sidebar</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
