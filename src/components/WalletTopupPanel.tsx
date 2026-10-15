import React, { useEffect, useState } from "react";
import { Wallet, X } from "lucide-react";
import { apiFetch } from "../api/http";

interface WalletStatus {
  balance: number;
  lowBalanceThreshold: number;
  state: string;
  message: string | null;
}

interface WalletTx {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
}

export const WalletTopupPanel: React.FC = () => {
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [amount, setAmount] = useState("500");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payLink, setPayLink] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);

  const load = () => {
    apiFetch<{ wallet: WalletStatus }>("/api/wallet/status")
      .then(async (status) => {
        setWallet(status.wallet);
        setStatusFailed(false);
        try {
          const d = await apiFetch<{ wallet: WalletStatus; transactions: WalletTx[] }>("/api/wallet");
          setWallet(d.wallet);
          setTransactions(d.transactions || []);
        } catch {
          setTransactions([]);
        }
      })
      .catch(() => {
        setStatusFailed(true);
        setError("");
      });
  };

  useEffect(() => {
    load();
  }, []);

  const topup = async () => {
    setError("");
    setNotice("");
    try {
      const d = await apiFetch<{
        payLink: string;
        sandbox?: boolean;
        notice?: string;
      }>("/api/wallet/topup", {
        method: "POST",
        body: JSON.stringify({ amountRupees: Number(amount) }),
      });
      setPayLink(d.payLink || "");
      setNotice(d.notice || "Top-up order created.");
      if (d.sandbox) {
        await apiFetch("/api/wallet/sandbox-topup", {
          method: "POST",
          body: JSON.stringify({ amountRupees: Number(amount) }),
        });
        setNotice("SANDBOX / DEV-ONLY: wallet credited locally. Not a Razorpay settlement.");
        load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Top-up failed");
    }
  };

  if (dismissed || statusFailed || !wallet) return null;

  return (
    <section
      className="mb-4 bg-white border border-slate-200 rounded-xl p-4 space-y-3"
      data-testid="wallet-topup-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-blue-700" /> Usage wallet (platform billing)
        </h3>
        <button
          type="button"
          className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close usage wallet"
          data-testid="wallet-topup-close"
          onClick={() => setDismissed(true)}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Prepaid balance for WhatsApp Cloud API messages and AI Scribe. This is not a patient invoice and not the monthly
        SaaS plan fee.
      </p>
      {wallet && (
        <p className="text-sm">
          Balance <strong>₹{wallet.balance.toFixed(2)}</strong>
          <span className="text-xs text-slate-500"> · {wallet.state}</span>
        </p>
      )}
      {wallet?.message && <p className="text-xs text-amber-800">{wallet.message}</p>}
      <div className="flex gap-2">
        <input
          className="border rounded px-2 py-1.5 text-sm w-28"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="wallet-topup-amount"
        />
        <button
          type="button"
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold"
          onClick={topup}
          data-testid="wallet-topup-submit"
        >
          Top up
        </button>
      </div>
      {payLink && (
        <a href={payLink} className="text-xs text-blue-700 underline" target="_blank" rel="noreferrer">
          Open pay link
        </a>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs text-slate-600">{notice}</p>}
      <ul className="text-[11px] text-slate-600 max-h-32 overflow-y-auto divide-y">
        {transactions.slice(0, 8).map((t) => (
          <li key={t.id} className="py-1">
            {t.type} ₹{t.amount} → ₹{t.balanceAfter} · {t.note || t.createdAt}
          </li>
        ))}
      </ul>
    </section>
  );
};
