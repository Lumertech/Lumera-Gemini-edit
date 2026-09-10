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
  ChevronLeft,
  ChevronRight,
  Award,
  UserCheck,
  LogOut,
  Plus,
  Settings,
  Shield
} from 'lucide-react';
import { NavView } from './Navbar';
import { Patient, Doctor } from '../types';
import { useAuth } from '../auth/AuthContext';
import { useNav } from '../nav/NavigationContext';
import { isPolyclinicPractice } from '../lib/sessionWorkspace';
import { allowedViewsForWorkflow, workflowForUser } from '../lib/specialtyWorkflow';

export const ROLE_VISIBLE_VIEWS: Record<string, NavView[]> = {
  doctor: ['welcome', 'queue', 'opd-queue', 'rx', 'smart-rx', 'ambient', 'reports', 'appointments', 'polyclinic', 'whatsapp', 'voicebot', 'billing', 'dhis', 'team', 'reception', 'kiosk', 'settings', 'wellness', 'therapy-session', 'consult-practice', 'physio-session', 'dental-chart'],
  receptionist: ['welcome', 'reception', 'queue', 'opd-queue', 'appointments', 'kiosk', 'billing', 'whatsapp', 'settings'],
  polyclinic_admin: ['welcome', 'queue', 'opd-queue', 'reception', 'appointments', 'polyclinic', 'billing', 'reports', 'whatsapp', 'voicebot', 'dhis', 'team', 'kiosk', 'settings'],
  CLINIC_ADMIN: ['welcome', 'queue', 'opd-queue', 'reception', 'appointments', 'polyclinic', 'billing', 'reports', 'whatsapp', 'voicebot', 'dhis', 'portal', 'team', 'kiosk', 'settings'],
  super_admin: ['welcome', 'queue', 'opd-queue', 'reception', 'rx', 'smart-rx', 'ambient', 'reports', 'appointments', 'polyclinic', 'whatsapp', 'voicebot', 'billing', 'dhis', 'team', 'kiosk', 'settings'],
  patient: ['portal'],
  nurse: ['reception', 'queue', 'opd-queue', 'reports', 'settings'],
  lab_technician: ['reports', 'queue', 'opd-queue', 'settings'],
  pharmacist: ['billing', 'queue', 'opd-queue', 'settings'],
  default: ['welcome', 'queue', 'opd-queue', 'reception', 'appointments', 'billing', 'settings']
};

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
  const { user, logout } = useAuth();
  const { go } = useNav();
  const userRole = user?.role || 'doctor';
  let allowedViews = ROLE_VISIBLE_VIEWS[userRole] || ROLE_VISIBLE_VIEWS.doctor;
  const polyclinic = isPolyclinicPractice(user);
  if (!polyclinic) {
    allowedViews = allowedViews.filter(v => v !== 'team' && v !== 'polyclinic');
  }
  const pack = workflowForUser(user);
  allowedViews = allowedViewsForWorkflow(allowedViews, pack);

  const canStartConsult = allowedViews.includes('rx') || allowedViews.includes('smart-rx') || allowedViews.includes(pack.homeView as NavView);
  const startView = (pack.showMedicalRx ? 'rx' : pack.homeView) as NavView;
  const canOpenAdminCms = userRole === 'super_admin';

  const suiteTitle =
    pack.kind === 'physio' ? '1. Rehab suite' :
    pack.kind === 'dental' ? '1. Dental operatory' :
    pack.kind === 'wellness' ? '1. Salon / spa book' :
    pack.kind === 'therapy' ? '1. Therapy desk' :
    pack.kind === 'consultant' ? '1. Consulting desk' :
    '1. Clinical Suite';
  const flowTitle =
    pack.kind === 'physio' ? '2. Sessions' :
    pack.kind === 'dental' ? '2. Chair flow' :
    pack.kind === 'wellness' ? '2. Bookings' :
    pack.kind === 'therapy' ? '2. Calendar' :
    pack.kind === 'consultant' ? '2. Meetings' :
    '2. OPD Flow & Queue';

  const NAV_SECTIONS = [
    {
      title: suiteTitle,
      items: [
        ...(pack.homeView !== 'queue' && pack.homeView !== 'rx'
          ? [{ id: pack.homeView as NavView, label: pack.chartLabel, icon: Sparkles }]
          : []),
        ...(pack.showMedicalRx
          ? [{
              id: 'rx' as NavView,
              label: pack.kind === 'physio' ? 'Exercises & procedures' : pack.kind === 'dental' ? 'Odontogram / visit' : 'Smart Rx Studio',
              icon: FileText,
              badge: pack.kind === 'medical' ? 'Rx' : pack.kind === 'physio' ? 'HEP' : 'Chart',
              badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
            }]
          : []),
        ...(pack.kind === 'medical'
          ? [{
              id: 'ambient' as NavView,
              label: 'Ambient AI Scribe',
              icon: Sparkles,
              badge: 'Live',
              badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
            }, {
              id: 'reports' as NavView,
              label: 'AI Lab OCR & Diagnostic Trends',
              icon: Activity,
              badge: 'OCR',
              badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
            }]
          : []),
      ],
    },
    {
      title: flowTitle,
      items: [
        {
          id: 'queue' as NavView,
          label: pack.queueLabel || 'Live OPD Queue & Triage',
          icon: Users,
        },
        {
          id: 'reception' as NavView,
          label: pack.receptionLabel || 'OPD Reception & ABHA (ABDM)',
          icon: UserCheck,
          badge: pack.kind === 'medical' ? 'ABDM' : undefined,
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        },
        {
          id: 'appointments' as NavView,
          label: pack.appointmentsLabel || 'Appointments & Schedule',
          icon: Calendar,
        },
        {
          id: 'polyclinic' as NavView,
          label: 'Polyclinic Roster',
          icon: Building2,
        },
        {
          id: 'kiosk' as NavView,
          label: 'TV Waiting Kiosk Display',
          icon: Monitor,
        },
      ],
    },
    {
      title: '3. Practice & Financial Management',
      items: [
        {
          id: 'billing' as NavView,
          label: pack.billingLabel || 'Billing, Claims & E-Invoicing',
          icon: Receipt,
        },
        {
          id: 'whatsapp' as NavView,
          label: 'WhatsApp Suite & Patient Engagement',
          icon: MessageSquare,
        },
        {
          id: 'voicebot' as NavView,
          label: 'AI Voice Receptionist',
          icon: PhoneCall,
        },
        {
          id: 'dhis' as NavView,
          label: 'DHIS Incentive & Analytics Meter',
          icon: Award,
          badge: '₹20/tx',
          badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
        },
      ],
    },
  ];

  const filteredSections = NAV_SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(item => 
      allowedViews.includes(item.id) ||
      (item.id === 'queue' && allowedViews.includes('opd-queue')) ||
      (item.id === 'rx' && allowedViews.includes('smart-rx'))
    )
  })).filter(section => section.items.length > 0);

  const selectablePatients = allPatients.filter((p) => p.id);

  return (
    <aside
      data-testid="app-sidebar"
      data-pack-kind={pack.kind}
      className={`${
        isCollapsed ? 'w-16' : 'w-64'
      } flex-shrink-0 bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col justify-between transition-all duration-200 select-none z-20 overflow-hidden`}
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
        {canStartConsult && (
          <button
            type="button"
            onClick={() => onSelectView(startView)}
            title={isCollapsed ? pack.primaryCta : undefined}
            className={`w-full flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'justify-center gap-2 px-3'
            } py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-blue-600/30 hover:from-cyan-400 hover:to-blue-500`}
          >
            <Plus className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>+ {pack.primaryCta}</span>}
          </button>
        )}

        {filteredSections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {!isCollapsed && (
              <h3 className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {section.title}
              </h3>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  currentView === item.id ||
                  (item.id === 'queue' && currentView === 'opd-queue') ||
                  (item.id === 'rx' && currentView === 'smart-rx');
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

      <div className="p-3 border-t border-slate-800 bg-slate-950/60 space-y-2.5 shrink-0">
        {!isCollapsed && (
          <div className="space-y-0.5 pb-1">
            <h3 className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              4. Settings & Profile
            </h3>
            <button
              type="button"
              onClick={() => onSelectView('settings')}
              className={`w-full flex items-center px-3 py-2 rounded-lg text-xs font-medium ${
                currentView === 'settings'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <Settings className="w-4 h-4 shrink-0 mr-2.5" />
              Clinic & Doctor Profile Settings
            </button>
            {canOpenAdminCms && (
              <button
                type="button"
                onClick={() => go('admin')}
                className="w-full flex items-center px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80"
              >
                <Shield className="w-4 h-4 shrink-0 mr-2.5" />
                Admin CMS
              </button>
            )}
          </div>
        )}
        {isCollapsed && (
          <button
            type="button"
            onClick={() => onSelectView('settings')}
            className="w-full flex justify-center py-2 rounded-lg text-slate-300 hover:bg-slate-800"
            title="Clinic & Doctor Profile Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

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

            {selectablePatients.length > 0 ? (
              <select
                aria-label="Quick Select Active Patient"
                value={currentPatient.id}
                onChange={(e) => {
                  const p = allPatients.find((pat) => pat.id === e.target.value);
                  if (p) onSelectPatient(p);
                }}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer"
              >
                {!currentPatient.id && (
                  <option value="" className="bg-slate-900 text-white">
                    No patient selected
                  </option>
                )}
                {selectablePatients.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name} ({p.age}y/{p.gender.charAt(0)})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-slate-400">No patients registered yet.</p>
            )}

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

        <button
          onClick={() => logout().then(() => go("landing"))}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-2 px-3'} py-2 text-xs text-rose-300 hover:text-white hover:bg-rose-500/20 rounded-md transition-colors border border-rose-500/20`}
          title="Logout"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="font-medium">Logout</span>}
        </button>

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
