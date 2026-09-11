import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { DhisMeter } from "../dhis/DhisMeter";

interface Overview {
  users: number;
  subscriptions: number;
  activePlans: number;
  trials: number;
  mrr: number;
  media: number;
  policies: number;
  geminiConfigured: boolean;
  recentAudit: { id: string; timestamp: string; user_name: string; action: string; details: string }[];
}

export const AdminOverview: React.FC = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Overview>("/api/admin/overview")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load overview"));
  }, []);

  if (error) {
    return (
      <p className="text-sm text-red-600" data-testid="admin-overview-error">
        {error}
      </p>
    );
  }
  if (!data) return <p className="text-sm text-slate-500">Loading overview…</p>;

  const cards = [
    ["Users", data.users],
    ["Subscriptions", data.subscriptions],
    ["Active plans", data.activePlans],
    ["Trials", data.trials],
    ["MRR (₹)", data.mrr],
    ["Media", data.media],
    ["Policies", data.policies],
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-manrope text-2xl font-bold text-slate-900">Admin dashboard</h1>
        <p className="text-sm text-slate-500">Website, accounts, and subscription health — not the clinical EMR.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-[11px] uppercase text-slate-500 font-bold">{label}</div>
            <div className="text-2xl font-extrabold mt-1 text-slate-900">{value}</div>
          </div>
        ))}
      </div>
      {/* NHA ABDM DHIS Incentive Tracker */}
      <DhisMeter compact={true} />

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs font-bold mb-2 text-purple-700">Platform</div>
        <p className="text-sm">
          {data.geminiConfigured
            ? "Gemini API is configured for clinician AI features."
            : "Gemini API is not configured. Clinician AI will use local synthesis."}
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b text-xs font-bold uppercase text-slate-500">Recent admin activity</div>
        <table className="w-full text-xs">
          <tbody>
            {data.recentAudit.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{l.timestamp}</td>
                <td className="px-4 py-2 font-semibold">{l.user_name}</td>
                <td className="px-4 py-2">{l.action}</td>
                <td className="px-4 py-2 text-slate-600">{l.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
