import React, { useEffect, useMemo, useState } from "react";
import { KeyRound, Search, AlertTriangle, IndianRupee, Users } from "lucide-react";
import { apiFetch } from "../../api/http";

type SubStatus = "trial" | "active" | "suspended" | "cancelled" | "expired";

interface Subscription {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  status: SubStatus;
  planType: string;
  monthlyPrice: number;
  autoRenew: boolean;
  startedAt: string;
  endsAt: string | null;
  notes: string;
  daysRemaining: number | null;
}

interface Summary {
  totalUsers: number;
  counts: Record<string, number>;
  mrr: number;
}

const STATUS_STYLES: Record<string, string> = {
  trial: "bg-sky-100 text-sky-800 border-sky-300",
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  suspended: "bg-amber-100 text-amber-800 border-amber-300",
  cancelled: "bg-slate-100 text-slate-700 border-slate-300",
  expired: "bg-rose-100 text-rose-800 border-rose-300",
};

export const AdminSubscriptions: React.FC = () => {
  const [rows, setRows] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [nearExpiry, setNearExpiry] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [form, setForm] = useState({
    status: "trial",
    planType: "trial",
    monthlyPrice: "0",
    autoRenew: true,
    extendDays: "0",
    notes: "",
  });

  const load = () => {
    apiFetch<{ subscriptions: Subscription[] }>("/api/admin/subscriptions").then((d) => setRows(d.subscriptions));
    apiFetch<Summary>("/api/admin/subscriptions/summary").then(setSummary).catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    if (nearExpiry) list = list.filter((r) => r.daysRemaining !== null && r.daysRemaining <= 14);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.phone.includes(q)
      );
    }
    return list;
  }, [rows, filter, search, nearExpiry]);

  const openEdit = (row: Subscription) => {
    setEditing(row);
    setForm({
      status: row.status,
      planType: row.planType,
      monthlyPrice: String(row.monthlyPrice),
      autoRenew: row.autoRenew,
      extendDays: "0",
      notes: row.notes,
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await apiFetch(`/api/admin/subscriptions/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: form.status,
        planType: form.planType,
        monthlyPrice: Number(form.monthlyPrice),
        autoRenew: form.autoRenew,
        extendDays: Number(form.extendDays),
        notes: form.notes,
      }),
    });
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-manrope text-2xl font-bold text-slate-900 flex items-center gap-2">
          <KeyRound className="h-7 w-7 text-purple-600" /> Subscription management
        </h1>
        <p className="text-sm text-slate-500 mt-1">Trials, monthly plans, expiries, and pricing per account.</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <Users className="h-3 w-3" /> Accounts
            </p>
            <p className="font-manrope font-bold text-2xl">{summary.totalUsers}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Active</p>
            <p className="font-manrope font-bold text-2xl text-emerald-700">{summary.counts.active || 0}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Trial</p>
            <p className="font-manrope font-bold text-2xl text-sky-700">{summary.counts.trial || 0}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <IndianRupee className="h-3 w-3" /> Monthly recurring
            </p>
            <p className="font-manrope font-bold text-2xl text-indigo-700">₹{Number(summary.mrr || 0).toLocaleString("en-IN")}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {["all", "trial", "active", "suspended", "expired", "cancelled"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === s ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        <label className="flex items-center gap-2 text-xs text-slate-700 ml-2">
          <input type="checkbox" checked={nearExpiry} onChange={(e) => setNearExpiry(e.target.checked)} />
          <AlertTriangle className="h-3 w-3 text-amber-500" /> Near expiry (≤14 days)
        </label>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / email / phone"
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b">
              <th className="py-2 px-3">User</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Plan</th>
              <th className="py-2 px-3">Price</th>
              <th className="py-2 px-3">Expiry</th>
              <th className="py-2 px-3">Auto-renew</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.email}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 capitalize">{r.planType}</td>
                <td className="px-3 py-2">₹{r.monthlyPrice.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-xs">
                  {r.endsAt ? new Date(r.endsAt).toLocaleDateString("en-IN") : "—"}
                  {r.daysRemaining !== null && <div className="text-slate-500">{r.daysRemaining}d left</div>}
                </td>
                <td className="px-3 py-2 text-xs">{r.autoRenew ? "On" : "Off"}</td>
                <td className="px-3 py-2">
                  <button type="button" className="text-purple-600 font-semibold text-xs" onClick={() => openEdit(r)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3 text-sm max-w-2xl">
          <h2 className="sm:col-span-2 font-manrope font-bold">Edit {editing.name}</h2>
          <label className="text-xs font-semibold">
            Status
            <select
              className="mt-1 w-full border rounded-lg px-2 py-1.5"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {["trial", "active", "suspended", "cancelled", "expired"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Plan
            <select
              className="mt-1 w-full border rounded-lg px-2 py-1.5"
              value={form.planType}
              onChange={(e) => setForm({ ...form, planType: e.target.value })}
            >
              {["trial", "starter", "professional", "clinic", "internal"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Monthly price (₹)
            <input
              className="mt-1 w-full border rounded-lg px-2 py-1.5"
              type="number"
              value={form.monthlyPrice}
              onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
            />
          </label>
          <label className="text-xs font-semibold">
            Extend days
            <input
              className="mt-1 w-full border rounded-lg px-2 py-1.5"
              type="number"
              value={form.extendDays}
              onChange={(e) => setForm({ ...form, extendDays: e.target.value })}
            />
          </label>
          <label className="text-xs font-semibold sm:col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={form.autoRenew} onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })} />
            Auto-renew
          </label>
          <label className="text-xs font-semibold sm:col-span-2">
            Notes
            <textarea
              className="mt-1 w-full border rounded-lg px-2 py-1.5"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2 flex gap-2">
            <button className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-semibold">
              Save license
            </button>
            <button type="button" className="px-4 py-2 text-xs" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
