import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
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

const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/people", label: "Doctors & staff", icon: Stethoscope },
  { to: "/admin/branches", label: "Branches", icon: Building2 },
  { to: "/admin/site", label: "CMS site", icon: Globe },
  { to: "/admin/policies", label: "Pages & policies", icon: FileText },
  { to: "/admin/media", label: "Media", icon: Image },
  { to: "/admin/settings", label: "Clinic & AI", icon: Settings },
  { to: "/admin/audit", label: "Audit log", icon: History },
];

export const AdminShell: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                    isActive ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-2 border-t border-slate-800 space-y-1">
          <button
            onClick={() => navigate("/app")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
          >
            <Home className="w-3.5 h-3.5" /> Clinician suite
          </button>
          <button
            onClick={() => logout().then(() => navigate("/"))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
};
