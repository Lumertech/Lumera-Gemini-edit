import React, { useEffect, useState } from "react";
import { Smartphone, CheckCircle2, ArrowRight } from "lucide-react";
import { apiFetch } from "../api/http";
import {
  launchEmbeddedSignupV4,
  loadFacebookSdk,
  type EmbeddedSignupConfig,
} from "../lib/facebook-embedded-signup";

type MineResponse = {
  practitionerId?: string;
  doctorNumber?: { id: string; status: string; wabaId?: string; phoneNumberId?: string; metaWabaName?: string } | null;
  notice?: string;
  sandbox?: boolean;
  simulatorsEnabled?: boolean;
  embeddedSignupConfigured?: boolean;
};

type PersonalWabaConnectProps = {
  variant?: "onboarding" | "settings";
  onConnected?: () => void;
};

export const PersonalWabaConnect: React.FC<PersonalWabaConnectProps> = ({ variant = "settings", onConnected }) => {
  const [mine, setMine] = useState<MineResponse | null>(null);
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
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
  const simulatorsEnabled = Boolean(config?.simulatorsEnabled ?? mine?.sandbox);

  const completeSignup = async (payload: { code: string; wabaId: string; phoneNumberId: string; businessId?: string }) => {
    const data = await apiFetch<{ notice?: string; message?: string }>("/api/whatsapp-numbers/embedded-signup/complete", {
      method: "POST",
      body: JSON.stringify({
        ownerType: "doctor",
        code: payload.code,
        wabaId: payload.wabaId,
        phoneNumberId: payload.phoneNumberId,
        businessId: payload.businessId || "",
        displayName: "Personal WABA",
      }),
    });
    setMessage(data.notice || data.message || "Personal WhatsApp number connected.");
    await load();
    onConnected?.();
  };

  const handleRealConnect = async () => {
    setBusy(true);
    setError("");
    try {
      const signup =
        config || (await apiFetch<EmbeddedSignupConfig>("/api/meta/embedded-signup-config"));
      setConfig(signup);
      if (!signup.appId || !signup.configId) {
        throw new Error(
          signup.notice ||
            "Embedded Signup is not configured. Set FACEBOOK_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID. Contact ravee@lumer.me."
        );
      }
      await loadFacebookSdk(signup.appId, signup.graphVersion || "v21.0");
      const session = await launchEmbeddedSignupV4(signup);
      await completeSignup({
        code: session.code,
        wabaId: session.wabaId,
        phoneNumberId: session.phoneNumberId,
        businessId: session.businessId,
      });
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
      <p className="text-[11px] text-slate-400 mt-3">
        Personal WhatsApp skipped. You can connect a doctor-owned number later from Clinic settings.
      </p>
    );
  }

  const wrapClass =
    variant === "onboarding"
      ? "mt-4 p-4 rounded-xl border border-amber-800/50 bg-amber-950/20 space-y-2"
      : "mt-6 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-2";
  const titleClass = variant === "onboarding" ? "text-sm font-semibold text-amber-200" : "text-sm font-semibold text-amber-900";
  const bodyClass = variant === "onboarding" ? "text-xs text-slate-400" : "text-xs text-slate-600";

  return (
    <div className={wrapClass} data-testid="personal-waba-connect">
      <div className={`flex items-center gap-2 ${titleClass}`}>
        <Smartphone className="w-4 h-4" />
        Connect your own WhatsApp number
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 border border-amber-400/40">
          SANDBOX / DEV-ONLY
        </span>
      </div>
      <p className={bodyClass}>
        Optional. Use this if you practice at more than one clinic and want inbound WhatsApp on a personal number.
        Real Meta Embedded Signup v4 (JS SDK + config_id) is wired; Lumera is not a certified Tech Provider and App Review
        is not claimed. Contact ravee@lumer.me.
      </p>
      {connected ? (
        <p className={`text-xs flex items-center gap-1.5 ${variant === "onboarding" ? "text-emerald-300" : "text-emerald-700"}`}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          Personal number connected ({mine?.doctorNumber?.phoneNumberId || mine?.doctorNumber?.wabaId}).
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
      )}
      {message ? <p className={`text-[11px] ${variant === "onboarding" ? "text-amber-200" : "text-amber-800"}`}>{message}</p> : null}
      {error ? <p className="text-[11px] text-rose-500">{error}</p> : null}
    </div>
  );
};
