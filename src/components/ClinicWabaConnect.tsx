import React, { useEffect, useState } from "react";
import { Building2, CheckCircle2, ArrowRight, RefreshCw, KeyRound } from "lucide-react";
import { apiFetch } from "../api/http";
import {
  META_TECH_PROVIDER_STATEMENT,
  WHATSAPP_CLINIC_STATUS_LINE,
  WHATSAPP_CONNECTION_UNAVAILABLE_SENTENCE,
  WHATSAPP_PERMISSIONS_STATUS_SENTENCE,
} from "../lib/metaStatus";
import {
  isFacebookSdkReadyFor,
  launchEmbeddedSignupV4,
  loadFacebookSdk,
  type EmbeddedSignupConfig,
  type EmbeddedSignupSession,
} from "../lib/facebook-embedded-signup";

type MineResponse = {
  tenantNumber?: {
    id: string;
    status: string;
    wabaId?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
    metaWabaName?: string;
  } | null;
  sandbox?: boolean;
  simulatorsEnabled?: boolean;
  embeddedSignupLive?: boolean;
  notice?: string;
};

type ClinicWabaConnectProps = {
  variant?: "onboarding" | "settings";
  onConnected?: () => void;
};

function isExistingPinRequiredError(message: string): boolean {
  return /two-step verification PIN|6-digit.*PIN|PIN_REQUIRED/i.test(message);
}

