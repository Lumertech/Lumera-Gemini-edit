import React, { useEffect, useState } from "react";
import { Archive, Building2, Pencil, Power } from "lucide-react";
import { apiFetch } from "../../api/http";

export interface ClinicBranch {
  id: string;
  name: string;
  address: string;
  phone: string;
  opd_hours: string;
  active_doctors: number;
  status: string;
}

const STATUSES = ["Operating", "Paused", "Closed", "Disabled", "Archived"] as const;

const emptyForm = { name: "", address: "", phone: "", opdHours: "", status: "Operating" };

interface ClinicBranchesPanelProps {
  onUseBranch?: (branch: ClinicBranch) => void;
}

export const ClinicBranchesPanel: React.FC<ClinicBranchesPanelProps> = ({ onUseBranch }) => {
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<ClinicBranch | null>(null);
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () =>
    apiFetch<{ branches: ClinicBranch[] }>("/api/branches")
      .then((d) => setBranches(Array.isArray(d.branches) ? d.branches : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load branches"));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ branches: ClinicBranch[] }>("/api/branches")
      .then((d) => {
        if (!cancelled) setBranches(Array.isArray(d.branches) ? d.branches : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load branches");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/branches", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm);
      setNotice("Branch saved. It stays in this list after you reload.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError("");
    setNotice("");
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
      setNotice("Branch updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const archive = async (branch: ClinicBranch, status: "Archived" | "Disabled") => {
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/branches/${branch.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setPendingArchive(null);
      setNotice(status === "Disabled" ? `${branch.name} disabled.` : `${branch.name} archived.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update branch");
    }
  };

  return (
    <section className="space-y-4" data-testid="clinic-branches-panel">
      <div>
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-700" />
          Branches
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Locations for this clinic. Create, rename, or archive here — the list reloads from your clinic record.
        </p>
      </div>
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="clinic-branches-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" data-testid="clinic-branches-notice">
          {notice}
        </p>
      )}

      <form className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-2 text-xs" onSubmit={create} data-testid="clinic-branches-create">
        <input
          required
          name="name"
          placeholder="Branch name"
          aria-label="Branch name"
          data-testid="branch-name-input"
          className="border border-slate-200 rounded px-2 py-1.5"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          name="address"
          placeholder="Street, area, city"
          aria-label="Branch address"
          className="border border-slate-200 rounded px-2 py-1.5"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <input
          name="phone"
          placeholder="Phone"
          aria-label="Branch phone"
          className="border border-slate-200 rounded px-2 py-1.5"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <input
          name="opdHours"
          placeholder="OPD hours"
          aria-label="OPD hours"
          className="border border-slate-200 rounded px-2 py-1.5"
          value={form.opdHours}
          onChange={(e) => setForm({ ...form, opdHours: e.target.value })}
        />
        <label className="text-[11px] text-slate-500 sm:col-span-2">
          Status
          <select
            aria-label="New branch status"
            className="mt-1 border border-slate-200 rounded px-2 py-1.5 w-full text-slate-900"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            {STATUSES.filter((s) => s !== "Archived").map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" data-testid="branch-create-submit" className="bg-blue-600 text-white rounded font-semibold sm:col-span-2 py-2">
          Add branch
        </button>
      </form>

      {loading && <p className="text-xs text-slate-500">Loading branches…</p>}
      {!loading && branches.length === 0 && (
        <p className="text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-6 text-center" data-testid="clinic-branches-empty">
          No branches yet. Add the first location for this clinic.
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-3" data-testid="clinic-branches-list">
        {branches.map((b) => {
          const closed = b.status === "Archived" || b.status === "Disabled";
          return (
            <article key={b.id} className="bg-white border border-slate-200 rounded-xl p-4 text-xs space-y-1" data-testid={`branch-row-${b.id}`}>
              <div className="flex justify-between gap-2">
                <h3 className="font-bold text-sm text-slate-900" data-testid={`branch-name-${b.id}`}>
                  {b.name}
                </h3>
                <span className={closed ? "text-slate-500" : "text-emerald-700"} data-testid={`branch-status-${b.id}`}>
                  {b.status}
                </span>
              </div>
              {b.address ? <p className="text-slate-500">{b.address}</p> : null}
              {b.phone ? <p>{b.phone}</p> : null}
              {b.opd_hours ? <p>OPD: {b.opd_hours}</p> : null}
              <div className="flex flex-wrap gap-2 pt-2">
                {onUseBranch && !closed && (
                  <button
                    type="button"
                    data-testid={`branch-use-${b.id}`}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold"
                    onClick={() => onUseBranch(b)}
                  >
                    Use this branch
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`branch-edit-${b.id}`}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-semibold inline-flex items-center gap-1"
                  onClick={() => setEditing({ ...b })}
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                {!closed && pendingArchive !== b.id && (
                  <button
                    type="button"
                    data-testid={`branch-archive-${b.id}`}
                    className="px-2.5 py-1 rounded-lg text-amber-800 font-semibold inline-flex items-center gap-1"
                    onClick={() => setPendingArchive(b.id)}
                  >
                    <Archive className="w-3 h-3" /> Archive
                  </button>
                )}
                {pendingArchive === b.id && (
                  <>
                    <button
                      type="button"
                      data-testid={`branch-archive-confirm-${b.id}`}
                      className="px-2.5 py-1 rounded-lg bg-amber-700 text-white font-semibold"
                      onClick={() => archive(b, "Archived")}
                    >
                      Confirm archive
                    </button>
                    <button
                      type="button"
                      data-testid={`branch-disable-confirm-${b.id}`}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 font-semibold inline-flex items-center gap-1"
                      onClick={() => archive(b, "Disabled")}
                    >
                      <Power className="w-3 h-3" /> Disable
                    </button>
                    <button type="button" className="px-2.5 py-1 rounded-lg border border-slate-200" onClick={() => setPendingArchive(null)}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" data-testid="branch-edit-dialog">
          <form onSubmit={saveEdit} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-2 text-xs">
            <h2 className="font-bold text-sm">Edit branch</h2>
            <input
              required
              aria-label="Edit branch name"
              data-testid="branch-edit-name"
              className="border rounded px-2 py-1.5 w-full"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <input
              aria-label="Edit branch address"
              placeholder="Street, area, city"
              className="border rounded px-2 py-1.5 w-full"
              value={editing.address}
              onChange={(e) => setEditing({ ...editing, address: e.target.value })}
            />
            <input
              aria-label="Edit branch phone"
              placeholder="Phone"
              className="border rounded px-2 py-1.5 w-full"
              value={editing.phone}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
            />
            <input
              aria-label="Edit OPD hours"
              placeholder="OPD hours"
              className="border rounded px-2 py-1.5 w-full"
              value={editing.opd_hours}
              onChange={(e) => setEditing({ ...editing, opd_hours: e.target.value })}
            />
            <select
              aria-label="Edit branch status"
              data-testid="branch-edit-status"
              className="border rounded px-2 py-1.5 w-full"
              value={STATUSES.includes(editing.status as (typeof STATUSES)[number]) ? editing.status : "Operating"}
              onChange={(e) => setEditing({ ...editing, status: e.target.value })}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <div className="flex gap-2 pt-1">
              <button type="submit" data-testid="branch-edit-save" className="bg-blue-600 text-white px-3 py-1.5 rounded font-semibold">
                Save
              </button>
              <button type="button" className="px-3 py-1.5 rounded border" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};
