import React, { useEffect, useState } from "react";
import { Smartphone, CheckCircle2, ArrowRight } from "lucide-react";
import { apiFetch } from "../api/http";

type MineResponse = {
  practitionerId?: string;
  doctorNumber?: { id: string; status: string; wabaId?: string; phoneNumberId?: string; metaWabaName?: string } | null;
  notice?: string;
  sandbox?: boolean;
};

type PersonalWabaConnectProps = {
  variant?: "onboarding" | "settings";
  onConnected?: () => void;
};

export const PersonalWabaConnect: React.FC<PersonalWabaConnectProps> = ({ variant = "settings", onConnected }) => {
  const [mine, setMine] = useState<MineResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const data = await apiFetch<MineResponse>("/api/whatsapp-numbers/mine");
      setMine(data);
    } catch {
      setMine(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connected = mine?.doctorNumber?.status === "connected";

  const handleConnect = async () => {
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
        Real Meta Embedded Signup (JS SDK + auth-code exchange) is not live. Lumera is not a certified Tech Provider.
        Contact ravee@lumer.me for Meta App Review questions.
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
            onClick={() => void handleConnect()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Connect personal WhatsApp (SANDBOX)"}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
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
