import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { apiFetch } from "../../api/http";

type CapsResponse = {
  windowDays?: number;
  newClientOnboardings?: number;
  cap?: number;
  remaining?: number;
  overCap?: boolean;
  businessVerifiedFlag?: boolean;
  notice?: string;
  tokenExpiryWarnings?: Array<{
    id: string;
    ownerType: string;
    ownerId: string;
    wabaId: string;
    phoneNumberId: string;
    metaWabaName: string;
    metaTokenExpiresAt: string;
    expired?: boolean;
    expiringSoon?: boolean;
  }>;
};

export const AdminWabaOnboardingCaps: React.FC = () => {
  const [caps, setCaps] = useState<CapsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiFetch<CapsResponse>("/api/admin/whatsapp-onboarding-caps")
      .then(setCaps)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load onboarding caps.");
      });
  }, []);

  const used = caps?.newClientOnboardings ?? 0;
  const cap = caps?.cap ?? 10;
  const warnings = caps?.tokenExpiryWarnings || [];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 shadow-sm" data-testid="admin-waba-onboarding-caps">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Embedded Signup onboarding cap (rolling 7 days)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Meta allows 10 new client WABAs / 7 days before full verification, 200 after. Lumera is not a certified Tech
            Provider — this count is local.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 border border-amber-400/40 shrink-0">
          SANDBOX
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${caps?.overCap ? "text-rose-600" : "text-slate-900"}`}>
          {used}
        </span>
        <span className="text-sm text-slate-500">/ {cap} new Embedded Signup clients</span>
        <span className="text-xs text-slate-400">({caps?.remaining ?? Math.max(0, cap - used)} remaining)</span>
      </div>
      <p className="text-[11px] text-slate-500">
        {caps?.notice ||
          "Cap is 10 unless META_WHATSAPP_ONBOARDING_VERIFIED=true. Contact ravee@lumer.me."}
      </p>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}

      <div className="pt-2 border-t border-slate-100">
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Per-number token expiry</h3>
        {warnings.length === 0 ? (
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            No connected numbers with a parseable expiry in the next 14 days. SANDBOX placeholders are ignored.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {warnings.map((row) => (
              <li key={row.id} className="text-[11px] text-amber-800 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {row.expired ? "Expired" : "Expiring soon"}: {row.metaWabaName || row.wabaId || row.id} (
                  {row.ownerType}/{row.ownerId}) — {row.metaTokenExpiresAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
