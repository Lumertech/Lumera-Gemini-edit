import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useNav } from "../../nav/NavigationContext";

interface Policy {
  slug: string;
  title: string;
  body: string;
  updated_at: string;
}

export const AdminPolicies: React.FC = () => {
  const { go } = useNav();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [active, setActive] = useState<string>("privacy");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ policies: Policy[] }>("/api/cms/policies").then((d) => {
      setPolicies(d.policies);
      if (d.policies[0]) setActive(d.policies[0].slug);
    });
  }, []);

  const current = policies.find((p) => p.slug === active);

  const save = async () => {
    if (!current) return;
    const d = await apiFetch<{ policy: Policy }>(`/api/cms/policies/${current.slug}`, {
      method: "PUT",
      body: JSON.stringify({ title: current.title, body: current.body }),
    });
    setPolicies((prev) => prev.map((p) => (p.slug === d.policy.slug ? d.policy : p)));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-extrabold">Pages & policies</h1>
      <div className="flex gap-2">
        {policies.map((p) => (
          <button
            key={p.slug}
            onClick={() => setActive(p.slug)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${active === p.slug ? "bg-blue-600 text-white" : "bg-white border"}`}
          >
            {p.title}
          </button>
        ))}
      </div>
      {current && (
        <div className="bg-white border rounded-xl p-4 space-y-3">
          <input
            className="w-full border rounded px-3 py-2 text-sm font-semibold"
            value={current.title}
            onChange={(e) =>
              setPolicies((prev) => prev.map((p) => (p.slug === current.slug ? { ...p, title: e.target.value } : p)))
            }
          />
          <textarea
            className="w-full border rounded px-3 py-2 text-sm min-h-[360px] font-mono"
            value={current.body}
            onChange={(e) =>
              setPolicies((prev) => prev.map((p) => (p.slug === current.slug ? { ...p, body: e.target.value } : p)))
            }
          />
          <div className="flex items-center gap-3">
            <button onClick={save} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg">
              Save policy
            </button>
            {saved && <span className="text-xs text-emerald-600">Saved</span>}
            <button
              type="button"
              className="text-xs text-blue-600"
              onClick={() => go("policy", { policySlug: current.slug })}
            >
              View public page
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
