import React, { useEffect, useState } from "react";
import { Building2, CheckCircle2, ArrowRight, AlertCircle, Shield, Smartphone, Hash } from "lucide-react";
import { apiFetch } from "../api/http";
import {
  launchEmbeddedSignupV4,
  loadFacebookSdk,
  type EmbeddedSignupConfig,
} from "../lib/facebook-embedded-signup";

type TenantNumber = {
  id: string;
  status: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  metaWabaName?: string;
  phoneStatus?: string;
  codeVerificationStatus?: string;
  displayNameStatus?: string;
  businessVerificationStatus?: string;
  qualityRating?: string;
};

type MineResponse = {
  tenantNumber?: TenantNumber | null;
  sandbox?: boolean;
  simulatorsEnabled?: boolean;
  notice?: string;
  connectionStatus?: {
    businessVerification?: "verified" | "pending" | "unknown";
    wabaId?: string | null;
    phoneNumberId?: string | null;
    phoneNumberStatus?: string;
    displayNameStatus?: string;
    codeVerificationStatus?: string;
  };
  fallback?: {
    available?: boolean;
    phoneNumberIdConfigured?: boolean;
    notice?: string;
  };
};

type ClinicWabaConnectProps = {
  variant?: "onboarding" | "settings";
};

function statusTone(kind: "ok" | "pending" | "unknown") {
  if (kind === "ok") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (kind === "pending") return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function verificationKind(value?: string | null): "ok" | "pending" | "unknown" {
  const raw = String(value || "").toLowerCase();
  if (/verified|approved/.test(raw)) return "ok";
  if (raw && raw !== "unknown") return "pending";
  return "unknown";
}

function Badge({
  label,
  value,
  kind,
  icon,
}: {
  label: string;
  value: string;
  kind: "ok" | "pending" | "unknown";
  icon: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold border ${statusTone(kind)}`}
      data-testid={`waba-badge-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {icon}
      <span className="uppercase tracking-wide text-[9px] opacity-70">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

export const ClinicWabaConnect: React.FC<ClinicWabaConnectProps> = ({ variant = "settings" }) => {
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
  const awaitingVerification =
    connected && verificationKind(mine?.connectionStatus?.businessVerification) !== "ok";
  const phonePending =
    connected &&
    !/verified|connected|available/i.test(
      String(mine?.connectionStatus?.codeVerificationStatus || mine?.connectionStatus?.phoneNumberStatus || "")
    );

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
      const data = await apiFetch<{ notice?: string }>("/api/integrations/whatsapp/embedded-signup", {
        method: "POST",
        body: JSON.stringify({
          code: session.code,
          wabaId: session.wabaId,
          phoneNumberId: session.phoneNumberId,
          businessId: session.businessId || "",
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

  const wrapClass =
    variant === "onboarding"
      ? "mt-4 p-4 rounded-xl border border-amber-800/50 bg-amber-950/20 space-y-3"
      : "mt-6 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3";
  const titleClass = variant === "onboarding" ? "text-sm font-semibold text-amber-200" : "text-sm font-semibold text-amber-900";
  const bodyClass = variant === "onboarding" ? "text-xs text-slate-400" : "text-xs text-slate-600";

  const wabaId = mine?.connectionStatus?.wabaId || mine?.tenantNumber?.wabaId || "";
  const phoneStatus = mine?.connectionStatus?.phoneNumberStatus || "not linked";
  const businessKind = verificationKind(mine?.connectionStatus?.businessVerification);
  const phoneKind = connected ? (phonePending ? "pending" : "ok") : "unknown";

  return (
    <div className={wrapClass} data-testid="clinic-waba-connect">
      <div className={`flex items-center gap-2 flex-wrap ${titleClass}`}>
        <Building2 className="w-4 h-4" />
        Connect clinic WhatsApp number
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 border border-amber-400/40">
          SANDBOX / DEV-ONLY
        </span>
      </div>
      <p className={bodyClass}>
        Meta Embedded Signup is required for this clinic. There are no manual token or API-secret fields — Facebook Login
        requests <code>whatsapp_business_management</code> and <code>whatsapp_business_messaging</code>. Lumera is not a
        certified Tech Provider. Contact ravee@lumer.me.
      </p>

      <div className="flex flex-wrap gap-2" data-testid="clinic-waba-status-badges">
        <Badge
          label="Meta Business Verification"
          value={
            businessKind === "ok" ? "Verified" : businessKind === "pending" ? "Pending" : connected ? "Pending" : "Not linked"
          }
          kind={connected ? (businessKind === "unknown" ? "pending" : businessKind) : "unknown"}
          icon={<Shield className="w-3 h-3" />}
        />
        <Badge
          label="WABA ID"
          value={wabaId || "Not linked"}
          kind={wabaId ? "ok" : "unknown"}
          icon={<Hash className="w-3 h-3" />}
        />
        <Badge
          label="Phone Number Status"
          value={phoneStatus}
          kind={phoneKind}
          icon={<Smartphone className="w-3 h-3" />}
        />
      </div>

      {connected && (awaitingVerification || phonePending || mine?.fallback?.available) ? (
        <p className={`text-[11px] ${variant === "onboarding" ? "text-amber-200" : "text-amber-800"}`}>
          {mine?.fallback?.notice ||
            "While Meta verifies your custom phone number and display name, appointment reminders send from Lumera's shared test number."}
        </p>
      ) : null}

      {connected ? (
        <p className={`text-xs flex items-center gap-1.5 ${variant === "onboarding" ? "text-emerald-300" : "text-emerald-700"}`}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          Clinic number linked ({mine?.tenantNumber?.phoneNumberId || mine?.tenantNumber?.wabaId}).
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
      {message ? (
        <p className={`text-[11px] ${variant === "onboarding" ? "text-amber-200" : "text-amber-800"}`}>{message}</p>
      ) : null}
      {error ? (
        <p className="text-[11px] text-rose-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      ) : null}
    </div>
  );
};
