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

const NAV: { id: AdminTab; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
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

  const panel = {
    overview: <AdminOverview />,
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
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-700 space-y-2">
          <button
            type="button"
            onClick={() => go("landing")}
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
