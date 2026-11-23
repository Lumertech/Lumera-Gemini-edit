import React from "react";
import {
  Activity,
  AlertTriangle,
  Calculator,
  PawPrint,
  Scissors,
  ShieldCheck,
  Sparkles,
  Syringe,
  Thermometer,
} from "lucide-react";
import type { VeterinaryAssessment } from "../../types";
import { ImmunizationChartPanel } from "../immunization/ImmunizationChart";

export const VETERINARY_CLINICAL_MODES: NonNullable<VeterinaryAssessment["clinicalMode"]>[] = [
  "Preventive & Vaccination",
  "Tick-Fever & Internal Med",
  "Dermatology, Ear & Dental",
  "Surgery, Spay/Neuter & Bite",
];

export interface CalculatedVetDose {
  drugName: string;
  composition: string;
  dosage: string;
  frequency: "1-0-0" | "1-0-1";
  durationDays: number;
  instructions: string;
}

export interface VeterinaryRxModuleProps {
  patientId?: string;
  canRecord?: boolean;
  assessment?: VeterinaryAssessment;
  patientSpecies?: string;
  patientBreed?: string;
  ownerName?: string;
  onChange?: (next: VeterinaryAssessment) => void;
  onWeightChange?: (weightKg: number | undefined) => void;
  onAddCalculatedDrug?: (dose: CalculatedVetDose) => void;
}

export function defaultVeterinaryAssessment(opts?: {
  species?: string;
  breed?: string;
  ownerName?: string;
  weightKg?: number;
}): VeterinaryAssessment {
  const sp = String(opts?.species || "dog").toLowerCase();
  const speciesLabel = sp === "cat" ? "Cat" : sp === "other" ? "Companion Animal" : "Dog";
  return {
    clinicalMode: "Preventive & Vaccination",
    species: speciesLabel,
    breed: opts?.breed || (speciesLabel === "Cat" ? "Persian" : "Indie"),
    sexNeuterStatus: "Neutered Male",
    bodyWeightKg: opts?.weightKg ?? (speciesLabel === "Cat" ? 4.2 : 18.5),
    bodyConditionScore: 5,
    rectalTempF: 101.4,
    heartRateBpm: speciesLabel === "Cat" ? 150 : 104,
    respRateMin: 24,
    mucousMembrane: "Pink & Moist",
    crtSeconds: "< 2 sec",
    hydrationStatus: "Euhydrated (< 5% skin tent)",
    microchipId: "",
    ownerName: opts?.ownerName || "",
    antiRabiesStatus: "Current — Annual ARV Booster Valid",
    antiRabiesCertNo: "",
    coreVaccineStatus: speciesLabel === "Cat" ? "FVRCP Core Current" : "DHPPiL 7-in-1 Current",
    dewormingProductAndDose: "Praziquantel + Pyrantel + Febantel quarterly",
    ectoparasiteProphylaxis: "Sarolaner / Fluralaner chewable on schedule",
    dietaryRegimen: "Balanced adult maintenance kibble + fresh water ad lib",
    vectorSnap4DxStatus: "Not Tested",
    parvoDistemperRapid: "Not Indicated",
    fluidTherapyPlan: "Oral hydration sufficient",
    toxinExposureCheck: "No chocolate, xylitol, lily, NSAID, or rodenticide exposure",
    pruritusScore0to10: 1,
    lesionDistribution: "Coat glossy, pinnae clean",
    skinScrapingCytology: "Negative",
    otoscopyFindings: "Bilateral ear canals clean, tympanic membranes intact",
    dentalTartarGrade: "Grade 1 (Mild)",
    asaRiskGrade: "ASA I",
    procedurePlanned: "Not Scheduled",
    anesthesiaAnalgesiaProtocol: "",
    eCollarAndSutureDate: "",
    biteQuarantineStatus: "Not Applicable",
  };
}

