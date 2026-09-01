import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { AppUser, UserRole, UserStatus } from "../../types";

const ROLES: UserRole[] = ["super_admin", "polyclinic_admin", "doctor", "receptionist", "patient"];

export const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "doctor" as UserRole,
    phone: "",
    password: "",
  });
  const [editing, setEditing] = useState<AppUser | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    apiFetch<{ users: AppUser[] }>(`/api/users?${params}`)
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [q, role, status]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", role: "doctor", phone: "", password: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await apiFetch(`/api/users/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  };

  const resetPassword = async (id: string) => {
    const password = window.prompt("New password (min 8 characters)", "Lumera@2026");
    if (!password) return;
    await apiFetch(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) });
    alert("Password updated");
  };

  const setUserStatus = async (u: AppUser, next: UserStatus) => {
    await apiFetch(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    load();
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-xl font-extrabold">User management</h1>
      <div className="flex flex-wrap gap-2">
        <input className="border rounded-lg px-3 py-1.5 text-xs" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="border rounded-lg px-2 py-1.5 text-xs" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select className="border rounded-lg px-2 py-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">active</option>
          <option value="invited">invited</option>
          <option value="disabled">disabled</option>
        </select>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <form onSubmit={create} className="bg-white border rounded-xl p-4 grid sm:grid-cols-5 gap-2 text-xs">
        <input required placeholder="Full name" className="border rounded px-2 py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input required type="email" placeholder="Email" className="border rounded px-2 py-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="border rounded px-2 py-1.5" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input placeholder="Phone" className="border rounded px-2 py-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button className="bg-blue-600 text-white rounded font-semibold">Create user</button>
      </form>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2 font-semibold">{u.name}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.status}</td>
                <td className="px-3 py-2 space-x-2">
                  <button className="text-blue-600" onClick={() => setEditing(u)}>Edit</button>
                  <button className="text-slate-600" onClick={() => resetPassword(u.id)}>Reset password</button>
                  {u.status === "disabled" ? (
                    <button className="text-emerald-600" onClick={() => setUserStatus(u, "active")}>Enable</button>
                  ) : (
                    <button className="text-red-600" onClick={() => setUserStatus(u, "disabled")}>Disable</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <form onSubmit={saveEdit} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2 text-xs">
          <div className="font-bold">Edit {editing.email}</div>
          <input className="border rounded px-2 py-1.5 w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input className="border rounded px-2 py-1.5 w-full" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as UserRole })}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="flex gap-2">
            <button className="bg-blue-600 text-white px-3 py-1.5 rounded">Save</button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
};
