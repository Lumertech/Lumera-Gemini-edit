import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http";
import { AppUser } from "../../types";

interface TenantRow {
  tenantId: string;
  userCount: number;
  roles: string[];
  sampleEmails: string[];
}

export const AdminTenants: React.FC = () => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ users: AppUser[] }>("/api/users")
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tenants"));
  }, []);

  const rows = useMemo(() => {
    const map = new Map<string, TenantRow>();
    for (const u of users) {
      const tenantId = u.tenantId || "—";
      const current = map.get(tenantId) || { tenantId, userCount: 0, roles: [], sampleEmails: [] };
      current.userCount += 1;
      if (!current.roles.includes(u.role)) current.roles.push(u.role);
      if (current.sampleEmails.length < 3) current.sampleEmails.push(u.email);
      map.set(tenantId, current);
    }
    return [...map.values()].sort((a, b) => b.userCount - a.userCount);
  }, [users]);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-extrabold">Tenants</h1>
        <p className="text-xs text-slate-500 mt-1">
          Read-only roster grouped by `tenantId`. Create/Edit users write the actor tenant (super_admin may reassign). Specialty packs are assigned on User management.
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="bg-white border rounded-xl overflow-x-auto" data-testid="admin-tenants-table">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Tenant</th>
              <th className="text-left px-3 py-2">Users</th>
              <th className="text-left px-3 py-2">Roles</th>
              <th className="text-left px-3 py-2">Sample logins</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tenantId} className="border-t">
                <td className="px-3 py-2 font-semibold">{row.tenantId}</td>
                <td className="px-3 py-2">{row.userCount}</td>
                <td className="px-3 py-2">{row.roles.join(", ")}</td>
                <td className="px-3 py-2 text-slate-600">{row.sampleEmails.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