export const VeterinaryRxModule: React.FC<VeterinaryRxModuleProps> = ({
  patientId,
  canRecord = false,
  assessment,
  patientSpecies,
  patientBreed,
  ownerName,
  onChange,
  onWeightChange,
  onAddCalculatedDrug,
}) => {
  const value: VeterinaryAssessment = assessment || defaultVeterinaryAssessment({
    species: patientSpecies,
    breed: patientBreed,
    ownerName,
  });

  const mode = value.clinicalMode || "Preventive & Vaccination";
  const weightKg = typeof value.bodyWeightKg === "number" && value.bodyWeightKg > 0 ? value.bodyWeightKg : 0;
  const tempF = value.rectalTempF;
  const tempAlert = typeof tempF === "number" && (tempF < 99.5 || tempF > 102.5);
  const plateletAlert = typeof value.plateletCountLakhs === "number" && value.plateletCountLakhs < 1.5;
  const pcvAlert = typeof value.pcvPercent === "number" && value.pcvPercent < 30;

  const update = (patch: Partial<VeterinaryAssessment>) => {
    onChange?.({ ...value, ...patch });
  };

  const doseCards: Array<CalculatedVetDose & { rateLabel: string }> =
    weightKg > 0
      ? [
          {
            drugName: "Doxycycline Vet",
            composition: "Doxycycline Hyclate",
            rateLabel: "10 mg/kg OD",
            dosage: `${Math.round(weightKg * 10)} mg`,
            frequency: "1-0-0",
            durationDays: 28,
            instructions: `Tick-fever protocol (${weightKg} kg × 10 mg/kg); give with food/water bolus to avoid esophagitis.`,
          },
          {
            drugName: "Meloxicam Oral Suspension (Pet)",
            composition: "Meloxicam Veterinary",
            rateLabel: "0.1 mg/kg OD",
            dosage: `${(weightKg * 0.1).toFixed(2)} mg`,
            frequency: "1-0-0",
            durationDays: 4,
            instructions: `Maintenance veterinary NSAID (${weightKg} kg × 0.1 mg/kg); withhold if vomiting or dehydrated.`,
          },
          {
            drugName: "Maropitant Citrate (Cerenia)",
            composition: "Maropitant",
            rateLabel: "1 mg/kg OD",
            dosage: `${(weightKg * 1).toFixed(1)} mg`,
            frequency: "1-0-0",
            durationDays: 4,
            instructions: `NK1 antiemetic (${weightKg} kg × 1 mg/kg once daily).`,
          },
          {
            drugName: "Amoxicillin-Clavulanate Vet (Clavpet)",
            composition: "Amoxicillin + Clavulanic Acid",
            rateLabel: "12.5 mg/kg BD",
            dosage: `${Math.round(weightKg * 12.5)} mg`,
            frequency: "1-0-1",
            durationDays: 7,
            instructions: `Broad-spectrum antimicrobial (${weightKg} kg × 12.5 mg/kg twice daily after meal).`,
          },
        ]
      : [];

  return (
    <div
      data-testid="veterinary-rx-module"
      className="no-print bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden mb-6 min-w-0"
    >
      {/* Header & 4-Mode Selector */}
      <div className="bg-gradient-to-r from-amber-950 via-amber-900 to-stone-900 text-white p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-200 shrink-0">
              <PawPrint className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-200 bg-amber-950/70 px-2 py-0.5 rounded border border-amber-500/30">
                Companion Animal Veterinary Suite
              </span>
              <h3 className="text-base font-bold text-white tracking-tight break-words mt-0.5">
                Species Vitals, mg/kg Dose Engine &amp; Dog and cat immunization chart
              </h3>
            </div>
          </div>
          {tempAlert && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/25 border border-rose-300/40 text-rose-100 text-xs font-bold">
              <AlertTriangle className="w-3.5 h-3.5" />
              Rectal Temp {tempF}°F ({tempF! > 102.5 ? "Pyrexia >102.5°F" : "Hypothermia <99.5°F"})
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
          {VETERINARY_CLINICAL_MODES.map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => update({ clinicalMode: m })}
                className={`px-3 py-2 rounded-lg text-xs font-semibold text-left transition-all border flex items-center gap-1.5 ${
                  active
                    ? "bg-amber-400 text-stone-950 border-amber-300 shadow-sm font-bold"
                    : "bg-white/10 text-amber-100 border-white/15 hover:bg-white/15"
                }`}
              >
                {m === "Preventive & Vaccination" && <Syringe className="w-3.5 h-3.5 shrink-0" />}
                {m === "Tick-Fever & Internal Med" && <Activity className="w-3.5 h-3.5 shrink-0" />}
                {m === "Dermatology, Ear & Dental" && <Sparkles className="w-3.5 h-3.5 shrink-0" />}
                {m === "Surgery, Spay/Neuter & Bite" && <Scissors className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{m}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Core Animal Vitals & Identification Bar */}
      <div className="p-4 bg-amber-50/40 border-b border-amber-100 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs">
          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Species</span>
            <select
              value={value.species || "Dog"}
              onChange={(e) => update({ species: e.target.value })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-medium"
            >
              <option value="Dog">Dog (Canine)</option>
              <option value="Cat">Cat (Feline)</option>
              <option value="Rabbit">Rabbit</option>
              <option value="Avian">Avian / Exotic</option>
              <option value="Companion Animal">Other Companion</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Breed</span>
            <input
              type="text"
              value={value.breed || ""}
              onChange={(e) => update({ breed: e.target.value })}
              placeholder="Golden Retriever / Indie / Persian"
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Sex / Neuter Status</span>
            <select
              value={value.sexNeuterStatus || "Neutered Male"}
              onChange={(e) => update({ sexNeuterStatus: e.target.value as VeterinaryAssessment["sexNeuterStatus"] })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            >
              <option value="Intact Male">Intact Male</option>
              <option value="Neutered Male">Neutered Male</option>
              <option value="Intact Female">Intact Female</option>
              <option value="Spayed Female">Spayed Female</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-amber-800">Body Weight (kg) *</span>
            <input
              type="number"
              step="0.1"
              value={value.bodyWeightKg ?? ""}
              onChange={(e) => {
                const nextW = e.target.value === "" ? undefined : Number(e.target.value);
                update({ bodyWeightKg: nextW });
                onWeightChange?.(nextW);
              }}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-amber-400 bg-white text-slate-900 font-bold"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">BCS (1–9 Scale)</span>
            <select
              value={value.bodyConditionScore ?? 5}
              onChange={(e) => update({ bodyConditionScore: Number(e.target.value) })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>
                  {n}/9 {n <= 3 ? "(Underweight)" : n <= 5 ? "(Ideal)" : n === 6 ? "(Overweight)" : "(Obese)"}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={`text-[10px] font-bold uppercase flex items-center gap-1 ${tempAlert ? "text-rose-700" : "text-slate-500"}`}>
              <Thermometer className="w-3 h-3" /> Rectal Temp (°F)
            </span>
            <input
              type="number"
              step="0.1"
              value={value.rectalTempF ?? ""}
              onChange={(e) => update({ rectalTempF: e.target.value === "" ? undefined : Number(e.target.value) })}
              className={`mt-1 w-full px-2.5 py-1.5 rounded-lg border font-semibold ${
                tempAlert ? "border-rose-400 bg-rose-50 text-rose-900" : "border-slate-300 bg-white text-slate-900"
              }`}
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Heart Rate (bpm)</span>
            <input
              type="number"
              value={value.heartRateBpm ?? ""}
              onChange={(e) => update({ heartRateBpm: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Resp Rate (/min)</span>
            <input
              type="number"
              value={value.respRateMin ?? ""}
              onChange={(e) => update({ respRateMin: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Mucous Membrane</span>
            <select
              value={value.mucousMembrane || "Pink & Moist"}
              onChange={(e) => update({ mucousMembrane: e.target.value as VeterinaryAssessment["mucousMembrane"] })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            >
              <option value="Pink & Moist">Pink &amp; Moist</option>
              <option value="Pale / Anemic">Pale / Anemic</option>
              <option value="Icteric">Icteric</option>
              <option value="Congested / Brick Red">Congested / Brick Red</option>
              <option value="Cyanotic">Cyanotic</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">CRT &amp; Hydration</span>
            <input
              type="text"
              value={value.crtSeconds || ""}
              onChange={(e) => update({ crtSeconds: e.target.value })}
              placeholder="< 2 sec • Euhydrated"
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">ISO Microchip ID</span>
            <input
              type="text"
              value={value.microchipId || ""}
              onChange={(e) => update({ microchipId: e.target.value })}
              placeholder="900118000..."
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Pet Parent / Owner</span>
            <input
              type="text"
              value={value.ownerName || ""}
              onChange={(e) => update({ ownerName: e.target.value })}
              placeholder="Owner full name"
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            />
          </label>
        </div>

        {/* Live mg/kg Weight-Based Dose Calculator */}
        {doseCards.length > 0 && (
          <div
            data-testid="vet-weight-dose-bar"
            className="rounded-lg border border-amber-200 bg-white p-2.5 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-amber-700" />
                Live mg/kg Weight-Based Dose Helper ({weightKg} kg) — Click to add to Rx
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {doseCards.map((d) => (
                <button
                  key={d.drugName}
                  type="button"
                  onClick={() => onAddCalculatedDrug?.(d)}
                  className="px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-medium transition-colors"
                  title={d.instructions}
                >
                  <strong>{d.drugName.split(" ")[0]}</strong> ({d.rateLabel}):{" "}
                  <span className="font-mono font-bold text-amber-900">{d.dosage}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mode-Specific Clinical Panels */}
      <div className="p-4 space-y-4 bg-slate-50/40">
        {mode === "Preventive & Vaccination" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Anti-Rabies (ARV) Status</span>
                <input
                  type="text"
                  value={value.antiRabiesStatus || ""}
                  onChange={(e) => update({ antiRabiesStatus: e.target.value })}
                  placeholder="Annual ARV Booster Administered / Valid"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">ARV Batch / Certificate No.</span>
                <input
                  type="text"
                  value={value.antiRabiesCertNo || ""}
                  onChange={(e) => update({ antiRabiesCertNo: e.target.value })}
                  placeholder="ARV-2026-8841 / Nobivac Rabies"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Core Vaccine (DHPPiL / FVRCP)</span>
                <input
                  type="text"
                  value={value.coreVaccineStatus || ""}
                  onChange={(e) => update({ coreVaccineStatus: e.target.value })}
                  placeholder="DHPPiL 7-in-1 / FVRCP Trivalent"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Deworming Product &amp; Schedule</span>
                <input
                  type="text"
                  value={value.dewormingProductAndDose || ""}
                  onChange={(e) => update({ dewormingProductAndDose: e.target.value })}
                  placeholder="Drontal Plus / Kiwof Cat per kg"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Tick / Flea Prophylaxis</span>
                <input
                  type="text"
                  value={value.ectoparasiteProphylaxis || ""}
                  onChange={(e) => update({ ectoparasiteProphylaxis: e.target.value })}
                  placeholder="Bravecto (Fluralaner) / Simparica / Revolution"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Dietary &amp; Nutrition Regimen</span>
                <input
                  type="text"
                  value={value.dietaryRegimen || ""}
                  onChange={(e) => update({ dietaryRegimen: e.target.value })}
                  placeholder="Starter puppy / Renal support / Adult kibble"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              {patientId ? (
                <ImmunizationChartPanel patientId={patientId} audience="veterinary" canRecord={canRecord} />
              ) : (
                <p className="text-sm text-slate-600">Open a patient to compute the chart from the date of birth.</p>
              )}
            </div>
          </div>
        )}

        {mode === "Tick-Fever & Internal Med" && (
          <div className="space-y-3 text-xs">
            {(plateletAlert || pcvAlert) && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900 flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  Hematology Alert:
                  {plateletAlert ? ` Thrombocytopenia (${value.plateletCountLakhs} lakhs/µL < 1.5)` : ""}
                  {pcvAlert ? ` • Anemia (PCV ${value.pcvPercent}% < 30%)` : ""} — monitor mucosal bleeding &amp; tick-borne hemoprotozoa.
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">SNAP 4Dx / Hemoprotozoa Screen</span>
                <select
                  value={value.vectorSnap4DxStatus || "Not Tested"}
                  onChange={(e) => update({ vectorSnap4DxStatus: e.target.value as VeterinaryAssessment["vectorSnap4DxStatus"] })}
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="Not Tested">Not Tested</option>
                  <option value="Negative">Negative (4Dx Clear)</option>
                  <option value="Ehrlichia +">Ehrlichia canis Positive (+)</option>
                  <option value="Babesia +">Babesia gibsoni / canis Positive (+)</option>
                  <option value="Anaplasma +">Anaplasma platys Positive (+)</option>
                  <option value="Mixed Hemoprotozoa +">Mixed Hemoprotozoa Positive (+)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Parvo / Distemper Rapid Ag</span>
                <input
                  type="text"
                  value={value.parvoDistemperRapid || ""}
                  onChange={(e) => update({ parvoDistemperRapid: e.target.value })}
                  placeholder="CPV Ag Negative / Positive"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
              <label className="block">
                <span className={`text-[10px] font-bold uppercase ${plateletAlert ? "text-rose-700" : "text-slate-500"}`}>
                  Platelet Count (Lakhs/µL)
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={value.plateletCountLakhs ?? ""}
                  onChange={(e) =>
                    update({ plateletCountLakhs: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                  className={`mt-1 w-full px-2.5 py-1.5 rounded-lg border font-bold ${
                    plateletAlert ? "border-rose-400 bg-rose-50 text-rose-900" : "border-slate-300 bg-white"
                  }`}
                />
              </label>
              <label className="block">
                <span className={`text-[10px] font-bold uppercase ${pcvAlert ? "text-rose-700" : "text-slate-500"}`}>
                  Packed Cell Volume — PCV (%)
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={value.pcvPercent ?? ""}
                  onChange={(e) => update({ pcvPercent: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className={`mt-1 w-full px-2.5 py-1.5 rounded-lg border font-bold ${
                    pcvAlert ? "border-rose-400 bg-rose-50 text-rose-900" : "border-slate-300 bg-white"
                  }`}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">IV / SC Fluid Therapy Plan</span>
                <input
                  type="text"
                  value={value.fluidTherapyPlan || ""}
                  onChange={(e) => update({ fluidTherapyPlan: e.target.value })}
                  placeholder="Ringer Lactate @ 50 mL/kg/24h IV daycare"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-slate-500">Toxin / Foreign Body Check</span>
                <input
                  type="text"
                  value={value.toxinExposureCheck || ""}
                  onChange={(e) => update({ toxinExposureCheck: e.target.value })}
                  placeholder="No paracetamol / lily / chocolate ingestion"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                />
              </label>
            </div>
          </div>
        )}

        {mode === "Dermatology, Ear & Dental" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-slate-500">Pruritus Visual Score (0–10)</span>
              <input
                type="number"
                min={0}
                max={10}
                value={value.pruritusScore0to10 ?? 0}
                onChange={(e) => update({ pruritusScore0to10: Number(e.target.value) })}
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-slate-500">Coat &amp; Lesion Distribution</span>
              <input
                type="text"
                value={value.lesionDistribution || ""}
                onChange={(e) => update({ lesionDistribution: e.target.value })}
                placeholder="Interdigital paws, ventral abdomen, pinnae"
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-slate-500">Skin Scraping / Tape Cytology</span>
              <input
                type="text"
                value={value.skinScrapingCytology || ""}
                onChange={(e) => update({ skinScrapingCytology: e.target.value })}
                placeholder="Malassezia ++ / Demodex / Sarcoptes / Negative"
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[10px] font-bold uppercase text-slate-500">Video Otoscopy Findings</span>
              <input
                type="text"
                value={value.otoscopyFindings || ""}
                onChange={(e) => update({ otoscopyFindings: e.target.value })}
                placeholder="Erythematous vertical canal, waxy brown exudate, TM intact"
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-slate-500">Dental Tartar &amp; Gingivitis Grade</span>
              <select
                value={value.dentalTartarGrade || "Grade 1 (Mild)"}
                onChange={(e) => update({ dentalTartarGrade: e.target.value as VeterinaryAssessment["dentalTartarGrade"] })}
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              >
                <option value="Grade 0 (Clean)">Grade 0 (Clean)</option>
                <option value="Grade 1 (Mild)">Grade 1 (Mild)</option>
                <option value="Grade 2 (Moderate)">Grade 2 (Moderate)</option>
                <option value="Grade 3-4 (Severe Periodontal)">Grade 3-4 (Severe Periodontal)</option>
              </select>
            </label>
          </div>
        )}

        {mode === "Surgery, Spay/Neuter & Bite" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-slate-500">ASA Anesthetic Risk Grade</span>
              <select
                value={value.asaRiskGrade || "ASA I"}
                onChange={(e) => update({ asaRiskGrade: e.target.value as VeterinaryAssessment["asaRiskGrade"] })}
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              >
                <option value="ASA I">ASA I — Normal Healthy</option>
                <option value="ASA II">ASA II — Mild Systemic</option>
                <option value="ASA III">ASA III — Severe Systemic</option>
                <option value="ASA IV-E">ASA IV-E — Emergency</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[10px] font-bold uppercase text-slate-500">Procedure Planned / Performed</span>
              <input
                type="text"
                value={value.procedurePlanned || ""}
                onChange={(e) => update({ procedurePlanned: e.target.value })}
                placeholder="Ovariohysterectomy (Spay) / Orchiectomy (Castration) / Wound Suturing"
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[10px] font-bold uppercase text-slate-500">Anesthesia &amp; Analgesia Protocol</span>
              <input
                type="text"
                value={value.anesthesiaAnalgesiaProtocol || ""}
                onChange={(e) => update({ anesthesiaAnalgesiaProtocol: e.target.value })}
                placeholder="Butorphanol pre-med + Propofol induction + Isoflurane maintenance + Meloxicam"
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-slate-500">E-Collar &amp; Suture Removal Date</span>
              <input
                type="text"
                value={value.eCollarAndSutureDate || ""}
                onChange={(e) => update({ eCollarAndSutureDate: e.target.value })}
                placeholder="E-collar 10 days • Sutures out Day 10"
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block sm:col-span-3">
              <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                Statutory 10-Day Animal Bite Observation Status
              </span>
              <select
                value={value.biteQuarantineStatus || "Not Applicable"}
                onChange={(e) =>
                  update({ biteQuarantineStatus: e.target.value as VeterinaryAssessment["biteQuarantineStatus"] })
                }
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              >
                <option value="Not Applicable">Not Applicable</option>
                <option value="Day 0 Bite Reported — 10d Observation">Day 0 Bite Reported — 10d Observation</option>
                <option value="Day 5 Healthy">Day 5 Mid-Observation — Animal Healthy &amp; Eating</option>
                <option value="Day 10 Cleared">Day 10 Observation Complete — Clinically Normal &amp; Cleared</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
