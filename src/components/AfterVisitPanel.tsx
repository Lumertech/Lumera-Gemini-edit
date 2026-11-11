import React, { useMemo, useState } from "react";
import { apiFetch } from "../api/http";
import { formatINR } from "../lib/currency";
import { directionLines, type RxLanguage } from "../lib/rxDirections";
import type { Doctor, MedicineItem, Patient } from "../types";

type Props = {
  patient: Patient;
  doctor: Doctor;
  appointmentId?: string;
  medicines: MedicineItem[];
  advice: string[];
  followUpDate?: string;
  clinicName: string;
};

const LANGUAGES: Array<{ id: RxLanguage; label: string }> = [
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "mr", label: "Marathi" },
];

export const AfterVisitPanel: React.FC<Props> = ({
  patient,
  doctor,
  appointmentId,
  medicines,
  advice,
  followUpDate,
  clinicName,
}) => {
  const [language, setLanguage] = useState<RxLanguage>("en");
  const [note, setNote] = useState("");
  const [growth, setGrowth] = useState({ heightCm: "", weightKg: "", headCm: "" });
  const [percentiles, setPercentiles] = useState("");
  const paediatric = patient.age < 18;
  const lines = useMemo(() => directionLines(medicines, language), [medicines, language]);

  async function run(path: string, body: unknown, ok: string) {
    try {
      const data = await apiFetch<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) });
      setNote(ok);
      return data;
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save that.");
      return null;
    }
  }

  return (
    <section
      data-testid="after-visit-panel"
      className="mb-4 w-full max-w-full overflow-x-hidden rounded-xl border border-slate-200 bg-white p-4"
    >
      <h3 className="text-sm font-bold text-slate-900">After the visit</h3>
      <p className="mt-1 text-xs text-slate-500">
        {clinicName}. Directions render in the language you pick. Drug names stay as written. An AI translation is not sent until you approve it.
      </p>
      <label className="mt-3 block text-xs font-semibold text-slate-700" htmlFor="rx-language">
        Patient language
      </label>
      <select
        id="rx-language"
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
        value={language}
        onChange={(event) => setLanguage(event.target.value as RxLanguage)}
      >
        {LANGUAGES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <ul className="mt-2 space-y-1 text-sm text-slate-800">
        {lines.map((line) => (
          <li key={line.drugName + line.directions} className="break-words">
            <span className="font-semibold">{line.drugName || "Medicine"}</span>
            {line.directions ? ` — ${line.directions}` : ""}
          </li>
        ))}
        {!lines.length ? <li className="text-slate-500">Add a medicine to preview directions.</li> : null}
      </ul>
      {advice.length ? <p className="mt-2 text-xs text-slate-600 break-words">Advice stays in English until an approved translation exists.</p> : null}
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          onClick={() =>
            run("/api/certificates", {
              patientId: patient.id,
              appointmentId,
              kind: "medical",
              diagnosis: advice[0] || "",
              doctorName: doctor.name,
            }, "Medical certificate is ready on the patient link.")
          }
        >
          Medical certificate
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          onClick={() =>
            run("/api/certificates", {
              patientId: patient.id,
              appointmentId,
              kind: "fitness",
              purpose: "school or work",
              doctorName: doctor.name,
            }, "Fitness certificate is ready on the patient link.")
          }
        >
          Fitness certificate
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-600">
        Next visit: {followUpDate || "not set"}.
        {paediatric ? " Vaccine due dates follow the IAP schedule for this age." : ""}
      </p>
      {paediatric ? (
        <div className="mt-2 grid grid-cols-1 gap-2">
          <input
            aria-label="Height cm"
            inputMode="decimal"
            placeholder="Height cm"
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={growth.heightCm}
            onChange={(event) => setGrowth({ ...growth, heightCm: event.target.value })}
          />
          <input
            aria-label="Weight kg"
            inputMode="decimal"
            placeholder="Weight kg"
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={growth.weightKg}
            onChange={(event) => setGrowth({ ...growth, weightKg: event.target.value })}
          />
          <input
            aria-label="Head circumference cm"
            inputMode="decimal"
            placeholder="Head circumference cm"
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={growth.headCm}
            onChange={(event) => setGrowth({ ...growth, headCm: event.target.value })}
          />
          <button
            type="button"
            className="rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white"
            onClick={async () => {
              const data = await run(
                `/api/patients/${encodeURIComponent(patient.id)}/growth`,
                {
                  heightCm: Number(growth.heightCm),
                  weightKg: Number(growth.weightKg),
                  headCm: Number(growth.headCm),
                },
                "Growth saved."
              );
              const point = data?.point as { percentiles?: Record<string, number | null>; bmi?: number } | undefined;
              if (point?.percentiles) {
                setPercentiles(
                  `BMI ${point.bmi ?? "–"}. Percentiles height ${point.percentiles.height ?? "–"}, weight ${point.percentiles.weight ?? "–"}, BMI ${point.percentiles.bmi ?? "–"}, head ${point.percentiles.head ?? "–"}.`
                );
              }
            }}
          >
            Save growth
          </button>
          {percentiles ? <p className="text-xs text-slate-700 break-words">{percentiles}</p> : null}
          <p className="text-xs text-slate-500">WHO checkpoints to age 5, then IAP. This is a screening band, not a full LMS z-score.</p>
        </div>
      ) : null}
      <button
        type="button"
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
        onClick={() =>
          run(
            `/api/patients/${encodeURIComponent(patient.id)}/care-reminder`,
            { doctorName: doctor.name },
            "Reminder recorded for WhatsApp."
          )
        }
      >
        Send follow-up reminder
      </button>
      <button
        type="button"
        className="mt-2 w-full rounded-lg bg-indigo-800 px-3 py-2 text-sm font-semibold text-white"
        onClick={() =>
          run(
            "/api/teleconsult",
            {
              patientId: patient.id,
              doctorId: doctor.id,
              date: followUpDate || new Date().toISOString().slice(0, 10),
              timeSlot: "04:00 PM",
            },
            `Video visit booked at ${formatINR(doctor.consultationFee)}. Join from this consult once the visit is open.`
          )
        }
      >
        Book video follow-up
      </button>
      {appointmentId ? (
        <button
          type="button"
          className="mt-2 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-900"
          onClick={async () => {
            if (!navigator.mediaDevices) {
              setNote("This browser cannot open the camera. The patient still joins from the WhatsApp link.");
              return;
            }
            try {
              const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
              stream.getTracks().forEach((track) => pc.addTrack(track, stream));
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await apiFetch(`/api/teleconsult/${encodeURIComponent(appointmentId)}/signal`, {
                method: "POST",
                body: JSON.stringify({ kind: "offer", payload: JSON.stringify(offer) }),
              });
              setNote("Offer sent. The patient joins from their secure link. Production needs your own TURN server.");
            } catch {
              setNote("Camera is unavailable. The join link can still be sent on WhatsApp.");
            }
          }}
        >
          Join video from this consult
        </button>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        Video is in-browser WebRTC with a public STUN server. Production needs HTTPS and a self-hosted TURN server such as coturn. Media is not sent through a paid video vendor.
      </p>
      {note ? <p className="mt-2 text-sm text-slate-800 break-words">{note}</p> : null}
    </section>
  );
};
