import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";

interface Overview {
  users: number;
  doctors: number;
  staff: number;
  branches: number;
  media: number;
  policies: number;
  geminiConfigured: boolean;
  recentAudit: { id: string; timestamp: string; user_name: string; action: string; details: string }[];
}

export const AdminOverview: React.FC = () => {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    apiFetch<Overview>("/api/admin/overview").then(setData).catch(() => undefined);
  }, []);

  if (!data) return <p className="text-sm text-slate-500">Loading overview…</p>;

  const cards = [
    ["Users", data.users],
    ["Doctors", data.doctors],
    ["Staff", data.staff],
    ["Branches", data.branches],
    ["Media", data.media],
    ["Policies", data.policies],
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-extrabold">Practice overview</h1>
        <p className="text-sm text-slate-500">Live counts from SQLite plus recent admin actions.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-[11px] uppercase text-slate-500 font-bold">{label}</div>
            <div className="text-2xl font-extrabold mt-1">{value}</div>
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs font-bold mb-2">Gemini API</div>
        <p className="text-sm">{data.geminiConfigured ? "Configured in server environment" : "Not configured — AI falls back to local synthesis. Set GEMINI_API_KEY in .env."}</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b text-xs font-bold uppercase text-slate-500">Recent audit</div>
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
