import React, { useEffect, useState } from 'react';
import { 
  Sparkles, 
  FileText, 
  Activity, 
  Monitor, 
  Calendar, 
  Building2, 
  ReceiptIndianRupee, 
  MessageSquare, 
  PhoneCall, 
  Users, 
  LayoutDashboard,
  User,
  UserPlus,
  X,
  ChevronLeft,
  ChevronRight,
  Award,
  UserCheck,
  LogOut,
  Plus,
  Settings,
  Shield,
  Pill
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { NavView } from './Navbar';
import { Patient, Doctor } from '../types';
import { useAuth } from '../auth/AuthContext';
import { useNav } from '../nav/NavigationContext';
import { appViewToPath } from '../nav/surfaces';
import { isPolyclinicPractice } from '../lib/sessionWorkspace';
import { allowedViewsForWorkflow, clinicianHomeView, patientsNavLabel, workflowForUser } from '../lib/specialtyWorkflow';
import { clinicNavItems, greetingClinicName, moreNavItems, primaryNavItems, whatsAppPillFromStatus, type WhatsAppPillState } from '../lib/clinicNav';
import { apiFetch } from '../api/http';

export const ROLE_VISIBLE_VIEWS: Record<string, NavView[]> = {
  doctor: ['welcome', 'gp-home', 'patients', 'queue', 'opd-queue', 'rx', 'smart-rx', 'ambient', 'reports', 'appointments', 'polyclinic', 'whatsapp', 'voicebot', 'pharmacy-hub', 'billing', 'dhis', 'team', 'reception', 'kiosk', 'settings', 'wellness', 'therapy-session', 'consult-practice', 'physio-session', 'dental-chart'],
  receptionist: ['welcome', 'gp-home', 'patients', 'reception', 'queue', 'opd-queue', 'appointments', 'kiosk', 'pharmacy-hub', 'billing', 'whatsapp', 'settings'],
  polyclinic_admin: ['welcome', 'gp-home', 'patients', 'queue', 'opd-queue', 'reception', 'appointments', 'polyclinic', 'billing', 'reports', 'whatsapp', 'voicebot', 'pharmacy-hub', 'dhis', 'team', 'kiosk', 'settings'],
  CLINIC_ADMIN: ['welcome', 'gp-home', 'patients', 'queue', 'opd-queue', 'reception', 'appointments', 'polyclinic', 'billing', 'reports', 'whatsapp', 'voicebot', 'pharmacy-hub', 'dhis', 'portal', 'team', 'kiosk', 'settings'],
  super_admin: ['settings'],
  patient: ['portal'],
  nurse: ['reception', 'queue', 'opd-queue', 'reports', 'pharmacy-hub', 'settings'],
  lab_technician: ['reports', 'queue', 'opd-queue', 'pharmacy-hub', 'settings'],
  pharmacist: ['billing', 'pharmacy-hub', 'queue', 'opd-queue', 'settings'],
  default: ['welcome', 'gp-home', 'queue', 'opd-queue', 'reception', 'appointments', 'pharmacy-hub', 'billing', 'settings']
};

/** Platform admins get no clinical sidebar views. Unknown roles keep the doctor fallback. */
export function visibleViewsForRole(role: string | undefined | null): NavView[] {
  if (role === "super_admin" || role === "admin") return [];
  return ROLE_VISIBLE_VIEWS[role || "doctor"] || ROLE_VISIBLE_VIEWS.doctor;
}

export function sidebarShowsClinicalChrome(role: string | undefined | null): boolean {
  return role !== "super_admin" && role !== "admin";
}

interface SidebarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  currentPatient: Patient;
  onSelectPatient: (patient: Patient) => void;
  allPatients: Patient[];
  currentDoctor: Doctor;
  onPatientCreated?: (patient: Patient) => void;
  onNavigate?: () => void;
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
  onPatientCreated,
  onNavigate,
}) => {
  const { user, logout } = useAuth();
  const { go, workspaceSlug } = useNav();
  const userRole = user?.role || 'doctor';
  let allowedViews = visibleViewsForRole(userRole);
  const polyclinic = isPolyclinicPractice(user);
  if (!polyclinic) {
    allowedViews = allowedViews.filter(v => v !== 'team' && v !== 'polyclinic');
  }
  const pack = workflowForUser(user);
  allowedViews = allowedViewsForWorkflow(allowedViews, pack);

  const canOpenAdminCms = userRole === 'super_admin';
  const homeView = clinicianHomeView(user);
  const navItems = clinicNavItems({
    role: userRole,
    allowedViews,
    homeView,
    patientsLabel: patientsNavLabel(pack),
  });
  const primaryItems = primaryNavItems(navItems);
  const moreItems = moreNavItems(navItems);
  const clinicLabel = greetingClinicName(user?.clinicName);
  const [waPill, setWaPill] = useState<{ label: string; state: WhatsAppPillState }>({
    label: "WhatsApp status unavailable",
    state: "unknown",
  });

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ tenantNumber?: { status?: string } | null }>("/api/whatsapp-numbers/mine")
      .then((data) => {
        if (cancelled) return;
        const status = data?.tenantNumber?.status;
        setWaPill(whatsAppPillFromStatus(status || "disconnected"));
      })
      .catch(() => {
        if (!cancelled) setWaPill(whatsAppPillFromStatus(null));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.tenantId]);

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickOptIn, setQuickOptIn] = useState(false);

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickName.trim() || !quickPhone.trim()) {
      setQuickError('Please enter both patient name and phone number.');
      return;
    }
    setQuickSubmitting(true);
    setQuickError(null);
    try {
      const data = await apiFetch<{ patient: Patient }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          name: quickName.trim(),
          phone: quickPhone.trim(),
          age: 30,
          gender: 'Other',
          bloodGroup: 'O+',
          whatsappOptIn: quickOptIn,
        }),
      });
      if (data && data.patient) {
        onPatientCreated?.(data.patient);
        onSelectPatient(data.patient);
        setIsQuickAddOpen(false);
        setQuickName('');
        setQuickPhone('');
        setQuickOptIn(false);
      }
    } catch (err: any) {
      setQuickError(err?.message || 'Failed to register patient.');
    } finally {
      setQuickSubmitting(false);
    }
  };

  const selectablePatients = allPatients.filter((p) => p.id);
  const NAV_ICONS: Partial<Record<NavView, typeof Calendar>> = {
    welcome: LayoutDashboard,
    'gp-home': LayoutDashboard,
    appointments: Calendar,
    queue: Users,
    rx: FileText,
    billing: ReceiptIndianRupee,
    patients: User,
    reception: UserCheck,
    'pharmacy-hub': Pill,
    reports: Activity,
    whatsapp: MessageSquare,
    voicebot: PhoneCall,
    kiosk: Monitor,
    ambient: Sparkles,
    dhis: Award,
    team: Users,
    polyclinic: Building2,
    portal: User,
    settings: Settings,
    'physio-session': Sparkles,
    'dental-chart': Sparkles,
    wellness: Sparkles,
    'therapy-session': Sparkles,
    'consult-practice': Sparkles,
  };

  return (
    <aside
      data-testid="app-sidebar"
      data-pack-kind={pack.kind}
      className={`${
        isCollapsed ? 'w-16' : 'w-60'
      } h-full flex-shrink-0 bg-white border-r border-slate-200 text-slate-600 flex flex-col transition-all duration-200 select-none overflow-hidden`}
    >
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 ${isCollapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center font-semibold shrink-0">
          {clinicLabel.charAt(0).toUpperCase()}
        </div>
        {!isCollapsed && (
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{clinicLabel}</p>
            <p className="text-[11px] text-slate-400 truncate">{pack.practiceLine}</p>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden p-2 space-y-0.5">
        {primaryItems.map((item) => {
          const Icon = NAV_ICONS[item.id] || Sparkles;
          const isActive =
            !item.payFocus &&
            (currentView === item.id ||
              (item.id === 'queue' && currentView === 'opd-queue') ||
              (item.id === 'rx' && currentView === 'smart-rx') ||
              (item.label === 'Dashboard' && currentView === homeView));
          return (
            <Link
              key={item.testId}
              to={appViewToPath(item.id, workspaceSlug)}
              onClick={() => {
                if (item.payFocus) {
                  try { sessionStorage.setItem('lumera-bill-focus', 'pay'); } catch { /* ignore */ }
                }
                onNavigate?.();
              }}
              data-testid={item.testId}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center ${
                isCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
              } py-1.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
        {moreItems.length > 0 && (
          <details className="group" data-testid="nav-more">
            <summary className={`cursor-pointer list-none flex items-center ${isCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3'} py-1.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100`}>
              <ChevronRight className="w-4 h-4 shrink-0 text-slate-400 group-open:rotate-90" />
              {!isCollapsed && <span>More</span>}
            </summary>
            <div className="mt-0.5 space-y-0.5 max-h-40 overflow-y-auto">
              {moreItems.map((item) => {
                const Icon = NAV_ICONS[item.id] || Sparkles;
                const isActive = !item.payFocus && currentView === item.id;
                return (
                  <Link
                    key={item.testId}
                    to={appViewToPath(item.id, workspaceSlug)}
                    onClick={() => onNavigate?.()}
                    data-testid={item.testId}
                    title={isCollapsed ? item.label : undefined}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
                    } py-1.5 rounded-xl text-sm font-medium ${
                      isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
              {selectablePatients.length > 0 && !isCollapsed && (
                <label className="block px-2 pt-1 text-[10px] text-slate-400">
                  Active patient
                  <select
                    aria-label="Quick Select Active Patient"
                    value={currentPatient.id}
                    onChange={(e) => {
                      const p = allPatients.find((pat) => pat.id === e.target.value);
                      if (p) onSelectPatient(p);
                    }}
                    className="mt-1 w-full bg-white border border-slate-200 text-slate-800 text-xs rounded px-2 py-1"
                  >
                    {!currentPatient.id && <option value="">No patient selected</option>}
                    {selectablePatients.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
        )}
      </div>

      <div className="p-3 border-t border-slate-100 bg-white space-y-2.5 shrink-0">
        {!isCollapsed && (
          <p
            data-testid="whatsapp-status-pill"
            data-state={waPill.state}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              waPill.state === "connected"
                ? "bg-emerald-50 text-emerald-700"
                : waPill.state === "disconnected"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${waPill.state === "connected" ? "bg-emerald-500" : waPill.state === "disconnected" ? "bg-rose-500" : "bg-slate-400"}`} />
            {waPill.label}
          </p>
        )}
        {canOpenAdminCms && !isCollapsed && (
          <Link
            to="/admin"
            className="w-full flex items-center px-3 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <Shield className="w-4 h-4 shrink-0 mr-2.5" />
            Admin
          </Link>
        )}

        {!isCollapsed ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
              {(user?.name || "U").charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 truncate">{user?.name || "Signed in"}</p>
              <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsQuickAddOpen(true)}
              className="text-blue-700 p-1 rounded hover:bg-blue-50"
              title="Quick Add Patient"
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-2">
            <div
              className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400 text-xs font-bold cursor-pointer hover:bg-slate-700"
              title={`${currentPatient.name} (${currentPatient.uhid})`}
            >
              {currentPatient.name.charAt(0)}
            </div>
            <button
              onClick={() => setIsQuickAddOpen(true)}
              className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 flex items-center justify-center transition-colors"
              title="Quick Add Patient"
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </div>
        )}

        {isQuickAddOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Quick Add Patient</h3>
                    <p className="text-[11px] text-slate-500">Fast intake with name &amp; phone number</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsQuickAddOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {quickError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {quickError}
                </div>
              )}

              <form onSubmit={handleQuickAddSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="Patient mobile"
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={quickOptIn}
                    onChange={(e) => setQuickOptIn(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Patient agrees to WhatsApp messages from this clinic</span>
                </label>

                <div className="pt-2 flex items-center justify-end space-x-2.5">
                  <button
                    type="button"
                    onClick={() => setIsQuickAddOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={quickSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {quickSubmitting ? 'Registering...' : 'Register & Select'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <button
          onClick={() => logout().then(() => go("landing"))}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-2 px-3'} py-2 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg`}
          title="Logout"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="font-medium">Logout</span>}
        </button>

        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center space-x-1.5 py-1.5 text-xs text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
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
