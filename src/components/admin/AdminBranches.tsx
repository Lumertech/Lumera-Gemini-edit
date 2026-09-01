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

export const AdminBranches: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState({ name: "", address: "", phone: "", opdHours: "09:00 AM - 08:00 PM", activeDoctors: 1, status: "Operating" });

  const load = () => apiFetch<{ branches: Branch[] }>("/api/branches").then((d) => setBranches(d.branches));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-xl font-extrabold">Clinic branches</h1>
      <form
        className="bg-white border rounded-xl p-4 grid sm:grid-cols-2 gap-2 text-xs"
        onSubmit={async (e) => {
          e.preventDefault();
          await apiFetch("/api/branches", { method: "POST", body: JSON.stringify(form) });
          setForm({ ...form, name: "", address: "", phone: "" });
          load();
        }}
      >
        <input required placeholder="Branch name" className="border rounded px-2 py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Address" className="border rounded px-2 py-1.5" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input placeholder="Phone" className="border rounded px-2 py-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="OPD hours" className="border rounded px-2 py-1.5" value={form.opdHours} onChange={(e) => setForm({ ...form, opdHours: e.target.value })} />
        <button className="bg-blue-600 text-white rounded font-semibold sm:col-span-2 py-2">Add branch</button>
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
            <button
              className="text-red-600"
              onClick={async () => {
                await apiFetch(`/api/branches/${b.id}`, { method: "DELETE" });
                load();
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
