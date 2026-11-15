import React, { useEffect, useMemo, useState } from "react";
import { Printer, Syringe } from "lucide-react";
import { apiFetch } from "../../api/http";
import type { StockBatchCard } from "../../lib/accountsDesk";
import { buildImmunizationPrintHtml, type ImmunizationPrintLetterhead } from "../../lib/immunizationPrint";
import {
  IMMUNIZATION_SAFETY_NOTICE,
  parseTemplateDueAge,
  type ChartDose,
  type DoseStatus,
} from "../../lib/immunizationSchedules";

type Audience = "auto" | "pediatric" | "veterinary";

interface ChartPayload {
  patientId: string;
  patientName: string;
  uhid?: string;
  dateOfBirth: string;
  species: string;
  breed: string;
  ownerName: string;
  safetyNotice: string;
  applicable: boolean;
  needsDateOfBirth: boolean;
  needsSpecies: boolean;
  message: string;
  schedule: { id: string; version: string; title: string; citation: string } | null;
  doses: ChartDose[];
  letterhead: ImmunizationPrintLetterhead;
  settings: {
    pediatricScheduleId: "pediatric_iap" | "pediatric_uip";
    endemicJe: boolean;
    includeOptional: boolean;
    edits?: Array<{ scheduleId: string; code: string; dueAgeDays?: number }>;
  };
  reminder: { enabled: false; sent: false; reason: string };
}

const STATUS_LABEL: Record<DoseStatus, string> = {
  given: "Given",
  due: "Due",
  overdue: "Overdue",
  upcoming: "Upcoming",
  skipped: "Skipped",
  contraindicated: "Contraindicated",
  not_indicated: "Not indicated",
};

const STATUS_CLASS: Record<DoseStatus, string> = {
  given: "bg-emerald-100 text-emerald-900 border-emerald-300",
  due: "bg-amber-100 text-amber-950 border-amber-300",
  overdue: "bg-rose-100 text-rose-950 border-rose-300",
  upcoming: "bg-sky-100 text-sky-950 border-sky-300",
  skipped: "bg-slate-100 text-slate-800 border-slate-300",
  contraindicated: "bg-slate-100 text-slate-800 border-slate-300",
  not_indicated: "bg-slate-50 text-slate-600 border-slate-200",
};

const FILTERS: Array<{ id: "all" | DoseStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "due", label: "Due" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "given", label: "Given" },
  { id: "skipped", label: "Skipped" },
  { id: "contraindicated", label: "Contraindicated" },
];

