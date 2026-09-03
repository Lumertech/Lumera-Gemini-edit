import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";

interface Section {
  id: string;
  type: string;
  sortOrder: number;
  payload: Record<string, unknown>;
}

export const AdminCmsSite: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [sections, setSections] = useState<Section[]>([]);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    apiFetch<{ settings: Record<string, string> }>("/api/cms/settings").then((d) => setSettings(d.settings));
    apiFetch<{ sections: Section[] }>("/api/cms/sections").then((d) => setSections(d.sections));
  }, []);

  const saveSettings = async () => {
    await apiFetch("/api/cms/settings", { method: "PUT", body: JSON.stringify({ settings }) });
    setSaved("Hero & stats saved");
    setTimeout(() => setSaved(""), 2000);
  };

  const saveSections = async () => {
    await apiFetch("/api/cms/sections", { method: "PUT", body: JSON.stringify({ sections }) });
    setSaved("Landing sections saved");
    setTimeout(() => setSaved(""), 2000);
  };

  const updatePayload = (id: string, patch: Record<string, unknown>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, payload: { ...s.payload, ...patch } } : s))
    );
  };

  const field = (key: string, label: string, multiline = false) => (
    <label key={key} className="block text-xs font-semibold text-slate-700">
      {label}
      {multiline ? (
        <textarea
          className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
          rows={3}
          value={settings[key] || ""}
          onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
        />
      ) : (
        <input
          className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
          value={settings[key] || ""}
          onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
        />
      )}
    </label>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-manrope text-xl font-extrabold">Website management</h1>
          <p className="text-xs text-slate-500">Landing copy from lumer.me — live after save.</p>
        </div>
        {saved && <span className="text-xs text-emerald-600">{saved}</span>}
      </div>
      <section className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm">Hero & brand</h2>
        {field("brand_name", "Brand name")}
        {field("badge_text", "Badge")}
        {field("hero_title", "Hero title", true)}
        {field("hero_subtitle", "Hero subtitle", true)}
        {field("cta_primary", "Primary CTA")}
        {field("cta_secondary", "Secondary CTA")}
        {field("cta_banner_title", "Bottom CTA title")}
        {field("cta_banner_subtitle", "Bottom CTA subtitle", true)}
        {field("contact_email", "Contact email")}
        {field("logo_url", "Logo URL (from media library)")}
        <label className="block text-xs font-semibold">
          Stats JSON
          <textarea
            className="mt-1 w-full border rounded-lg px-3 py-2 font-mono text-[11px]"
            rows={6}
            value={settings.stats || "[]"}
            onChange={(e) => setSettings({ ...settings, stats: e.target.value })}
          />
        </label>
        <button onClick={saveSettings} className="px-4 py-2 bg-purple-600 text-white text-xs font-semibold rounded-lg">
          Save hero & stats
        </button>
      </section>

      {["pain", "feature", "persona", "testimonial"].map((type) => (
        <section key={type} className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-sm capitalize">{type}s</h2>
          {sections
            .filter((s) => s.type === type)
            .map((s) => (
              <div key={s.id} className="border rounded-lg p-3 grid sm:grid-cols-2 gap-2 text-xs">
                {"title" in s.payload && (
                  <input
                    className="border rounded px-2 py-1.5"
                    value={String(s.payload.title || "")}
                    onChange={(e) => updatePayload(s.id, { title: e.target.value })}
                  />
                )}
                {"desc" in s.payload && (
                  <input
                    className="border rounded px-2 py-1.5"
                    value={String(s.payload.desc || "")}
                    onChange={(e) => updatePayload(s.id, { desc: e.target.value })}
                  />
                )}
                {"quote" in s.payload && (
                  <textarea
                    className="border rounded px-2 py-1.5 sm:col-span-2"
                    value={String(s.payload.quote || "")}
                    onChange={(e) => updatePayload(s.id, { quote: e.target.value })}
                  />
                )}
                {"name" in s.payload && (
                  <input
                    className="border rounded px-2 py-1.5"
                    value={String(s.payload.name || "")}
                    onChange={(e) => updatePayload(s.id, { name: e.target.value })}
                  />
                )}
                {"role" in s.payload && (
                  <input
                    className="border rounded px-2 py-1.5"
                    value={String(s.payload.role || "")}
                    onChange={(e) => updatePayload(s.id, { role: e.target.value })}
                  />
                )}
                {"items" in s.payload && Array.isArray(s.payload.items) && (
                  <textarea
                    className="border rounded px-2 py-1.5 sm:col-span-2"
                    value={(s.payload.items as string[]).join("\n")}
                    onChange={(e) => updatePayload(s.id, { items: e.target.value.split("\n").filter(Boolean) })}
                  />
                )}
              </div>
            ))}
        </section>
      ))}
      <button onClick={saveSections} className="px-4 py-2 bg-purple-600 text-white text-xs font-semibold rounded-lg">
        Save landing sections
      </button>
    </div>
  );
};
