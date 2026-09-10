import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";

interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  opd_hours: string;
  active_doctors: number;
  status: string;
}

const emptyForm = { name: "", address: "", phone: "", opdHours: "09:00 AM - 08:00 PM", activeDoctors: 1, status: "Operating" };

export const AdminBranches: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () =>
    apiFetch<{ branches: Branch[] }>("/api/branches")
      .then((d) => setBranches(d.branches))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load branches"));

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/branches", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm);
      setNotice("Branch created");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError("");
    try {
      await apiFetch(`/api/branches/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editing.name,
          address: editing.address,
          phone: editing.phone,
          opdHours: editing.opd_hours,
          activeDoctors: editing.active_doctors,
          status: editing.status,
        }),
      });
      setEditing(null);
      setNotice("Branch saved");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-xl font-extrabold">Clinic branches</h1>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs text-emerald-700">{notice}</p>}
      <form className="bg-white border rounded-xl p-4 grid sm:grid-cols-2 gap-2 text-xs" onSubmit={create}>
        <input required placeholder="Branch name" className="border rounded px-2 py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Address" className="border rounded px-2 py-1.5" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input placeholder="Phone" className="border rounded px-2 py-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="OPD hours" className="border rounded px-2 py-1.5" value={form.opdHours} onChange={(e) => setForm({ ...form, opdHours: e.target.value })} />
        <button type="submit" className="bg-blue-600 text-white rounded font-semibold sm:col-span-2 py-2">Add branch</button>
      </form>
      <div className="grid md:grid-cols-2 gap-3">
        {branches.map((b) => (
          <div key={b.id} className="bg-white border rounded-xl p-4 text-xs space-y-1">
            <div className="flex justify-between">
              <h3 className="font-bold text-sm">{b.name}</h3>
              <span className="text-emerald-700">{b.status}</span>
            </div>
            <p className="text-slate-500">{b.address}</p>
            <p>{b.phone}</p>
            <p>OPD: {b.opd_hours}</p>
            <p>Active doctors: {b.active_doctors}</p>
            <div className="flex gap-3 pt-1">
              <button type="button" className="text-blue-600 font-semibold" onClick={() => setEditing({ ...b })}>Edit</button>
              <button
                type="button"
                className="text-red-600"
                onClick={async () => {
                  setError("");
                  try {
                    await apiFetch(`/api/branches/${b.id}`, { method: "DELETE" });
                    setNotice("Branch deleted");
                    load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Delete failed");
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form onSubmit={saveEdit} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-2 text-xs">
            <h2 className="font-bold text-sm">Edit branch</h2>
            <input required className="border rounded px-2 py-1.5 w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="border rounded px-2 py-1.5 w-full" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            <input className="border rounded px-2 py-1.5 w-full" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            <input className="border rounded px-2 py-1.5 w-full" value={editing.opd_hours} onChange={(e) => setEditing({ ...editing, opd_hours: e.target.value })} />
            <select className="border rounded px-2 py-1.5 w-full" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
              <option>Operating</option>
              <option>Paused</option>
              <option>Closed</option>
            </select>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="bg-purple-600 text-white px-3 py-1.5 rounded font-semibold">Save</button>
              <button type="button" className="px-3 py-1.5 rounded border" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
