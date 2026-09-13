import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch } from "../../api/http";

type PractitionerWaba = {
  practitionerId: string;
  name: string;
  phone: string;
  status: string;
  affiliations: Array<{ tenantId: string; tenantName: string }>;
  whatsappNumber: {
    id: string;
    wabaId: string;
    phoneNumberId: string;
    metaWabaName: string;
    status: string;
    connectedVia: string;
    metaTokenExpiresAt: string;
  } | null;
};

export const AdminPractitionerWabas: React.FC = () => {
  const [rows, setRows] = useState<PractitionerWaba[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({
    wabaId: "",
    phoneNumberId: "",
    metaWabaName: "",
    metaAccessToken: "",
  });

  const load = async () => {
    try {
      const data = await apiFetch<{ practitionerNumbers?: PractitionerWaba[] }>("/api/admin/whatsapp-numbers");
      setRows(data.practitionerNumbers || []);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = rows.find((row) => row.practitionerId === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Doctor-owned WhatsApp numbers</h2>
          <p className="text-sm text-slate-500">
            Optional personal WABA per practitioner. A doctor who works at multiple clinics shares one number across affiliations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectedId(rows[0]?.practitionerId || "");
            setForm({
              wabaId: rows[0]?.whatsappNumber?.wabaId || "",
              phoneNumberId: rows[0]?.whatsappNumber?.phoneNumberId || "",
              metaWabaName: rows[0]?.whatsappNumber?.metaWabaName || "",
              metaAccessToken: "",
            });
            setShowModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition"
        >
          <Plus className="w-4 h-4" /> Add / edit doctor WABA
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
            <tr>
              <th className="px-5 py-3.5">Practitioner</th>
              <th className="px-5 py-3.5">Affiliated clinics</th>
              <th className="px-5 py-3.5">WABA ID & Name</th>
              <th className="px-5 py-3.5">Phone Number ID</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-sm text-slate-500" colSpan={6}>
                  No practitioner identities yet. Inviting a doctor by phone creates one.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.practitionerId} className="hover:bg-slate-50/80 transition">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-slate-900">{row.name || "Unnamed practitioner"}</div>
                    <div className="text-xs text-slate-500">{row.phone}</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">{row.practitionerId}</div>
                  </td>
                  <td className="px-5 py-4">
                    {row.affiliations.length ? (
                      <ul className="text-xs text-slate-700 space-y-0.5">
                        {row.affiliations.map((aff) => (
                          <li key={aff.tenantId}>{aff.tenantName}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-slate-400">No clinic affiliation</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-800">{row.whatsappNumber?.metaWabaName || "—"}</div>
                    <div className="text-xs font-mono text-slate-500">{row.whatsappNumber?.wabaId || "Not connected"}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-mono text-xs text-slate-700">{row.whatsappNumber?.phoneNumberId || "—"}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="capitalize px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                      {row.whatsappNumber?.status || row.status || "none"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(row.practitionerId);
                        setForm({
                          wabaId: row.whatsappNumber?.wabaId || "",
                          phoneNumberId: row.whatsappNumber?.phoneNumberId || "",
                          metaWabaName: row.whatsappNumber?.metaWabaName || "",
                          metaAccessToken: "",
                        });
                        setShowModal(true);
                      }}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 transition"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Doctor WhatsApp Business Account</h3>
            <p className="text-xs text-slate-500">Master Admin can add or edit any practitioner-owned number. Tokens are stored in the local secrets table, not on the WABA row.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Practitioner</label>
                <select
                  value={selectedId}
                  onChange={(e) => {
                    const next = rows.find((row) => row.practitionerId === e.target.value);
                    setSelectedId(e.target.value);
                    setForm({
                      wabaId: next?.whatsappNumber?.wabaId || "",
                      phoneNumberId: next?.whatsappNumber?.phoneNumberId || "",
                      metaWabaName: next?.whatsappNumber?.metaWabaName || "",
                      metaAccessToken: "",
                    });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                >
                  {rows.map((row) => (
                    <option key={row.practitionerId} value={row.practitionerId}>
                      {row.name || row.phone} ({row.practitionerId})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WABA ID</label>
                <input
                  type="text"
                  value={form.wabaId}
                  onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={form.phoneNumberId}
                  onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WABA display name</label>
                <input
                  type="text"
                  value={form.metaWabaName}
                  onChange={(e) => setForm({ ...form, metaWabaName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Access token (stored in secrets table)</label>
                <input
                  type="password"
                  value={form.metaAccessToken}
                  onChange={(e) => setForm({ ...form, metaAccessToken: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedId) return;
                  const method = selected?.whatsappNumber?.id ? "PATCH" : "POST";
                  const path = selected?.whatsappNumber?.id
                    ? `/api/admin/whatsapp-numbers/${selected.whatsappNumber.id}`
                    : "/api/admin/whatsapp-numbers";
                  await apiFetch(path, {
                    method,
                    body: JSON.stringify({
                      ownerType: "doctor",
                      ownerId: selectedId,
                      wabaId: form.wabaId,
                      phoneNumberId: form.phoneNumberId,
                      metaWabaName: form.metaWabaName,
                      metaAccessToken: form.metaAccessToken,
                    }),
                  });
                  setShowModal(false);
                  await load();
                }}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm"
              >
                Save doctor WABA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
