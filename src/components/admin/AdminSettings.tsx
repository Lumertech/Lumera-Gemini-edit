import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";

export const AdminSettings: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ settings: Record<string, string>; geminiConfigured: boolean }>("/api/cms/settings")
      .then((d) => {
        setSettings(d.settings || {});
        setGeminiConfigured(!!d.geminiConfigured);
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    await apiFetch("/api/cms/settings", { method: "PUT", body: JSON.stringify({ settings }) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-extrabold">Clinic & AI settings</h1>
      <div className="bg-white border rounded-xl p-4 space-y-3 text-sm">
        <p className="text-xs text-slate-500">
          Gemini key status: {geminiConfigured ? "configured in .env" : "missing — local fallbacks will be used"}. Keys are never stored in SQLite.
        </p>
        <label className="block text-xs font-semibold">
          Clinic name
          <input className="mt-1 w-full border rounded px-3 py-2" value={settings.clinic_name || ""} onChange={(e) => setSettings({ ...settings, clinic_name: e.target.value })} />
        </label>
        <label className="block text-xs font-semibold">
          Clinic address
          <input className="mt-1 w-full border rounded px-3 py-2" value={settings.clinic_address || ""} onChange={(e) => setSettings({ ...settings, clinic_address: e.target.value })} />
        </label>
        <label className="block text-xs font-semibold">
          Clinical model
          <select className="mt-1 w-full border rounded px-3 py-2" value={settings.gemini_model || ""} onChange={(e) => setSettings({ ...settings, gemini_model: e.target.value })}>
            <option value="models/gemini-3.7-flash">gemini-3.7-flash</option>
            <option value="models/gemini-3.7-pro">gemini-3.7-pro</option>
          </select>
        </label>
        <label className="block text-xs font-semibold">
          Ambient sensitivity
          <select className="mt-1 w-full border rounded px-3 py-2" value={settings.ambient_sensitivity || ""} onChange={(e) => setSettings({ ...settings, ambient_sensitivity: e.target.value })}>
            <option>High (Medical Grade 16kHz)</option>
            <option>Standard Noise Filtered</option>
            <option>Maximum Beamforming for High-Noise Polyclinics</option>
          </select>
        </label>
        <label className="flex items-center justify-between border rounded-lg px-3 py-2 text-xs">
          Auto-generate SOAP
          <input type="checkbox" checked={settings.auto_soap === "true"} onChange={(e) => setSettings({ ...settings, auto_soap: String(e.target.checked) })} />
        </label>
        <label className="flex items-center justify-between border rounded-lg px-3 py-2 text-xs">
          ABDM / ABHA gateway
          <input type="checkbox" checked={settings.abdm_enabled === "true"} onChange={(e) => setSettings({ ...settings, abdm_enabled: String(e.target.checked) })} />
        </label>
        <button onClick={save} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg">
          Save configuration
        </button>
        {saved && <span className="text-xs text-emerald-600 ml-2">Saved</span>}
      </div>
    </div>
  );
};
