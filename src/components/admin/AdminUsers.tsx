import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { AppUser, UserRole, UserStatus } from "../../types";
import { PRACTICE_SPECIALTIES } from "../../lib/specialtyWorkflow";

const ROLES: UserRole[] = ["super_admin", "polyclinic_admin", "CLINIC_ADMIN", "doctor", "receptionist", "patient"];
const STATUSES: UserStatus[] = ["active", "invited", "disabled"];
const PRACTICE_TYPES: Array<NonNullable<AppUser["practiceType"]>> = ["individual", "polyclinic"];

const emptyForm = {
  name: "",
  email: "",
  role: "doctor" as UserRole,
  phone: "",
  password: "",
  specialty: "",
  status: "active" as UserStatus,
  practiceType: "individual" as NonNullable<AppUser["practiceType"]>,
};

function practiceLabel(value?: string | null) {
  return value === "polyclinic" ? "Multi-specialty" : "Individual";
}

export const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<AppUser | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    apiFetch<{ users: AppUser[] }>(`/api/users?${params}`)
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load users"));
  };

  useEffect(() => {
    load();
  }, [q, role, status]);

  const openEdit = (u: AppUser) => {
    setError("");
    setNotice("");
    setEditing(u);
    setDraft({ ...u });
  };

  const closeEdit = () => {
    setEditing(null);
    setDraft(null);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const res = await apiFetch<{ user: AppUser; temporaryPassword?: string }>("/api/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(emptyForm);
      load();
      setNotice(
        res.temporaryPassword
          ? `Created ${res.user.email}. Temporary password: ${res.temporaryPassword}`
          : `Created ${res.user.email}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const { user } = await apiFetch<{ user: AppUser }>(`/api/users/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          role: draft.role,
          status: draft.status,
          specialty: draft.specialty || "",
          practiceType: draft.practiceType || "individual",
        }),
      });
      closeEdit();
      load();
      setNotice(`Saved ${user.email}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (id: string) => {
    const password = window.prompt("New password (min 8 characters)", "Lumera@2026");
    if (!password) return;
    setError("");
    try {
      await apiFetch(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) });
      setNotice("Password updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed");
    }
  };

  const setUserStatus = async (u: AppUser, next: UserStatus) => {
    setError("");
    try {
      await apiFetch(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    }
  };

  const removeUser = async (u: AppUser) => {
    if (!window.confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    setError("");
    try {
      await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
      load();
      setNotice(`Deleted ${u.email}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-extrabold">User management</h1>
        <p className="text-xs text-slate-500 mt-1">
          Create, edit, and disable platform logins. Name, email, role, specialty, and practice type persist via the API. New users default to Individual practice.
        </p>
      </div>
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
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-600" data-testid="admin-users-error">{error}</p>}
      {notice && <p className="text-xs text-emerald-700" data-testid="admin-users-notice">{notice}</p>}

      <form onSubmit={create} className="bg-white border rounded-xl p-4 grid sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs" data-testid="admin-create-user">
        <input required placeholder="Full name" className="border rounded px-2 py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input required type="email" placeholder="Email" className="border rounded px-2 py-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="border rounded px-2 py-1.5" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="border rounded px-2 py-1.5" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })}>
          <option value="">Specialty (clinicians)</option>
          {PRACTICE_SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="border rounded px-2 py-1.5"
          value={form.practiceType}
          onChange={(e) => setForm({ ...form, practiceType: e.target.value as NonNullable<AppUser["practiceType"]> })}
          data-testid="admin-create-practice-type"
        >
          {PRACTICE_TYPES.map((p) => <option key={p} value={p}>{practiceLabel(p)}</option>)}
        </select>
        <input placeholder="Phone" className="border rounded px-2 py-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input
          type="text"
          placeholder="Password (blank → temp)"
          className="border rounded px-2 py-1.5"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          autoComplete="new-password"
        />
        <button type="submit" disabled={saving} className="bg-purple-600 text-white rounded font-semibold disabled:opacity-60">
          {saving ? "Saving…" : "Create user"}
        </button>
      </form>
      <p className="text-[11px] text-slate-500 -mt-4">
        Leave password blank to generate a temporary password. The API returns it and it is shown above after create.
      </p>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Specialty</th>
              <th className="text-left px-3 py-2">Practice</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t" data-testid={`admin-user-row-${u.email}`}>
                <td className="px-3 py-2 font-semibold">{u.name}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.specialty || "—"}</td>
                <td className="px-3 py-2">{practiceLabel(u.practiceType)}</td>
                <td className="px-3 py-2">{u.status}</td>
                <td className="px-3 py-2 space-x-2 whitespace-nowrap">
                  <button type="button" className="text-blue-600 font-semibold" data-testid={`admin-user-edit-${u.email}`} onClick={() => openEdit(u)}>
                    Edit
                  </button>
                  <button type="button" className="text-slate-600" onClick={() => resetPassword(u.id)}>Reset password</button>
                  {u.status === "disabled" ? (
                    <button type="button" className="text-emerald-600" onClick={() => setUserStatus(u, "active")}>Enable</button>
                  ) : (
                    <button type="button" className="text-red-600" onClick={() => setUserStatus(u, "disabled")}>Disable</button>
                  )}
                  <button type="button" className="text-rose-700" onClick={() => removeUser(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && draft && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" data-testid="admin-user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="admin-user-edit-title">
          <form onSubmit={saveEdit} className="bg-white border border-slate-200 rounded-2xl p-5 w-full max-w-lg space-y-3 text-xs shadow-xl">
            <div>
              <h2 id="admin-user-edit-title" className="text-sm font-bold text-slate-900">Edit user</h2>
              <p className="text-slate-500 mt-0.5">Changes persist immediately on Save. Cancel discards the draft.</p>
            </div>
            <label className="block font-semibold">
              Name
              <input required className="mt-1 border rounded px-2 py-1.5 w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block font-semibold">
              Email
              <input required type="email" className="mt-1 border rounded px-2 py-1.5 w-full" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </label>
            <label className="block font-semibold">
              Phone
              <input className="mt-1 border rounded px-2 py-1.5 w-full" value={draft.phone || ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block font-semibold">
                Role
                <select className="mt-1 border rounded px-2 py-1.5 w-full" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block font-semibold">
                Status
                <select className="mt-1 border rounded px-2 py-1.5 w-full" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as UserStatus })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <label className="block font-semibold">
              Specialty / practice pack
              <select className="mt-1 border rounded px-2 py-1.5 w-full" value={draft.specialty || ""} onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}>
                <option value="">None</option>
                {PRACTICE_SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block font-semibold">
              Practice type
              <select
                className="mt-1 border rounded px-2 py-1.5 w-full"
                value={draft.practiceType || "individual"}
                onChange={(e) => setDraft({ ...draft, practiceType: e.target.value as NonNullable<AppUser["practiceType"]> })}
                data-testid="admin-edit-practice-type"
              >
                {PRACTICE_TYPES.map((p) => <option key={p} value={p}>{practiceLabel(p)}</option>)}
              </select>
            </label>
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="bg-purple-600 text-white px-3 py-1.5 rounded font-semibold disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={closeEdit} className="px-3 py-1.5 rounded border">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
