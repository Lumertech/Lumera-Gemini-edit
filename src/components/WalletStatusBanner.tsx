import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "../api/http";
import { useAuth } from "../auth/AuthContext";
import { useNav } from "../nav/NavigationContext";

type WalletState = "ok" | "low" | "empty" | "negative";

interface WalletStatus {
  balance: number;
  state: WalletState;
  topUpPrompt: boolean;
  message: string | null;
}

export const WalletStatusBanner: React.FC = () => {
  const { user } = useAuth();
  const { go } = useNav();
  const [wallet, setWallet] = useState<WalletStatus | null>(null);

  useEffect(() => {
    if (!user?.tenantId || user.role === "patient") return;
    let cancelled = false;
    const load = () => {
      apiFetch<{ wallet: WalletStatus }>("/api/wallet/status")
        .then((d) => {
          if (!cancelled) setWallet(d.wallet);
        })
        .catch(() => {
          if (!cancelled) setWallet(null);
        });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user?.tenantId, user?.role]);

  if (!wallet?.topUpPrompt || !wallet.message) return null;

  return (
    <div
      className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-950 flex items-start gap-2"
      data-testid="wallet-topup-prompt"
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
      <div className="flex-1">
        <p>{wallet.message}</p>
        <p className="text-[11px] text-amber-800 mt-0.5">Current balance ₹{wallet.balance.toFixed(2)}</p>
      </div>
      <button
        type="button"
        className="shrink-0 px-2.5 py-1 bg-amber-700 text-white rounded-md text-[11px] font-semibold"
        onClick={() => go("app", { appView: "billing" })}
      >
        Top up now
      </button>
    </div>
  );
};
