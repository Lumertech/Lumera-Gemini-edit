import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import {
  AdminPlanCatalogRow,
  AdminSubscriptionStatus,
  AdminTenantSubscription,
  SUBSCRIPTION_STATUSES,
  SUB_STATUS_STYLES,
  badgeClass,
  honestyCaption,
  normalizeHonestyLabel,
} from "../../lib/adminTenants";

interface Props {
  tenantId: string;
  initial?: AdminTenantSubscription | null;
  plans: AdminPlanCatalogRow[];
  onSaved?: (subscription: AdminTenantSubscription) => void;
}

export const TenantSubscriptionPanel: React.FC<Props> = ({ tenantId, initial, plans, onSaved }) => {
  const [sub, setSub] = useState<AdminTenantSubscription | null>(initial || null);
  const [planCode, setPlanCode] = useState(initial?.planCode || plans[0]?.code || "trial");
  const [status, setStatus] = useState<string>(initial?.status || "trial");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = (next: AdminTenantSubscription) => {
    setSub(next);
    setPlanCode(next.planCode);
    setStatus(next.status);
    setNotes(next.notes || "");
  };

  useEffect(() => {
    if (initial) {
      apply(initial);
      return;
    }
    let cancelled = false;
    apiFetch<{ subscription: AdminTenantSubscription }>(`/api/admin/tenants/${tenantId}/subscription`)
      .then((d) => {
        if (!cancelled) apply(d.subscription);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load subscription");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, initial]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const { subscription } = await apiFetch<{ subscription: AdminTenantSubscription }>(
        `/api/admin/tenants/${tenantId}/subscription`,
        {
          method: "PATCH",
          body: JSON.stringify({
            planCode,
            status,
            notes,
            billingSource: "manual",
          }),
        }
      );
      apply(subscription);
      onSaved?.(subscription);
      setNotice(`Saved ${subscription.planBadge} · ${subscription.status} (manual)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update subscription");
    } finally {
      setSaving(false);
    }
  };

  const honesty = normalizeHonestyLabel(sub?.honestyLabel || sub?.billingSource);
  const catalogPlans = plans.length ? plans : [{ code: planCode, displayName: planCode, priceCopy: "", monthlyPrice: 0 }];

  return (
    <form onSubmit={save} className="bg-white border rounded-xl p-4 space-y-3" data-testid="tenant-subscription-panel">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Tenant subscription</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Source of truth is per tenant. Assign from the catalog only — not free-text.
        </p>
        <p className="text-[11px] text-amber-800 mt-1 font-medium" data-testid="subscription-honesty-label">
          {honestyCaption(honesty)}
        </p>
      </div>

      {sub && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-800 border-indigo-200 font-semibold">
            {sub.planBadge || sub.planDisplayName}
          </span>
          <span className={`px-2 py-0.5 rounded-full border font-semibold uppercase ${badgeClass(SUB_STATUS_STYLES, sub.status)}`}>
            {sub.status}
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200 font-semibold uppercase">
            {honesty}
          </span>
          <span className="text-slate-500 self-center">{sub.priceCopy}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2 text-xs">
        <label className="font-semibold">
          Plan
          <select
            className="mt-1 w-full border rounded-lg px-2 py-1.5 font-normal"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            data-testid="tenant-sub-plan"
          >
            {catalogPlans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.displayName} · {p.priceCopy}
              </option>
            ))}
          </select>
        </label>
        <label className="font-semibold">
          Status
          <select
            className="mt-1 w-full border rounded-lg px-2 py-1.5 font-normal"
            value={status}
            onChange={(e) => setStatus(e.target.value as AdminSubscriptionStatus)}
            data-testid="tenant-sub-status"
          >
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="font-semibold sm:col-span-2">
          Notes
          <textarea
            className="mt-1 w-full border rounded-lg px-2 py-1.5 font-normal"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-600" data-testid="tenant-sub-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-emerald-700" data-testid="tenant-sub-notice">
          {notice}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save subscription"}
        </button>
      </div>
    </form>
  );
};
