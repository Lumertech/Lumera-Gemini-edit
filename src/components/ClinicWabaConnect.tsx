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

type TemplateStatus = {
  name: string;
  label: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "MISSING";
  rejectionReason: string;
  sending: string;
};

type ClinicWhatsAppStatus = {
  connected: boolean;
  phoneNumberId: string;
  displayPhoneNumber: string;
  displayName: string;
  templates: TemplateStatus[];
  graphErrors: Array<{ code: string; guidance: string }>;
  lastGraphError: { code: string; guidance: string; at: string } | null;
};

export const ClinicWabaConnect: React.FC = () => {
  const [mine, setMine] = useState<MineResponse | null>(null);
  const [status, setStatus] = useState<ClinicWhatsAppStatus | null>(null);
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const [data, signup, clinicStatus] = await Promise.all([
        apiFetch<MineResponse>("/api/whatsapp-numbers/mine"),
        apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"),
        apiFetch<ClinicWhatsAppStatus>("/api/meta/whatsapp-clinic-status").catch(() => null),
      ]);
      setMine(data);
      setStatus(clinicStatus);
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
  const displayPhone = status?.displayPhoneNumber || mine?.tenantNumber?.phoneNumberId || "";
  const displayName = status?.displayName || mine?.tenantNumber?.metaWabaName || "";

  const resyncTemplates = async () => {
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/meta/templates/resync", { method: "POST", body: "{}" });
      setMessage("Template statuses were read from Meta.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resync WhatsApp templates.");
    } finally {
      setBusy(false);
    }
  };

  const handleRealConnect = async () => {
    setBusy(true);
    setError("");
    try {
      const signup = config || (await apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"));
      setConfig(signup);
      if (!signup.appId || !signup.configId) {
        throw new Error(
          signup.notice ||
            "WhatsApp connection isn't available on this environment yet. Contact ravee@lumer.me. Lumera Solutions LLP is a Meta Tech Provider for the WhatsApp Business Platform. WhatsApp permissions submitted for Meta App Review in September 2026; not yet granted."
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
        Optional clinic-owned WABA (one per tenant). Lumera Solutions LLP is a Meta Tech Provider for the WhatsApp
        Business Platform. WhatsApp permissions submitted for Meta App Review in September 2026; not yet granted.
      </p>
      {connected ? (
        <div className="space-y-2" data-testid="clinic-whatsapp-status">
          <p className="text-xs flex items-center gap-1.5 text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Connected{displayName ? `: ${displayName}` : ""}{displayPhone ? ` (${displayPhone})` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRealConnect()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Reconnect"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resyncTemplates()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Resync templates
            </button>
          </div>
        </div>
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
      {status?.templates?.length ? (
        <ul className="text-xs space-y-1.5 pt-1">
          {status.templates.map((template) => (
            <li key={template.name} className="rounded-lg bg-white/80 border border-amber-100 px-2 py-1.5">
              <span className="font-semibold text-slate-800">{template.label}</span>
              <span className="ml-2 uppercase tracking-wide text-[10px] text-slate-500">{template.status}</span>
              {template.status === "REJECTED" && template.rejectionReason ? (
                <span className="block text-rose-600">{template.rejectionReason}</span>
              ) : null}
              <span className="block text-slate-600">{template.sending}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {status?.lastGraphError ? (
        <p className="text-xs text-rose-700">
          Last WhatsApp error #{status.lastGraphError.code}: {status.lastGraphError.guidance}
        </p>
      ) : null}
      {status?.graphErrors?.length ? (
        <details className="text-[11px] text-slate-600">
          <summary className="cursor-pointer">What WhatsApp errors mean</summary>
          <ul className="mt-1 space-y-1">
            {status.graphErrors.map((item) => (
              <li key={item.code}>
                <span className="font-mono">{item.code}</span> — {item.guidance}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {message ? <p className="text-[11px] text-amber-800">{message}</p> : null}
      {error ? <p className="text-[11px] text-rose-500">{error}</p> : null}
    </div>
  );
};
