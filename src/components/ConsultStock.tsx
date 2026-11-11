import React, { useEffect, useState } from "react";
import { Syringe } from "lucide-react";
import { apiFetch } from "../api/http";
import { formatINR } from "../lib/currency";
import { accountsRole, type StockBatchCard } from "../lib/accountsDesk";
import { useAuth } from "../auth/AuthContext";

type AdminRow = {
  id: string;
  vaccineName: string;
  batchNo: string;
  expiryDate: string;
  dose: string;
  givenAt: string;
  givenByName: string;
};

/**
 * Giving a vaccine in the consult decrements that batch and writes batch plus
 * expiry onto the patient. Consumables used in the consult decrement too.
 */
export const ConsultStock: React.FC<{ patientId: string; appointmentId?: string }> = ({
  patientId,
  appointmentId,
}) => {
  const { user } = useAuth();
  const role = accountsRole(user?.role);
  const [batches, setBatches] = useState<StockBatchCard[]>([]);
  const [history, setHistory] = useState<AdminRow[]>([]);
  const [batchId, setBatchId] = useState("");
  const [dose, setDose] = useState("1");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    void apiFetch<{ batches: StockBatchCard[] }>("/api/accounts/stock")
      .then((data) => setBatches(Array.isArray(data.batches) ? data.batches : []))
      .catch(() => setBatches([]));
    if (!patientId) return;
    void apiFetch<{ administrations: AdminRow[] }>(`/api/accounts/vaccines?patientId=${encodeURIComponent(patientId)}`)
      .then((data) => setHistory(Array.isArray(data.administrations) ? data.administrations : []))
      .catch(() => setHistory([]));
  };

  useEffect(() => {
    load();
  }, [patientId]);

  if (!role.clinical) return null;

  const vaccines = batches.filter((batch) => batch.kind === "vaccine" && batch.qty > 0 && !batch.expired);
  const consumables = batches.filter((batch) => batch.kind !== "vaccine" && batch.qty > 0 && !batch.expired);
  const chosen = vaccines.find((batch) => batch.id === batchId) || vaccines[0];

  const give = async () => {
    if (!chosen) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ administration: AdminRow }>("/api/accounts/vaccines", {
        method: "POST",
        body: JSON.stringify({
          patientId,
          appointmentId: appointmentId || "",
          itemId: chosen.itemId,
          batchId: chosen.id,
          dose,
          qty: 1,
        }),
      });
      setMessage(
        `${res.administration.vaccineName} recorded. Batch ${res.administration.batchNo}, expiry ${res.administration.expiryDate}.`
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the vaccine");
    } finally {
      setBusy(false);
    }
  };

  const useOne = async (batch: StockBatchCard) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/accounts/use", {
        method: "POST",
        body: JSON.stringify({
          patientId,
          appointmentId: appointmentId || "",
          itemId: batch.itemId,
          batchId: batch.id,
          qty: 1,
        }),
      });
      setMessage(`${batch.itemName} used. Stock reduced by 1 ${batch.unit}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use stock");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="no-print rounded-xl border border-slate-200 bg-white p-3 space-y-3 min-w-0 max-w-full overflow-x-hidden"
      data-testid="consult-stock"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Syringe className="w-4 h-4 text-teal-700 shrink-0" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Vaccine and stock used in this consult</h3>
      </div>
      <p className="text-[11px] text-slate-500">
        Giving a vaccine takes one from that batch and saves the batch and expiry on this patient.
      </p>
      {vaccines.length === 0 ? (
        <p className="text-xs text-slate-600">No vaccine stock is available.</p>
      ) : (
        <div className="flex flex-col gap-2 min-w-0">
          <label className="text-[11px] font-semibold text-slate-600">
            Batch
            <select
              className="mt-1 w-full max-w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
              data-testid="vaccine-batch"
              value={chosen?.id || ""}
              onChange={(event) => setBatchId(event.target.value)}
            >
              {vaccines.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.itemName} · {batch.batchNo} · exp {batch.expiryDate} · {batch.qty} left
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Dose
            <input
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
              value={dose}
              onChange={(event) => setDose(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="vaccine-give"
            disabled={busy || !chosen}
            onClick={() => void give()}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold disabled:opacity-50"
          >
            Give vaccine
          </button>
        </div>
      )}
      {consumables.length > 0 && (
        <div className="flex flex-col gap-2">
          {consumables.slice(0, 6).map((batch) => (
            <button
              key={batch.id}
              type="button"
              disabled={busy}
              onClick={() => void useOne(batch)}
              className="text-left w-full rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
            >
              Use 1 {batch.unit} · {batch.itemName} · batch {batch.batchNo} · {batch.qty} left · {formatINR(batch.sellPrice)}
            </button>
          ))}
        </div>
      )}
      {message ? <p className="text-xs text-emerald-800" data-testid="vaccine-recorded">{message}</p> : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {history.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-700" data-testid="vaccine-history">
          {history.map((row) => (
            <li key={row.id} className="break-words">
              {row.vaccineName} · batch {row.batchNo} · exp {row.expiryDate} · dose {row.dose}
              {row.givenByName ? ` · ${row.givenByName}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
