import React, { useEffect, useState } from "react";
import { IndianRupee, AlertTriangle, Wallet } from "lucide-react";
import { apiFetch } from "../../api/http";
import { useTenantScope } from "./TenantScopeContext";

type WalletState = "ok" | "low" | "empty" | "negative";

interface WalletStatus {
  tenantId: string;
  balance: number;
  lowBalanceThreshold: number;
  state: WalletState;
  topUpPrompt: boolean;
  message: string | null;
}

interface WalletTx {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
  createdBy: string | null;
}

interface UsageRow {
  tenantId: string;
  resource: string;
  quantity: number;
  rawCost: number;
  billedAmount: number;
  margin: number;
}

interface MarkupRow {
  id: string;
  scope: string;
  tenantId: string;
  resource: string;
  markupPercent: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const AdminUsageBilling: React.FC = () => {
  const { scope } = useTenantScope();
  const [tenantId, setTenantId] = useState(scope?.id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [markup, setMarkup] = useState<{
    ai_scribe_minutes: number;
    whatsapp_message: number;
    source: { ai_scribe_minutes: string; whatsapp_message: string };
  } | null>(null);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [margin, setMargin] = useState<{ rawCost: number; billedAmount: number; margin: number; note?: string } | null>(
    null
  );
  const [markupRows, setMarkupRows] = useState<MarkupRow[]>([]);
  const [defaultMarkup, setDefaultMarkup] = useState(20);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [globalWhatsapp, setGlobalWhatsapp] = useState("20");
  const [globalScribe, setGlobalScribe] = useState("20");

  const loadMargin = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    apiFetch<{ rawCost: number; billedAmount: number; margin: number; note?: string }>(
      `/api/admin/usage-billing/margin?${params}`
    )
      .then(setMargin)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load margin"));
  };

  const loadMarkup = () => {
    apiFetch<{ defaultMarkupPercent: number; rows: MarkupRow[] }>("/api/admin/usage-markup")
      .then((d) => {
        setDefaultMarkup(d.defaultMarkupPercent);
        setMarkupRows(d.rows || []);
        const gWa = d.rows.find((r) => r.scope === "global" && r.resource === "whatsapp_message");
        const gAi = d.rows.find((r) => r.scope === "global" && r.resource === "ai_scribe_minutes");
        if (gWa) setGlobalWhatsapp(String(gWa.markupPercent));
        if (gAi) setGlobalScribe(String(gAi.markupPercent));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load markup"));
  };

  const loadTenant = (id: string) => {
    if (!id) return;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    apiFetch<{
      wallet: WalletStatus;
      markup: {
        ai_scribe_minutes: number;
        whatsapp_message: number;
        source: { ai_scribe_minutes: string; whatsapp_message: string };
      };
      usage: UsageRow[];
      transactions: WalletTx[];
    }>(`/api/admin/usage-billing/tenants/${id}?${params}`)
      .then((d) => {
        setWallet(d.wallet);
        setMarkup(d.markup);
        setUsage(d.usage || []);
        setTransactions(d.transactions || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tenant wallet"));
  };

  useEffect(() => {
    loadMarkup();
    loadMargin();
  }, []);

  useEffect(() => {
    if (scope?.id && !tenantId) setTenantId(scope.id);
  }, [scope?.id]);

  const saveGlobal = async (resource: "whatsapp_message" | "ai_scribe_minutes", value: string) => {
    setError("");
    try {
      await apiFetch("/api/admin/usage-markup", {
        method: "PUT",
        body: JSON.stringify({ scope: "global", resource, markupPercent: Number(value) }),
      });
      setNotice(`Global ${resource} markup set to ${value}% (placeholder pricing until Super Admin locks a real rate).`);
      loadMarkup();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save markup");
    }
  };

  const adjust = async () => {
    setError("");
    if (!tenantId) return setError("Pick a tenant first");
    if (!adjustNote.trim()) return setError("Adjustments require a note");
    try {
      await apiFetch(`/api/admin/usage-billing/tenants/${tenantId}/adjust`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(adjustAmount), note: adjustNote.trim() }),
      });
      setNotice("Wallet adjustment recorded via ledger (not a direct balance UPDATE).");
      setAdjustAmount("");
      setAdjustNote("");
      loadTenant(tenantId);
      loadMargin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjustment failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-usage-billing">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Wallet className="w-5 h-5 text-purple-700" /> Usage wallet billing
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Platform-to-tenant usage (WhatsApp + AI Scribe). Separate from clinic-to-patient invoices and monthly SaaS
          subscriptions. Default markup is a <strong>20% placeholder</strong> — not a contractual rate. Lumera is not a
          certified Meta Tech Provider. Contact ravee@lumer.me.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600" data-testid="admin-usage-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-emerald-700" data-testid="admin-usage-notice">
          {notice}
        </p>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Platform margin</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-600">
            From
            <input
              type="datetime-local"
              className="mt-1 block border rounded px-2 py-1 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            To
            <input
              type="datetime-local"
              className="mt-1 block border rounded px-2 py-1 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold"
            onClick={() => {
              loadMargin();
              if (tenantId) loadTenant(tenantId);
            }}
          >
            Refresh
          </button>
        </div>
        {margin && (
          <div className="grid grid-cols-3 gap-3 text-center" data-testid="admin-usage-margin">
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-[10px] uppercase text-slate-500">Raw cost</div>
              <div className="text-lg font-bold">₹{margin.rawCost.toFixed(2)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-[10px] uppercase text-slate-500">Billed</div>
              <div className="text-lg font-bold">₹{margin.billedAmount.toFixed(2)}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <div className="text-[10px] uppercase text-emerald-700">Margin</div>
              <div className="text-lg font-bold text-emerald-800">₹{margin.margin.toFixed(2)}</div>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Global markup (Super Admin only)</h2>
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Placeholder fallback is {defaultMarkup}% when no row exists. Clinic endpoints never see markup_percent.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="text-xs">
            WhatsApp %
            <input
              className="ml-2 border rounded px-2 py-1 w-20"
              value={globalWhatsapp}
              onChange={(e) => setGlobalWhatsapp(e.target.value)}
            />
            <button
              type="button"
              className="ml-2 text-purple-700 font-semibold"
              onClick={() => saveGlobal("whatsapp_message", globalWhatsapp)}
            >
              Save
            </button>
          </label>
          <label className="text-xs">
            AI Scribe %
            <input
              className="ml-2 border rounded px-2 py-1 w-20"
              value={globalScribe}
              onChange={(e) => setGlobalScribe(e.target.value)}
            />
            <button
              type="button"
              className="ml-2 text-purple-700 font-semibold"
              onClick={() => saveGlobal("ai_scribe_minutes", globalScribe)}
            >
              Save
            </button>
          </label>
        </div>
        <ul className="text-xs text-slate-600 space-y-1">
          {markupRows.map((r) => (
            <li key={r.id}>
              {r.scope}/{r.tenantId || "global"} · {r.resource} · {r.markupPercent}%
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Per-tenant wallet</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="tenant id"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            data-testid="admin-usage-tenant-id"
          />
          <button
            type="button"
            className="px-3 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold"
            onClick={() => loadTenant(tenantId)}
          >
            Load
          </button>
        </div>
        {wallet && (
          <div className="text-sm space-y-1" data-testid="admin-usage-tenant-wallet">
            <p>
              Balance <strong>₹{wallet.balance.toFixed(2)}</strong> · state {wallet.state} · threshold ₹
              {wallet.lowBalanceThreshold}
            </p>
            {markup && (
              <p className="text-xs text-slate-500">
                Markup in effect: WhatsApp {markup.whatsapp_message}% ({markup.source.whatsapp_message}) · AI Scribe{" "}
                {markup.ai_scribe_minutes}% ({markup.source.ai_scribe_minutes})
              </p>
            )}
          </div>
        )}
        {usage.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th>Resource</th>
                <th>Qty</th>
                <th>Raw</th>
                <th>Billed</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={`${u.tenantId}-${u.resource}`}>
                  <td>{u.resource}</td>
                  <td>{u.quantity}</td>
                  <td>₹{u.rawCost.toFixed(4)}</td>
                  <td>₹{u.billedAmount.toFixed(4)}</td>
                  <td>₹{u.margin.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <IndianRupee className="w-4 h-4 text-slate-500" />
          <input
            className="border rounded px-2 py-1 text-sm w-28"
            placeholder="amount"
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            data-testid="admin-wallet-adjust-amount"
          />
          <input
            className="border rounded px-2 py-1 text-sm flex-1 min-w-[12rem]"
            placeholder="Required note"
            value={adjustNote}
            onChange={(e) => setAdjustNote(e.target.value)}
            data-testid="admin-wallet-adjust-note"
          />
          <button
            type="button"
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold"
            onClick={adjust}
            data-testid="admin-wallet-adjust"
          >
            Adjust
          </button>
        </div>
        <ul className="text-xs text-slate-600 max-h-48 overflow-y-auto divide-y">
          {transactions.map((t) => (
            <li key={t.id} className="py-1">
              {t.createdAt} · {t.type} · ₹{t.amount} → ₹{t.balanceAfter} · {t.note}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-slate-400 flex items-start gap-1">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Gemini AI Scribe raw_cost is null until a real per-minute figure exists — usage is recorded but not debited.
        invoices and tenant_subscriptions are untouched.
      </p>
    </div>
  );
};