export const ClinicWabaConnect: React.FC<ClinicWabaConnectProps> = ({ variant = "settings", onConnected }) => {
  const [mine, setMine] = useState<MineResponse | null>(null);
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [pendingPinSession, setPendingPinSession] = useState<EmbeddedSignupSession | null>(null);
  const [existingPin, setExistingPin] = useState("");
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
  const simulatorsEnabled = Boolean(config?.simulatorsEnabled ?? mine?.simulatorsEnabled ?? mine?.sandbox);

  const submitSession = async (session: EmbeddedSignupSession, pinOverride?: string) => {
    const data = await apiFetch<{ notice?: string; coexistence?: boolean }>("/api/whatsapp-numbers/embedded-signup/complete", {
      method: "POST",
      body: JSON.stringify({
        ownerType: "tenant",
        code: session.code,
        wabaId: session.wabaId,
        phoneNumberId: session.phoneNumberId,
        event: session.event,
        ...(pinOverride ? { pin: pinOverride } : {}),
      }),
    });
    setPendingPinSession(null);
    setExistingPin("");
    setMessage(
      data.coexistence
        ? "Clinic WhatsApp Business App connected in Coexistence mode."
        : data.notice || "Clinic WhatsApp number connected."
    );
    await load();
    onConnected?.();
  };

  const handleRealConnect = async () => {
    setBusy(true);
    setError("");
    let capturedSession: EmbeddedSignupSession | null = null;
    try {
      // Launch synchronously when SDK + config are already warm so browser popup blockers don't block FB.login
      if (config?.appId && config?.configId && isFacebookSdkReadyFor(config.appId)) {
        capturedSession = await launchEmbeddedSignupV4(config);
        await submitSession(capturedSession);
        return;
      }
      const signup = config || (await apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"));
      setConfig(signup);
      if (!signup.appId || !signup.configId) {
        throw new Error(signup.notice || `${WHATSAPP_CONNECTION_UNAVAILABLE_SENTENCE} ${WHATSAPP_CLINIC_STATUS_LINE}`);
      }
      await loadFacebookSdk(signup.appId, signup.graphVersion || "v21.0");
      capturedSession = await launchEmbeddedSignupV4(signup);
      await submitSession(capturedSession);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Could not complete Meta Embedded Signup.";
      if (capturedSession && isExistingPinRequiredError(errMsg)) {
        setPendingPinSession(capturedSession);
      }
      setError(errMsg);
    } finally {
      setBusy(false);
    }
  };

  const handleRetryWithPin = async () => {
    if (!pendingPinSession) return;
    const trimmedPin = existingPin.replace(/\D/g, "").slice(0, 6);
    if (trimmedPin.length !== 6) {
      setError("Enter your existing 6-digit WhatsApp two-step verification PIN.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submitSession(pendingPinSession, trimmedPin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify PIN for WhatsApp registration.");
    } finally {
      setBusy(false);
    }
  };

  const handleSyncTemplates = async () => {
    setSyncingTemplates(true);
    setError("");
    try {
      const res = await apiFetch<{ synced?: number; provisioned?: number }>(
        "/api/whatsapp-numbers/sync-templates",
        { method: "POST", body: JSON.stringify({}) }
      );
      const created = res.provisioned || 0;
      const synced = res.synced ?? 0;
      setMessage(
        created > 0
          ? `Synced ${synced} templates and submitted ${created} standard utility template(s) to Meta.`
          : `Synced ${synced} WhatsApp templates from your WABA.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync WhatsApp templates.");
    } finally {
      setSyncingTemplates(false);
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
      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not simulate clinic WhatsApp connect.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "onboarding" && skipped && !connected) {
    return (
      <p className="text-[11px] text-slate-400 mt-3">
        Clinic WhatsApp skipped for now. You can connect your clinic WABA anytime from Clinic Settings or WhatsApp Hub.
      </p>
    );
  }

  const wrapClass =
    variant === "onboarding"
      ? "mt-4 mb-4 p-4 rounded-xl border border-emerald-800/50 bg-emerald-950/20 space-y-2"
      : simulatorsEnabled
        ? "mt-6 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-2"
        : "mt-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-2";
  const titleClass =
    variant === "onboarding"
      ? "text-sm font-semibold text-emerald-200"
      : simulatorsEnabled
        ? "text-sm font-semibold text-amber-900"
        : "text-sm font-semibold text-slate-900";
  const bodyClass = variant === "onboarding" ? "text-xs text-slate-400" : "text-xs text-slate-600";
  const connectedLabel =
    mine?.tenantNumber?.displayPhoneNumber || mine?.tenantNumber?.phoneNumberId || mine?.tenantNumber?.wabaId;

  return (
    <div className={wrapClass} data-testid="clinic-waba-connect">
      <div className={`flex flex-wrap items-center gap-2 ${titleClass}`}>
        <Building2 className="w-4 h-4" />
        Connect clinic WhatsApp number
        {simulatorsEnabled ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 border border-amber-400/40">
            SANDBOX / DEV-ONLY
          </span>
        ) : (
          <span
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
              variant === "onboarding"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "bg-emerald-100 text-emerald-800 border-emerald-300"
            }`}
          >
            Meta Embedded Signup v4
          </span>
        )}
      </div>
      <p className={bodyClass}>
        Optional clinic-owned WABA (one per tenant, including WhatsApp Business App Coexistence).{" "}
        {META_TECH_PROVIDER_STATEMENT} {WHATSAPP_PERMISSIONS_STATUS_SENTENCE} Contact ravee@lumer.me.
      </p>
      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className={`text-xs flex items-center gap-1.5 ${variant === "onboarding" ? "text-emerald-300" : "text-emerald-700"}`}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            Clinic number connected ({connectedLabel}
            {mine?.tenantNumber?.metaWabaName ? ` · ${mine.tenantNumber.metaWabaName}` : ""}).
          </p>
          <button
            type="button"
            disabled={syncingTemplates}
            onClick={() => void handleSyncTemplates()}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold disabled:opacity-50 ${
              variant === "onboarding"
                ? "bg-slate-800 text-slate-200 border border-slate-700"
                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${syncingTemplates ? "animate-spin" : ""}`} />
            {syncingTemplates ? "Syncing templates…" : "Sync WhatsApp templates"}
          </button>
        </div>
      ) : (
        <div className="space-y-2.5 pt-1">
          <ul
            className={`space-y-1 text-[11px] leading-relaxed rounded-lg p-2.5 border ${
              variant === "onboarding"
                ? "bg-slate-950/60 border-slate-800 text-slate-300"
                : "bg-white/80 border-slate-200 text-slate-600"
            }`}
          >
            <li>
              <strong className={variant === "onboarding" ? "text-emerald-300" : "text-slate-900"}>
                1. Dedicated new SIM or clinic landline (Recommended):
              </strong>{" "}
              Any number not active on WhatsApp links in 2 minutes via 6-digit SMS or direct voice call OTP.
            </li>
            <li>
              <strong className={variant === "onboarding" ? "text-blue-300" : "text-slate-900"}>
                2. Meta virtual number (No extra SIM needed):
              </strong>{" "}
              Meta can provision a cloud business number inside Embedded Signup once your Meta Business Portfolio is verified.
            </li>
            <li>
              <strong className={variant === "onboarding" ? "text-amber-300" : "text-slate-900"}>
                3. Existing WhatsApp number rules:
              </strong>{" "}
              Personal WhatsApp Messenger numbers cannot run simultaneously on Cloud API (delete the in-app account first to migrate), whereas eligible WhatsApp Business App numbers can link via Coexistence QR scan.
            </li>
          </ul>
          <div className="flex flex-wrap gap-2">
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
            {variant === "onboarding" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setSkipped(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300"
              >
                Skip for now
              </button>
            ) : null}
          </div>
          {pendingPinSession ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <KeyRound className="w-3.5 h-3.5 text-amber-500" />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Existing 6-digit PIN"
                value={existingPin}
                onChange={(e) => setExistingPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={`px-2.5 py-1 rounded-lg text-xs border w-40 ${
                  variant === "onboarding"
                    ? "bg-slate-900 border-slate-700 text-white"
                    : "bg-white border-slate-300 text-slate-900"
                }`}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRetryWithPin()}
                className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                Verify PIN & Connect
              </button>
            </div>
          ) : null}
        </div>
      )}
      {message ? (
        <p className={`text-[11px] ${variant === "onboarding" ? "text-emerald-200" : "text-emerald-800"}`}>{message}</p>
      ) : null}
      {error ? <p className="text-[11px] text-rose-500">{error}</p> : null}
    </div>
  );
};
