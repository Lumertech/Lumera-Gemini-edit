import React, { useEffect, useState } from "react";
import { Smartphone, CheckCircle2, ArrowRight, KeyRound } from "lucide-react";
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
  practitionerId?: string;
  doctorNumber?: {
    id: string;
    status: string;
    wabaId?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
    metaWabaName?: string;
  } | null;
  notice?: string;
  sandbox?: boolean;
  simulatorsEnabled?: boolean;
  embeddedSignupConfigured?: boolean;
  embeddedSignupLive?: boolean;
};

type PersonalWabaConnectProps = {
  variant?: "onboarding" | "settings";
  onConnected?: () => void;
};

function isExistingPinRequiredError(message: string): boolean {
  return /two-step verification PIN|6-digit.*PIN|PIN_REQUIRED/i.test(message);
}

export const PersonalWabaConnect: React.FC<PersonalWabaConnectProps> = ({ variant = "settings", onConnected }) => {
  const [mine, setMine] = useState<MineResponse | null>(null);
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [busy, setBusy] = useState(false);
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
        void loadFacebookSdk(signup.appId, signup.graphVersion).catch(() => {
          /* SDK loads on click if this prefetch fails */
        });
      }
    } catch {
      setMine(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connected = mine?.doctorNumber?.status === "connected";
  const simulatorsEnabled = Boolean(config?.simulatorsEnabled ?? mine?.simulatorsEnabled ?? mine?.sandbox);

  const completeSignup = async (payload: EmbeddedSignupSession, pinOverride?: string) => {
    const data = await apiFetch<{ notice?: string; message?: string; coexistence?: boolean }>(
      "/api/whatsapp-numbers/embedded-signup/complete",
      {
        method: "POST",
        body: JSON.stringify({
          ownerType: "doctor",
          code: payload.code,
          wabaId: payload.wabaId,
          phoneNumberId: payload.phoneNumberId,
          event: payload.event,
          ...(pinOverride ? { pin: pinOverride } : {}),
          displayName: "Personal WABA",
        }),
      }
    );
    setPendingPinSession(null);
    setExistingPin("");
    setMessage(
      data.coexistence
        ? "Personal WhatsApp Business App connected in Coexistence mode."
        : data.notice || data.message || "Personal WhatsApp number connected."
    );
    await load();
    onConnected?.();
  };

  const handleRealConnect = async () => {
    setBusy(true);
    setError("");
    let capturedSession: EmbeddedSignupSession | null = null;
    try {
      if (config?.appId && config?.configId && isFacebookSdkReadyFor(config.appId)) {
        capturedSession = await launchEmbeddedSignupV4(config);
        await completeSignup(capturedSession);
        return;
      }
      const signup =
        config || (await apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"));
      setConfig(signup);
      if (!signup.appId || !signup.configId) {
        throw new Error(signup.notice || `${WHATSAPP_CONNECTION_UNAVAILABLE_SENTENCE} ${WHATSAPP_CLINIC_STATUS_LINE}`);
      }
      await loadFacebookSdk(signup.appId, signup.graphVersion || "v21.0");
      capturedSession = await launchEmbeddedSignupV4(signup);
      await completeSignup(capturedSession);
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
      await completeSignup(pendingPinSession, trimmedPin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify PIN for WhatsApp registration.");
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
        body: JSON.stringify({ ownerType: "doctor", displayName: "Personal WABA" }),
      });
      setMessage(data.message || "SANDBOX / DEV-ONLY: personal WABA ids stored locally.");
      await load();
      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect a personal WhatsApp number.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "onboarding" && skipped && !connected) {
    return (
      <p className="text-[11px] text-slate-400 mt-3 mb-4">
        Personal WhatsApp skipped. You can connect a doctor-owned number later from Clinic settings.
      </p>
    );
  }

  const wrapClass =
    variant === "onboarding"
      ? "mt-4 mb-4 p-4 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2"
      : simulatorsEnabled
        ? "mt-6 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-2"
        : "mt-6 p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2";
  const titleClass =
    variant === "onboarding"
      ? "text-sm font-semibold text-slate-100"
      : simulatorsEnabled
        ? "text-sm font-semibold text-amber-900"
        : "text-sm font-semibold text-slate-900";
  const bodyClass = variant === "onboarding" ? "text-xs text-slate-400" : "text-xs text-slate-600";
  const connectedLabel =
    mine?.doctorNumber?.displayPhoneNumber || mine?.doctorNumber?.phoneNumberId || mine?.doctorNumber?.wabaId;

  return (
    <div className={wrapClass} data-testid="personal-waba-connect">
      <div className={`flex flex-wrap items-center gap-2 ${titleClass}`}>
        <Smartphone className="w-4 h-4" />
        Connect your own WhatsApp number
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
        Optional. Use this if you practice at more than one clinic and want inbound WhatsApp on a personal number
        (including WhatsApp Business App Coexistence). {META_TECH_PROVIDER_STATEMENT}{" "}
        {WHATSAPP_PERMISSIONS_STATUS_SENTENCE} Contact ravee@lumer.me.
      </p>
      {connected ? (
        <p className={`text-xs flex items-center gap-1.5 ${variant === "onboarding" ? "text-emerald-300" : "text-emerald-700"}`}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          Personal number connected ({connectedLabel}
          {mine?.doctorNumber?.metaWabaName ? ` · ${mine.doctorNumber.metaWabaName}` : ""}).
        </p>
      ) : (
        <div className="space-y-2 pt-1">
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
                {busy ? "Connecting…" : "Simulate (SANDBOX / DEV-ONLY)"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setSkipped(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                variant === "onboarding" ? "bg-slate-800 text-slate-300" : "bg-white border border-slate-200 text-slate-600"
              }`}
            >
              Skip for now
            </button>
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
      {message ? <p className={`text-[11px] ${variant === "onboarding" ? "text-emerald-200" : "text-emerald-800"}`}>{message}</p> : null}
      {error ? <p className="text-[11px] text-rose-500">{error}</p> : null}
    </div>
  );
};
