import React from "react";
import {
  LayoutDashboard,
  Users,
  KeyRound,
  Globe,
  FileText,
  Image,
  History,
  LogOut,
  Home,
  Shield,
  Share2,
  Award,
  UserCircle,
  Stethoscope,
  Building2,
  Settings,
  Network,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Link } from "react-router-dom";
import { AdminTab, useNav } from "../../nav/NavigationContext";
import { adminTabToPath } from "../../nav/surfaces";
import { AdminOverview } from "./AdminOverview";
import { AdminUsers } from "./AdminUsers";
import { AdminProfile } from "./AdminProfile";
import { AdminPeople } from "./AdminPeople";
import { AdminBranches } from "./AdminBranches";
import { AdminTenants } from "./AdminTenants";
import { AdminSubscriptions } from "./AdminSubscriptions";
import { AdminCmsSite } from "./AdminCmsSite";
import { AdminPolicies } from "./AdminPolicies";
import { AdminMedia } from "./AdminMedia";
import { AdminSettings } from "./AdminSettings";
import { AdminAudit } from "./AdminAudit";
import { AdminMetaTechProvider } from "./AdminMetaTechProvider";
import { DhisMeter } from "../dhis/DhisMeter";
import { TenantScopeProvider, useTenantScope } from "./TenantScopeContext";

/** Clinic desk — CLINIC_ADMIN / polyclinic_admin / super_admin. */
const DESK_TABS = new Set<AdminTab>(["overview", "users", "people", "branches", "profile", "settings", "audit"]);
/** Platform Superadmin — Tenants + all-tenant Subs. CLINIC_ADMIN must not see these (T-6). */
const SUPERADMIN_TABS = new Set<AdminTab>(["tenants", "subscriptions"]);
/** Platform / Meta / CMS — super_admin only, listed after Superadmin tabs. */
const PLATFORM_TABS = new Set<AdminTab>(["dhis", "meta", "site", "policies", "media"]);

const NAV: { id: AdminTab; label: string; icon: typeof Users; badge?: string; group?: "desk" | "superadmin" | "platform" }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard, group: "desk" },
  { id: "users", label: "User management", icon: Users, group: "desk" },
  { id: "people", label: "Doctors & staff", icon: Stethoscope, group: "desk" },
  { id: "branches", label: "Branches", icon: Building2, group: "desk" },
  { id: "profile", label: "Admin profile", icon: UserCircle, group: "desk" },
  { id: "settings", label: "Clinic & AI settings", icon: Settings, group: "desk" },
  { id: "audit", label: "Audit log", icon: History, group: "desk" },
  { id: "tenants", label: "Tenants", icon: Network, group: "superadmin" },
  { id: "subscriptions", label: "Subscriptions", icon: KeyRound, group: "superadmin" },
  { id: "dhis", label: "ABDM & DHIS Meter", icon: Award, group: "platform" },
  { id: "meta", label: "Meta WhatsApp", icon: Share2, badge: "SANDBOX", group: "platform" },
  { id: "site", label: "Website CMS", icon: Globe, group: "platform" },
  { id: "policies", label: "Pages & policies", icon: FileText, group: "platform" },
  { id: "media", label: "Media library", icon: Image, group: "platform" },
];

export const AdminShell: React.FC = () => {
  return (
    <TenantScopeProvider>
      <AdminShellInner />
    </TenantScopeProvider>
  );
};

