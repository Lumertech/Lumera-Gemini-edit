import React from "react";
import {
  LayoutDashboard,
  Users,
  Stethoscope,
  Building2,
  Globe,
  FileText,
  Image,
  Settings,
  History,
  LogOut,
  Home,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { AdminTab, useNav } from "../../nav/NavigationContext";
import { AdminOverview } from "./AdminOverview";
import { AdminUsers } from "./AdminUsers";
import { AdminPeople } from "./AdminPeople";
import { AdminBranches } from "./AdminBranches";
import { AdminCmsSite } from "./AdminCmsSite";
import { AdminPolicies } from "./AdminPolicies";
import { AdminMedia } from "./AdminMedia";
import { AdminSettings } from "./AdminSettings";
import { AdminAudit } from "./AdminAudit";

const NAV: { id: AdminTab; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "people", label: "Doctors & staff", icon: Stethoscope },
  { id: "branches", label: "Branches", icon: Building2 },
  { id: "site", label: "CMS site", icon: Globe },
  { id: "policies", label: "Pages & policies", icon: FileText },
  { id: "media", label: "Media", icon: Image },
  { id: "settings", label: "Clinic & AI", icon: Settings },
  { id: "audit", label: "Audit log", icon: History },
];

export const AdminShell: React.FC = () => {
  const { user, logout } = useAuth();
  const { go, adminTab } = useNav();

  const panel = {
    overview: <AdminOverview />,
    users: <AdminUsers />,
    people: <AdminPeople />,
    branches: <AdminBranches />,
    site: <AdminCmsSite />,
    policies: <AdminPolicies />,
    media: <AdminMedia />,
    settings: <AdminSettings />,
    audit: <AdminAudit />,
  }[adminTab];

  return (
    <div className="h-screen flex bg-slate-100 text-slate-900">
      <aside className="w-60 bg-slate-900 text-slate-200 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-sm font-extrabold text-white">Lumera Admin CMS</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{user?.name}</div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = adminTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go("admin", { adminTab: item.id })}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-left ${
                  isActive ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-2 border-t border-slate-800 space-y-1">
          <button
            type="button"
            onClick={() => go("app")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
          >
            <Home className="w-3.5 h-3.5" /> Clinician suite
          </button>
          <button
            type="button"
            onClick={() => logout().then(() => go("landing"))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{panel}</main>
    </div>
  );
};
