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
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { AdminTab, useNav } from "../../nav/NavigationContext";
import { AdminOverview } from "./AdminOverview";
import { AdminUsers } from "./AdminUsers";
import { AdminSubscriptions } from "./AdminSubscriptions";
import { AdminCmsSite } from "./AdminCmsSite";
import { AdminPolicies } from "./AdminPolicies";
import { AdminMedia } from "./AdminMedia";
import { AdminAudit } from "./AdminAudit";
import { AdminMetaTechProvider } from "./AdminMetaTechProvider";
import { DhisMeter } from "../dhis/DhisMeter";

const NAV: { id: AdminTab; label: string; icon: typeof Users; badge?: string }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "dhis", label: "ABDM & DHIS Meter", icon: Award },
  { id: "meta", label: "Meta WhatsApp", icon: Share2, badge: "SANDBOX" },
  { id: "users", label: "User management", icon: Users },
  { id: "subscriptions", label: "Subscriptions", icon: KeyRound },
  { id: "site", label: "Website CMS", icon: Globe },
  { id: "policies", label: "Pages & policies", icon: FileText },
  { id: "media", label: "Media library", icon: Image },
  { id: "audit", label: "Audit log", icon: History },
];

export const AdminShell: React.FC = () => {
  const { user, logout } = useAuth();
  const { go, adminTab } = useNav();

  const isAdmin = user && (user.role === 'super_admin' || user.role === 'polyclinic_admin' || user.role === 'CLINIC_ADMIN');

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
    subscriptions: <AdminSubscriptions />,
    site: <AdminCmsSite />,
    policies: <AdminPolicies />,
    media: <AdminMedia />,
    audit: <AdminAudit />,
  }[adminTab];

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
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = adminTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go("admin", { adminTab: item.id })}
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
              </button>
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
            onClick={() => logout().then(() => go("landing"))}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-slate-300 border border-slate-600 hover:bg-slate-700"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{panel}</main>
    </div>
  );
};
