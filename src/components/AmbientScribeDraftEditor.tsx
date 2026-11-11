import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { SoapNote } from "../types";
import {
  applyScribeDraftEdit,
  emptyScribeMedicine,
  scribeDraftEditFromSoap,
  type ScribeDraftEdit,
} from "../lib/scribeAcceptance";

const fieldClass =
  "mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-400 focus:outline-none";

export function AmbientScribeDraftEditor({
  soap,
  onChange,
  onAccept,
}: {
  soap: SoapNote;
  onChange: (next: SoapNote) => void;
  onAccept: (next: SoapNote) => void;
}) {
  const baseRef = useRef(soap);
  const [edit, setEdit] = useState<ScribeDraftEdit>(() => scribeDraftEditFromSoap(soap));

  useEffect(() => {
    baseRef.current = soap;
    setEdit(scribeDraftEditFromSoap(soap));
  }, [soap.id]);

  const commit = (next: ScribeDraftEdit) => {
    setEdit(next);
    onChange(applyScribeDraftEdit(baseRef.current, next));
  };

  return (
    <section
      data-testid="ambient-scribe-draft"
      className="min-w-0 space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-3"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold text-violet-950">Draft SOAP note and prescription</p>
        <p className="mt-1 text-[11px] leading-snug text-violet-900">
          Edit this draft in place. Nothing is saved to the chart or the prescription until you accept.
        </p>
      </div>

      <label className="block min-w-0 text-[11px] font-semibold text-slate-700">
        Chief complaints
        <textarea
          data-testid="ambient-draft-complaints"
          value={edit.chiefComplaints}
          rows={3}
          onChange={(event) => commit({ ...edit, chiefComplaints: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="block min-w-0 text-[11px] font-semibold text-slate-700">
        History of present illness
        <textarea
          data-testid="ambient-draft-hpi"
          value={edit.historyOfPresentIllness}
          rows={3}
          onChange={(event) => commit({ ...edit, historyOfPresentIllness: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="block min-w-0 text-[11px] font-semibold text-slate-700">
        Examination
        <textarea
          data-testid="ambient-draft-exam"
          value={edit.physicalExamination}
          rows={3}
          onChange={(event) => commit({ ...edit, physicalExamination: event.target.value })}
          className={fieldClass}
        />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block min-w-0 text-[11px] font-semibold text-slate-700">
          Diagnosis
          <input
            data-testid="ambient-draft-diagnosis"
            value={edit.primaryDiagnosis}
            onChange={(event) => commit({ ...edit, primaryDiagnosis: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="block min-w-0 text-[11px] font-semibold text-slate-700">
          ICD-10
          <input
            data-testid="ambient-draft-icd"
            value={edit.icd10Code}
            onChange={(event) => commit({ ...edit, icd10Code: event.target.value })}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="min-w-0 space-y-2">
        <p className="text-[11px] font-semibold text-slate-700">Draft prescription</p>
        {edit.medicines.map((row, index) => (
          <div key={`med-${index}`} className="grid min-w-0 grid-cols-1 gap-2 rounded-lg border border-violet-100 bg-white p-2 sm:grid-cols-2">
            <label className="block min-w-0 text-[10px] font-semibold text-slate-600">
              Medicine
              <input
                data-testid={`ambient-draft-med-${index}`}
                value={row.drugName}
                onChange={(event) => {
                  const medicines = edit.medicines.slice();
                  medicines[index] = { ...row, drugName: event.target.value };
                  commit({ ...edit, medicines });
                }}
                className={fieldClass}
              />
            </label>
            <label className="block min-w-0 text-[10px] font-semibold text-slate-600">
              Dose
              <input
                value={row.dosage}
                onChange={(event) => {
                  const medicines = edit.medicines.slice();
                  medicines[index] = { ...row, dosage: event.target.value };
                  commit({ ...edit, medicines });
                }}
                className={fieldClass}
              />
            </label>
            <label className="block min-w-0 text-[10px] font-semibold text-slate-600">
              Frequency
              <input
                value={row.frequency}
                onChange={(event) => {
                  const medicines = edit.medicines.slice();
                  medicines[index] = { ...row, frequency: event.target.value };
                  commit({ ...edit, medicines });
                }}
                className={fieldClass}
              />
            </label>
            <label className="block min-w-0 text-[10px] font-semibold text-slate-600">
              Days
              <input
                inputMode="numeric"
                value={row.durationDays}
                onChange={(event) => {
                  const medicines = edit.medicines.slice();
                  medicines[index] = { ...row, durationDays: event.target.value };
                  commit({ ...edit, medicines });
                }}
                className={fieldClass}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          onClick={() => commit({ ...edit, medicines: [...edit.medicines, emptyScribeMedicine()] })}
          className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-900"
        >
          Add medicine line
        </button>
      </div>

      <button
        type="button"
        data-testid="ambient-scribe-accept"
        onClick={() => onAccept(applyScribeDraftEdit(baseRef.current, edit))}
        className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-bold text-white"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Accept into this consult
      </button>
    </section>
  );
}
