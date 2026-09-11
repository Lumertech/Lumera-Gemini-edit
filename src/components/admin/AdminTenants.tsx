import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useTenantScope } from "./TenantScopeContext";
import { TenantSubscriptionPanel } from "./TenantSubscriptionPanel";
import {
  AdminPlanCatalogRow,
  AdminTenant,
  AdminTenantStatus,
  AdminTenantType,
  TENANT_STATUSES,
  TENANT_STATUS_STYLES,
  TENANT_TYPES,
  badgeClass,
  formatAdminDate,
  honestyCaption,
  normalizeHonestyLabel,
  planBadgeLabel,
  typeLabel,
} from "../../lib/adminTenants";

const emptyCreate = {
  name: "",
  type: "individual" as AdminTenantType,
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  planCode: "trial",
};

export const AdminTenants: React.FC = () => {
  const { scope, setScope, clearScope } = useTenantScope();
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [plans, setPlans] = useState<AdminPlanCatalogRow[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyCreate);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<AdminTenant | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadPlans = () => {
    apiFetch<{ plans: AdminPlanCatalogRow[] }>("/api/admin/plans")
      .then((d) => {
        setPlans(d.plans || []);
        if (d.plans?.[0]?.code && form.planCode === "trial") {
          /* keep trial default when present in catalog */
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load plan catalog"));
  };

  const loadList = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (includeDeleted) params.set("includeDeleted", "1");
    setLoading(true);
    apiFetch<{ tenants: AdminTenant[] }>(`/api/admin/tenants?${params}`)
      .then((d) => setTenants(d.tenants || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tenants"))
      .finally(() => setLoading(false));
  };

  const loadDetail = (id: string) => {
    setDetailLoading(true);
    setError("");
    apiFetch<{ tenant: AdminTenant }>(`/api/admin/tenants/${id}`)
      .then((d) => {
        setDetail(d.tenant);
        setScope({ id: d.tenant.id, name: d.tenant.name });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tenant"))
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    loadPlans();
  }, []);

  useEffect(() => {
    loadList();
  }, [q, type, status, includeDeleted]);

  useEffect(() => {
    if (scope?.id) loadDetail(scope.id);
    else setDetail(null);
  }, [scope?.id]);

  const openCreate = () => {
    setError("");
    setNotice("");
    setForm({
      ...emptyCreate,
      planCode: plans.find((p) => p.code === "trial")?.code || plans[0]?.code || "trial",
    });
    setShowCreate(true);
  };

  const createTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setCreating(true);
    try {
      const { tenant } = await apiFetch<{ tenant: AdminTenant }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          owner: { name: form.ownerName, email: form.ownerEmail, phone: form.ownerPhone },
          planCode: form.planCode,
        }),
      });
      setShowCreate(false);
      setForm(emptyCreate);
      loadList();
      setScope({ id: tenant.id, name: tenant.name });
      setNotice(`Created ${tenant.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const patchStatus = async (next: AdminTenantStatus) => {
    if (!detail) return;
    const label =
      next === "suspended" ? "Suspend" : next === "deleted" ? "Soft-delete" : next === "active" ? "Reinstate" : "Update";
    if (!window.confirm(`${label} ${detail.name}? Clinic users on this tenant will follow the new status after reload.`)) {
      return;
    }
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const { tenant } = await apiFetch<{ tenant: AdminTenant }>(`/api/admin/tenants/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setDetail(tenant);
      setScope({ id: tenant.id, name: tenant.name });
      loadList();
      setNotice(`${label}d ${tenant.name} · status ${tenant.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setSaving(false);
    }
  };

  const exitDetail = () => {
    clearScope();
    setDetail(null);
    loadList();
  };

  if (scope?.id) {
    return (
      <div className="space-y-6 max-w-5xl" data-testid="admin-tenant-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button type="button" className="text-xs text-purple-700 font-semibold" onClick={exitDetail} data-testid="tenant-exit-platform">
              ← Exit to platform list
            </button>
            <h1 className="text-xl font-extrabold mt-1">{detail?.name || "Tenant"}</h1>
            <p className="text-xs text-slate-500 mt-1 font-mono" data-testid="tenant-detail-id">
              {scope.id}
            </p>
          </div>
          {detail && (
            <div className="flex flex-wrap gap-2 text-xs">
              {detail.status === "suspended" || detail.status === "deleted" ? (
                <button
                  type="button"
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-60"
                  onClick={() => patchStatus("active")}
                  data-testid="tenant-reinstate"
                >
                  Reinstate
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold disabled:opacity-60"
                  onClick={() => patchStatus("suspended")}
                  data-testid="tenant-suspend"
                >
                  Suspend
                </button>
              )}
              {detail.status !== "deleted" && (
                <button
                  type="button"
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 font-semibold disabled:opacity-60"
                  onClick={() => patchStatus("deleted")}
                  data-testid="tenant-soft-delete"
                >
                  Soft-delete
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-600" data-testid="admin-tenants-error">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-xs text-emerald-700" data-testid="admin-tenants-notice">
            {notice}
          </p>
        )}
        {detailLoading && <p className="text-xs text-slate-500">Loading tenant…</p>}

        {detail && (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="bg-white border rounded-xl p-4">
                <div className="text-[11px] uppercase text-slate-500 font-bold">Type</div>
                <div className="font-semibold mt-1">{typeLabel(detail.type)}</div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-[11px] uppercase text-slate-500 font-bold">Status</div>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full border font-semibold uppercase ${badgeClass(TENANT_STATUS_STYLES, detail.status)}`}>
                  {detail.status}
                </span>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-[11px] uppercase text-slate-500 font-bold">Users</div>
                <div className="font-extrabold text-lg mt-1" data-testid="tenant-users-count">
                  {detail.usersCount ?? 0}
                </div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-[11px] uppercase text-slate-500 font-bold">Plan</div>
                <div className="font-semibold mt-1">{planBadgeLabel(detail.plan)}</div>
                <p className="text-[11px] text-amber-800 mt-1">{honestyCaption(detail.plan.billingSource)}</p>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4 text-xs space-y-1">
              <div className="text-[11px] uppercase text-slate-500 font-bold">Owner</div>
              <div className="font-semibold">{detail.owner.name || "—"}</div>
              <div className="text-slate-600">{detail.owner.email || "—"}</div>
              <div className="text-slate-600">{detail.owner.phone || "—"}</div>
              <div className="text-slate-500">Created {formatAdminDate(detail.createdAt)}</div>
            </div>

            <TenantSubscriptionPanel
              tenantId={detail.id}
              initial={detail.subscription || null}
              plans={plans}
              onSaved={(subscription) => {
                setDetail({
                  ...detail,
                  subscription,
                  plan: {
                    ...detail.plan,
                    code: subscription.planCode,
                    displayName: subscription.planDisplayName,
                    badge: subscription.planBadge,
                    status: subscription.status,
                    billingSource: subscription.billingSource,
                  },
                });
                loadList();
              }}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Tenants</h1>
          <p className="text-xs text-slate-500 mt-1">
            Platform Superadmin roster. Plan badges come from the tenant subscription catalog — status is{" "}
            <span className="font-semibold">{normalizeHonestyLabel("manual")}</span> unless labeled sandbox/demo. Not a
            captured Razorpay payment.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
          data-testid="admin-tenants-create"
        >
          Create tenant
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="border rounded-lg px-3 py-1.5 text-xs"
          placeholder="Search name, owner, email, id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="admin-tenants-search"
        />
        <select className="border rounded-lg px-2 py-1.5 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {TENANT_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
        <select className="border rounded-lg px-2 py-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {TENANT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
          Include deleted
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-600" data-testid="admin-tenants-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-emerald-700" data-testid="admin-tenants-notice">
          {notice}
        </p>
      )}
      {loading && <p className="text-xs text-slate-500">Loading tenants…</p>}

      {!loading && tenants.length === 0 ? (
        <div className="bg-white border border-dashed rounded-xl p-8 text-center space-y-3" data-testid="admin-tenants-empty">
          <p className="text-sm font-semibold text-slate-800">No tenants match this filter</p>
          <p className="text-xs text-slate-500">Create a clinic tenant to assign a catalog plan (manual / no PSP).</p>
          <button
            type="button"
            onClick={openCreate}
            className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
          >
            Create tenant
          </button>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-x-auto" data-testid="admin-tenants-table">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Plan</th>
                <th className="text-left px-3 py-2">Owner</th>
                <th className="text-left px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr
                  key={t.id}
                  className="border-t hover:bg-slate-50 cursor-pointer"
                  data-testid={`admin-tenant-row-${t.id}`}
                  onClick={() => setScope({ id: t.id, name: t.name })}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{t.id}</div>
                  </td>
                  <td className="px-3 py-2">{typeLabel(t.type)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full border font-semibold uppercase ${badgeClass(TENANT_STATUS_STYLES, t.status)}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-800 border-indigo-200 font-semibold">
                      {planBadgeLabel(t.plan)}
                    </span>
                    <div className="text-[10px] text-amber-800 mt-0.5 uppercase">{normalizeHonestyLabel(t.plan.billingSource)}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    <div>{t.owner.name || "—"}</div>
                    <div>{t.owner.email || "—"}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatAdminDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          data-testid="admin-tenant-create-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-tenant-create-title"
        >
          <form onSubmit={createTenant} className="bg-white border border-slate-200 rounded-2xl p-5 w-full max-w-lg space-y-3 text-xs shadow-xl">
            <div>
              <h2 id="admin-tenant-create-title" className="text-sm font-bold text-slate-900">
                Create tenant
              </h2>
              <p className="text-slate-500 mt-0.5">
                Persists via POST /api/admin/tenants. Plan codes come from GET /api/admin/plans only. Default type is
                Individual (#52). Plan assign is manual — not a captured payment.
              </p>
            </div>
            <label className="block font-semibold">
              Clinic name
              <input
                required
                className="mt-1 border rounded px-2 py-1.5 w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="tenant-create-name"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block font-semibold">
                Type
                <select
                  className="mt-1 border rounded px-2 py-1.5 w-full"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as AdminTenantType })}
                  data-testid="tenant-create-type"
                >
                  {TENANT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block font-semibold">
                Plan
                <select
                  className="mt-1 border rounded px-2 py-1.5 w-full"
                  value={form.planCode}
                  onChange={(e) => setForm({ ...form, planCode: e.target.value })}
                  data-testid="tenant-create-plan"
                >
                  {plans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.displayName} · {p.priceCopy}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block font-semibold">
              Owner name
              <input
                className="mt-1 border rounded px-2 py-1.5 w-full"
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              />
            </label>
            <label className="block font-semibold">
              Owner email
              <input
                type="email"
                className="mt-1 border rounded px-2 py-1.5 w-full"
                value={form.ownerEmail}
                onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                data-testid="tenant-create-owner-email"
              />
            </label>
            <label className="block font-semibold">
              Owner phone
              <input
                className="mt-1 border rounded px-2 py-1.5 w-full"
                value={form.ownerPhone}
                onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
              />
            </label>
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={creating} className="bg-purple-600 text-white px-3 py-1.5 rounded font-semibold disabled:opacity-60">
                {creating ? "Saving…" : "Create"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded border">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
