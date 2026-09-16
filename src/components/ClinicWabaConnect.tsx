import React, { useEffect, useState } from "react";
import { Building2, CheckCircle2, ArrowRight } from "lucide-react";
import { apiFetch } from "../api/http";
import {
  launchEmbeddedSignupV4,
  loadFacebookSdk,
  type EmbeddedSignupConfig,
} from "../lib/facebook-embedded-signup";

type MineResponse = {
  tenantNumber?: { id: string; status: string; wabaId?: string; phoneNumberId?: string; metaWabaName?: string } | null;
  sandbox?: boolean;
  simulatorsEnabled?: boolean;
  notice?: string;
};

export const ClinicWabaConnect: React.FC = () => {
  const [mine, setMine] = useState<MineResponse | null>(null);
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const [data, signup] = await Promise.all([
        apiFetch<MineResponse>("/api/whatsapp-numbers/mine"),
        apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"),
      ]);
      setMine(data);
      setConfig(signup);
      if (signup.appId && signup.graphVersion) {
        void loadFacebookSdk(signup.appId, signup.graphVersion).catch(() => undefined);
      }
    } catch {
      setMine(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connected = mine?.tenantNumber?.status === "connected";
  const simulatorsEnabled = Boolean(config?.simulatorsEnabled ?? mine?.sandbox);

  const handleRealConnect = async () => {
    setBusy(true);
    setError("");
    try {
      const signup = config || (await apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"));
      setConfig(signup);
      if (!signup.appId || !signup.configId) {
        throw new Error(
          signup.notice ||
            "Embedded Signup is not configured. Set FACEBOOK_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID. Contact ravee@lumer.me."
        );
      }
      await loadFacebookSdk(signup.appId, signup.graphVersion || "v21.0");
      const session = await launchEmbeddedSignupV4(signup);
      const data = await apiFetch<{ notice?: string }>("/api/whatsapp-numbers/embedded-signup/complete", {
        method: "POST",
        body: JSON.stringify({
          ownerType: "tenant",
          code: session.code,
          wabaId: session.wabaId,
          phoneNumberId: session.phoneNumberId,
        }),
      });
      setMessage(data.notice || "Clinic WhatsApp number connected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete Meta Embedded Signup.");
    } finally {
      setBusy(false);
    }
  };

  const handleSimulate = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>("/api/whatsapp-numbers/simulate-embedded-signup", {
        method: "POST",
        body: JSON.stringify({ ownerType: "tenant", displayName: "Clinic WABA" }),
      });
      setMessage(data.message || "SANDBOX / DEV-ONLY: clinic WABA ids stored locally.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not simulate clinic WhatsApp connect.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-2" data-testid="clinic-waba-connect">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Building2 className="w-4 h-4" />
        Connect clinic WhatsApp number
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 border border-amber-400/40">
          SANDBOX / DEV-ONLY
        </span>
      </div>
      <p className="text-xs text-slate-600">
        Optional clinic-owned WABA (one per tenant). Real Meta Embedded Signup v4 is wired; Lumera is not a certified
        Tech Provider. Contact ravee@lumer.me.
      </p>
      {connected ? (
        <p className="text-xs flex items-center gap-1.5 text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Clinic number connected ({mine?.tenantNumber?.phoneNumberId || mine?.tenantNumber?.wabaId}).
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRealConnect()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Connect with Meta Embedded Signup"}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          {simulatorsEnabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSimulate()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              Simulate (SANDBOX / DEV-ONLY)
            </button>
          ) : null}
        </div>
      )}
      {message ? <p className="text-[11px] text-amber-800">{message}</p> : null}
      {error ? <p className="text-[11px] text-rose-500">{error}</p> : null}
    </div>
  );
};