const AdminShellInner: React.FC = () => {
  const { user, logout } = useAuth();
  const { go, adminTab } = useNav();
  const { scope, clearScope } = useTenantScope();

  const isAdmin = user && (user.role === "super_admin" || user.role === "polyclinic_admin" || user.role === "CLINIC_ADMIN");
  const isPlatformAdmin = user?.role === "super_admin";
  const navItems = NAV.filter((item) => {
    if (SUPERADMIN_TABS.has(item.id) && !isPlatformAdmin) return false;
    if (PLATFORM_TABS.has(item.id) && !isPlatformAdmin) return false;
    if (item.id === "tenants" && !isPlatformAdmin) return false;
    if (DESK_TABS.has(item.id) || SUPERADMIN_TABS.has(item.id) || PLATFORM_TABS.has(item.id)) return true;
    return true;
  });
  const safeTab = navItems.some((item) => item.id === adminTab) ? adminTab : "overview";

  if (!isAdmin) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold">Admin - Administrator Only</h2>
          <p className="text-xs text-slate-400">
            This control panel is restricted to Administrator roles only. Please sign in with an administrator profile or return to the public site.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => go("login", { loginNext: "admin" })}
              className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold transition-colors"
            >
              Sign In as Admin
            </button>
            <button
              onClick={() => go("landing", { explicitPublic: true })}
              className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
            >
              Public Site
            </button>
          </div>
        </div>
      </div>
    );
  }

  const panel = {
    overview: <AdminOverview />,
    dhis: <DhisMeter compact={false} />,
    meta: <AdminMetaTechProvider />,
    users: <AdminUsers />,
    profile: <AdminProfile />,
    people: <AdminPeople />,
    branches: <AdminBranches />,
    tenants: <AdminTenants />,
    subscriptions: <AdminSubscriptions />,
    site: <AdminCmsSite />,
    policies: <AdminPolicies />,
    media: <AdminMedia />,
    settings: <AdminSettings />,
    audit: <AdminAudit />,
  }[safeTab];

  return (
    <div className="h-screen flex bg-slate-50 text-slate-900">
      <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 text-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-6 flex items-center gap-3 border-b border-slate-700/80">
          <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-manrope text-sm font-bold text-white">Lumera Admin</div>
            <div className="text-[11px] text-slate-400 truncate max-w-[140px]">{user?.email}</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {(["desk", "superadmin", "platform"] as const).map((group) => {
            const items = navItems.filter((item) => (item.group || "desk") === group);
            if (!items.length) return null;
            return (
              <div key={group} className="space-y-1">
                {group === "superadmin" && (
                  <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Superadmin
                  </div>
                )}
                {group === "platform" && (
                  <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Platform
                  </div>
                )}
                {items.map((item) => {
                  const Icon = item.icon;
                  const isActive = safeTab === item.id;
                  return (
                    <Link
                      key={item.id}
                      to={adminTabToPath(item.id)}
                      data-testid={`admin-nav-${item.id}`}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-left ${
                        isActive ? "bg-purple-600 text-white" : "text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                            isActive
                              ? "bg-white/15 text-amber-100 border-amber-200/40"
                              : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-700 space-y-2">
          <button
            type="button"
            onClick={() => go("landing", { explicitPublic: true })}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-slate-300 border border-slate-600 hover:bg-slate-700"
          >
            <Home className="w-4 h-4" /> Back to landing
          </button>
          <button
            type="button"
            onClick={() => {
              clearScope();
              logout().then(() => go("landing"));
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-slate-300 border border-slate-600 hover:bg-slate-700"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        {isPlatformAdmin && scope && (
          <div
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5 text-xs"
            data-testid="tenant-context-switcher"
          >
            <div>
              <div className="text-[10px] uppercase tracking-wider text-purple-700 font-semibold">Tenant context</div>
              <div className="font-bold text-slate-900" data-testid="tenant-context-name">
                {scope.name}
              </div>
              <div className="font-mono text-[11px] text-slate-500" data-testid="tenant-context-id">
                {scope.id}
              </div>
            </div>
            <Link
              to={adminTabToPath("tenants")}
              onClick={() => clearScope()}
              className="px-3 py-1.5 rounded-lg border border-purple-300 text-purple-800 font-semibold bg-white"
              data-testid="tenant-context-exit"
            >
              Exit to platform
            </Link>
          </div>
        )}
        {adminTab !== safeTab && SUPERADMIN_TABS.has(adminTab) && !isPlatformAdmin && (
          <p className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="superadmin-tab-forbidden">
            Tenants and all-tenant subscriptions are restricted to super_admin. Clinic admins cannot list every tenant.
          </p>
        )}
        <div key={safeTab} data-testid="admin-tab-remount">
          {panel}
        </div>
      </main>
    </div>
  );
};