export const ImmunizationChartPanel: React.FC<{
  patientId: string;
  audience: Audience;
  canRecord: boolean;
}> = ({ patientId, audience, canRecord }) => {
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [activeKey, setActiveKey] = useState("");
  const [givenOn, setGivenOn] = useState("");
  const [brand, setBrand] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [givenByName, setGivenByName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [stockBatchId, setStockBatchId] = useState("");
  const [batches, setBatches] = useState<StockBatchCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [dob, setDob] = useState("");
  const [species, setSpecies] = useState("Dog");
  const [breed, setBreed] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [pediatricScheduleId, setPediatricScheduleId] = useState<"pediatric_iap" | "pediatric_uip">("pediatric_iap");
  const [endemicJe, setEndemicJe] = useState(false);
  const [includeOptional, setIncludeOptional] = useState(true);
  const [editCode, setEditCode] = useState("");
  const [editDueAge, setEditDueAge] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    void apiFetch<{ chart: ChartPayload }>(
      `/api/patients/${encodeURIComponent(patientId)}/immunization-chart?audience=${audience}`
    )
      .then((data) => {
        setChart(data.chart);
        setDob(data.chart.dateOfBirth || "");
        setBreed(data.chart.breed || "");
        setOwnerName(data.chart.ownerName || "");
        if (data.chart.species === "cat") setSpecies("Cat");
        else if (data.chart.species === "dog") setSpecies("Dog");
        else if (data.chart.species === "other") setSpecies("Other");
        setPediatricScheduleId(data.chart.settings?.pediatricScheduleId || "pediatric_iap");
        setEndemicJe(Boolean(data.chart.settings?.endemicJe));
        setIncludeOptional(data.chart.settings?.includeOptional !== false);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load the chart"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [patientId, audience]);

  useEffect(() => {
    if (!canRecord) return;
    void apiFetch<{ batches: StockBatchCard[] }>("/api/accounts/stock")
      .then((data) => setBatches(Array.isArray(data.batches) ? data.batches : []))
      .catch(() => setBatches([]));
  }, [canRecord, patientId]);

  const vaccines = batches.filter((batch) => batch.kind === "vaccine" && batch.qty > 0 && !batch.expired);
  const visible = useMemo(() => {
    const doses = chart?.doses || [];
    if (filter === "all") return doses;
    return doses.filter((dose) => dose.status === filter);
  }, [chart, filter]);
  const active = (chart?.doses || []).find((dose) => dose.occurrenceKey === activeKey) || null;

  function selectDose(dose: ChartDose) {
    setActiveKey(dose.occurrenceKey);
    setGivenOn(dose.givenOn || new Date().toISOString().slice(0, 10));
    setBrand(dose.brand || "");
    setBatchNo(dose.batchNo || "");
    setGivenByName(dose.givenByName || "");
    setReason(dose.reason || "");
    setConfirmed(false);
    setStockBatchId("");
    setError("");
  }

  async function saveIdentity() {
    setBusy(true);
    setError("");
    try {
      const body =
        audience === "veterinary"
          ? { dateOfBirth: dob, species, breed, ownerName }
          : { dateOfBirth: dob };
      await apiFetch(`/api/patients/${encodeURIComponent(patientId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the patient details");
    } finally {
      setBusy(false);
    }
  }

  async function record(status: "given" | "skipped" | "contraindicated") {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const alreadyLinked = Boolean(active.stockAdministrationId);
      const chosen = alreadyLinked ? undefined : vaccines.find((batch) => batch.id === stockBatchId);
      await apiFetch(`/api/patients/${encodeURIComponent(patientId)}/immunization-doses`, {
        method: "POST",
        body: JSON.stringify({
          occurrenceKey: active.occurrenceKey,
          status,
          givenOn: status === "given" ? givenOn : "",
          brand,
          batchNo,
          givenByName,
          reason,
          doctorConfirmed: confirmed,
          audience,
          scheduleId: chart?.schedule?.id || "",
          ...(alreadyLinked ? { stockAdministrationId: active.stockAdministrationId } : {}),
          ...(chosen ? { stockItemId: chosen.itemId, stockBatchId: chosen.id } : {}),
        }),
      });
      setActiveKey("");
      setConfirmed(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the dose");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    setBusy(true);
    setError("");
    try {
      const scheduleId = audience === "veterinary" ? chart?.schedule?.id || "canine" : pediatricScheduleId;
      const edits = [...(chart?.settings?.edits || [])];
      if (editCode.trim()) {
        const parsedAge = parseTemplateDueAge(editDueAge);
        if (parsedAge.ok === false) {
          setError(parsedAge.error);
          setBusy(false);
          return;
        }
        const next = { scheduleId, code: editCode.trim(), dueAgeDays: parsedAge.days };
        const index = edits.findIndex((edit) => edit.scheduleId === next.scheduleId && edit.code === next.code);
        if (index >= 0) edits[index] = { ...edits[index], ...next };
        else edits.push(next);
      }
      await apiFetch("/api/immunization/settings", {
        method: "PUT",
        body: JSON.stringify({ pediatricScheduleId, endemicJe, includeOptional, edits }),
      });
      setEditCode("");
      setEditDueAge("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the schedule template");
    } finally {
      setBusy(false);
    }
  }

  function printChart() {
    if (!chart) return;
    const html = buildImmunizationPrintHtml(chart.letterhead, {
      patientName: chart.patientName,
      uhid: chart.uhid,
      dateOfBirth: chart.dateOfBirth,
      species: chart.species,
      breed: chart.breed,
      ownerName: chart.ownerName,
      scheduleTitle: chart.schedule?.title || "Immunization chart",
      scheduleVersion: chart.schedule?.version || "",
      citation: chart.schedule?.citation || "",
      doses: chart.doses,
    });
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      setError("Allow pop-ups to print the chart on clinic letterhead.");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <section
      data-testid="immunization-chart"
      className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0 max-w-full overflow-x-hidden"
    >
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Syringe className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-900">Immunization chart</h2>
        </div>
        <p className="text-xs text-slate-600 break-words">{chart?.safetyNotice || IMMUNIZATION_SAFETY_NOTICE}</p>
        {chart?.schedule && (
          <p className="text-xs text-slate-700 break-words">
            <span className="font-semibold">{chart.schedule.title}</span>
            <span className="text-slate-500"> · {chart.schedule.version}</span>
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">Loading the chart…</p>}
      {error && (
        <p className="text-sm text-rose-800 break-words" role="alert">
          {error}
        </p>
      )}

      {chart?.needsDateOfBirth && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-dob">
            Date of birth
          </label>
          <input
            id="imm-dob"
            type="date"
            value={dob}
            onChange={(event) => setDob(event.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={() => void saveIdentity()}
            disabled={busy}
            className="self-start px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-60"
          >
            Save date of birth
          </button>
        </div>
      )}

      {audience === "veterinary" && (
        <div className="grid grid-cols-1 gap-2">
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-species">
            Species
          </label>
          <select
            id="imm-species"
            value={species}
            onChange={(event) => setSpecies(event.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          >
            <option value="Dog">Dog</option>
            <option value="Cat">Cat</option>
            <option value="Other">Other</option>
          </select>
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-breed">
            Breed
          </label>
          <input
            id="imm-breed"
            value={breed}
            onChange={(event) => setBreed(event.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-owner">
            Owner (guardian contact)
          </label>
          <input
            id="imm-owner"
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          {!chart?.needsDateOfBirth && (
            <>
              <label className="text-xs font-semibold text-slate-700" htmlFor="imm-dob-vet">
                Date of birth
              </label>
              <input
                id="imm-dob-vet"
                type="date"
                value={dob}
                onChange={(event) => setDob(event.target.value)}
                className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </>
          )}
          <button
            type="button"
            onClick={() => void saveIdentity()}
            disabled={busy}
            className="self-start px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-60"
          >
            Save animal details
          </button>
        </div>
      )}

      {chart && !chart.applicable && chart.message && <p className="text-sm text-slate-700 break-words">{chart.message}</p>}

      {chart?.applicable && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Dose status">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    filter === item.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={printChart}
              className="inline-flex items-center gap-1.5 self-start px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              Print chart
            </button>
          </div>

          <ul className="flex flex-col gap-2 min-w-0">
            {visible.length === 0 && <li className="text-sm text-slate-600">No doses in this filter.</li>}
            {visible.map((dose) => (
              <li key={dose.occurrenceKey} className="rounded-lg border border-slate-200 p-3 min-w-0" data-testid={`dose-${dose.occurrenceKey}`}>
                <div className="flex flex-col gap-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 break-words">
                    {dose.antigen}
                    <span className="font-normal text-slate-600"> · {dose.doseLabel}</span>
                  </p>
                  <p className="text-xs text-slate-600">Due {dose.dueOn}</p>
                  <span className={`self-start text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${STATUS_CLASS[dose.status]}`}>
                    {STATUS_LABEL[dose.status]}
                    {dose.catchUp ? " · Catch-up" : ""}
                  </span>
                  {dose.status === "given" && (
                    <p className="text-xs text-slate-700 break-words">
                      Given {dose.givenOn}
                      {dose.brand ? ` · ${dose.brand}` : ""}
                      {dose.batchNo ? ` · batch ${dose.batchNo}` : ""}
                      {dose.givenByName ? ` · ${dose.givenByName}` : ""}
                    </p>
                  )}
                  {dose.reason && <p className="text-xs text-slate-700 break-words">Reason: {dose.reason}</p>}
                  {dose.catchUpNote && <p className="text-xs text-rose-900 break-words">{dose.catchUpNote}</p>}
                  {dose.notes && <p className="text-xs text-slate-500 break-words">{dose.notes}</p>}
                  {canRecord && dose.status !== "not_indicated" && (
                    <button
                      type="button"
                      onClick={() => selectDose(dose)}
                      className="self-start mt-1 text-xs font-semibold text-blue-800"
                    >
                      {dose.recordId ? "Edit dose" : "Record dose"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {canRecord && active && (
        <form
          className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void record("given");
          }}
        >
          <p className="text-sm font-semibold text-slate-900 break-words">
            {active.antigen} · {active.doseLabel}
          </p>
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-given-on">
            Date given
          </label>
          <input
            id="imm-given-on"
            type="date"
            value={givenOn}
            onChange={(event) => setGivenOn(event.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-brand">
            Brand
          </label>
          <input
            id="imm-brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-batch">
            Batch
          </label>
          <input
            id="imm-batch"
            value={batchNo}
            onChange={(event) => setBatchNo(event.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-given-by">
            Given by
          </label>
          <input
            id="imm-given-by"
            value={givenByName}
            onChange={(event) => setGivenByName(event.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-stock">
            Link a stock vial (optional)
          </label>
          {active.stockAdministrationId ? (
            <p id="imm-stock" className="text-xs text-slate-700 break-words">
              Already linked to a stock vial. This edit keeps that link and does not take another vial.
            </p>
          ) : (
            <select
              id="imm-stock"
              value={stockBatchId}
              onChange={(event) => setStockBatchId(event.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="">Do not decrement stock</option>
              {vaccines.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.itemName} · {batch.batchNo} · {batch.qty} left
                </option>
              ))}
            </select>
          )}
          <label className="text-xs font-semibold text-slate-700" htmlFor="imm-reason">
            Reason (required to skip or mark contraindicated)
          </label>
          <textarea
            id="imm-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <label className="flex items-start gap-2 text-xs text-slate-800">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
            <span>I confirm this dose. The schedule did not give it automatically.</span>
          </label>
          <div className="flex flex-col gap-2">
            <button type="submit" disabled={busy} className="px-3 py-2 rounded-lg bg-emerald-800 text-white text-xs font-semibold disabled:opacity-60">
              Record as given
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void record("skipped")}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 disabled:opacity-60"
            >
              Mark skipped
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void record("contraindicated")}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 disabled:opacity-60"
            >
              Mark contraindicated
            </button>
          </div>
        </form>
      )}

      {canRecord && (
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="text-sm font-semibold text-slate-900 cursor-pointer">Review schedule template</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-slate-600 break-words">
              The doctor in charge can switch the published pediatric schedule and adjust one due age. The cited source stays in the catalog.
            </p>
            {audience !== "veterinary" && (
              <>
                <label className="text-xs font-semibold text-slate-700" htmlFor="imm-schedule">
                  Pediatric schedule
                </label>
                <select
                  id="imm-schedule"
                  value={pediatricScheduleId}
                  onChange={(event) => setPediatricScheduleId(event.target.value as "pediatric_iap" | "pediatric_uip")}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="pediatric_iap">IAP 2023 recommended</option>
                  <option value="pediatric_uip">India UIP / NIS (government)</option>
                </select>
              </>
            )}
            <label className="flex items-start gap-2 text-xs text-slate-800">
              <input type="checkbox" checked={endemicJe} onChange={(event) => setEndemicJe(event.target.checked)} className="mt-0.5" />
              <span>Clinic is in a Japanese Encephalitis endemic district</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-800">
              <input
                type="checkbox"
                checked={includeOptional}
                onChange={(event) => setIncludeOptional(event.target.checked)}
                className="mt-0.5"
              />
              <span>Show optional rows (product-specific doses and deworming)</span>
            </label>
            <label className="text-xs font-semibold text-slate-700" htmlFor="imm-edit-code">
              Dose code to edit
            </label>
            <input
              id="imm-edit-code"
              value={editCode}
              onChange={(event) => setEditCode(event.target.value)}
              placeholder="e.g. bcg or rabies-annual"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <label className="text-xs font-semibold text-slate-700" htmlFor="imm-edit-age">
              Due age (days from birth)
            </label>
            <input
              id="imm-edit-age"
              inputMode="numeric"
              value={editDueAge}
              onChange={(event) => setEditDueAge(event.target.value)}
              className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => void saveTemplate()}
              disabled={busy}
              className="self-start px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-60"
            >
              Save template
            </button>
            {chart?.schedule?.citation && <p className="text-[11px] text-slate-500 break-words">{chart.schedule.citation}</p>}
            {chart?.reminder && !chart.reminder.enabled && (
              <p className="text-[11px] text-slate-500 break-words">WhatsApp due-dose reminders are off. {chart.reminder.reason}</p>
            )}
          </div>
        </details>
      )}
    </section>
  );
};
