import React, { useEffect, useState } from 'react';
import { Baby, Calculator, Syringe, Ruler, AlertTriangle } from 'lucide-react';
import { PediatricAssessment } from '../../types';
import { ImmunizationChartPanel } from '../immunization/ImmunizationChart';

interface PediatricsRxModuleProps {
  assessment: PediatricAssessment;
  patientAge: number;
  patientWeight?: number;
  patientId?: string;
  canRecord?: boolean;
  onUpdateAssessment: (assessment: PediatricAssessment) => void;
  onWeightChange?: (weightKg: number) => void;
}

const IMNCI_DANGER_SIGNS = [
  'No General Danger Signs',
  'Unable to Drink / Breastfeed',
  'Vomits Everything',
  'Lethargic / Unconscious',
  'Lower Chest Wall Indrawing',
  'Convulsions in This Illness',
];

export const PediatricsRxModule: React.FC<PediatricsRxModuleProps> = ({
  assessment,
  patientAge,
  patientWeight,
  patientId,
  canRecord = false,
  onUpdateAssessment,
  onWeightChange,
}) => {
  const initialWeight =
    assessment.childWeightKg ||
    patientWeight ||
    (patientAge <= 1 ? 8.5 : patientAge <= 5 ? 14 : patientAge <= 12 ? 26 : 45);
  const [weightKg, setWeightKg] = useState<number>(initialWeight);
  const [selectedDrug, setSelectedDrug] = useState<
    'Paracetamol' | 'Amoxicillin-Clav' | 'Ibuprofen' | 'Cetirizine' | 'ORS + Zinc (IAP)' | 'Ondansetron'
  >('Paracetamol');

  useEffect(() => {
    if (typeof patientWeight === 'number' && patientWeight > 0 && patientWeight !== weightKg) {
      setWeightKg(patientWeight);
    }
  }, [patientWeight]);

  const handleWeightUpdate = (val: number) => {
    setWeightKg(val);
    onUpdateAssessment({ ...assessment, childWeightKg: val });
    onWeightChange?.(val);
  };

  const computeDosage = () => {
    switch (selectedDrug) {
      case 'Paracetamol':
        return `${(weightKg * 15).toFixed(0)} mg per dose (15 mg/kg) every 6 hours SOS. Syrup 120mg/5ml = ${(
          (weightKg * 15) /
          24
        ).toFixed(1)} ml or Syrup 250mg/5ml = ${((weightKg * 15) / 50).toFixed(1)} ml`;
      case 'Amoxicillin-Clav':
        return `${(weightKg * 45).toFixed(0)} mg/day (45 mg/kg/day) divided into 2 doses = ${(
          weightKg * 22.5
        ).toFixed(0)} mg twice daily after food`;
      case 'Ibuprofen':
        return `${(weightKg * 10).toFixed(0)} mg per dose (10 mg/kg) every 8 hours after milk/food`;
      case 'Cetirizine':
        return `${weightKg < 15 ? '2.5 mg (2.5 ml)' : '5 mg (5 ml)'} once daily at bedtime`;
      case 'ORS + Zinc (IAP)':
        return `WHO Low-Osmolarity ORS ${(weightKg * 10).toFixed(0)} ml after each loose stool + Elemental Zinc ${
          patientAge < 1 && weightKg < 7 ? '10 mg' : '20 mg'
        } OD x 14 days (IAP Acute Diarrhea Protocol)`;
      case 'Ondansetron':
        return `${(weightKg * 0.15).toFixed(1)} mg per dose (0.15 mg/kg; Syrup 2mg/5ml = ${(
          (weightKg * 0.15 * 5) /
          2
        ).toFixed(1)} ml) 30 mins before oral feeds SOS`;
      default:
        return '';
    }
  };

  const muac = assessment.muacCm;
  const muacStatus =
    typeof muac === 'number' && muac > 0
      ? muac < 11.5
        ? { label: 'SAM (<11.5 cm) — Urgent Nutrition Rehab', cls: 'bg-rose-100 text-rose-800 border-rose-300' }
        : muac < 12.5
          ? { label: 'MAM (11.5–12.5 cm) — Energy-Dense Diet', cls: 'bg-amber-100 text-amber-800 border-amber-300' }
          : { label: 'Normal MUAC (>=12.5 cm)', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
      : null;

  const toggleDangerSign = (sign: string) => {
    const cur = assessment.imnciDangerSigns || [];
    const next = cur.includes(sign) ? cur.filter((s) => s !== sign) : [...cur, sign];
    onUpdateAssessment({ ...assessment, imnciDangerSigns: next });
  };

  return (
    <div
      data-testid="pediatrics-rx-module"
      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6"
    >
      <div className="bg-gradient-to-r from-emerald-900 via-teal-950 to-slate-900 text-white p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
            <Baby className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                Pediatrics &amp; Child Health (IAP / GoI UIP / RBSK)
              </span>
              <span className="text-xs text-slate-300">Perinatal History, Anthropometry, MUAC &amp; Weight-Based Dosing</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Pediatric Immunization Schedule, Perinatal &amp; Feeding History, and mg/kg Dosing
            </h3>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-slate-50/50">
        {patientId && (
          <ImmunizationChartPanel patientId={patientId} audience="pediatric" canRecord={canRecord} />
        )}

        {/* Perinatal, Birth, IYCF Feeding & Anthropometry Strip */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Ruler className="w-4 h-4 text-emerald-600" />
              Perinatal / Birth History, IYCF Feeding &amp; Growth Anthropometry
            </span>
            {muacStatus && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${muacStatus.cls}`}>
                {muacStatus.label}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Informant</label>
              <select
                value={assessment.informant || 'Mother'}
                onChange={(e) => onUpdateAssessment({ ...assessment, informant: e.target.value as any })}
                className="w-full mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              >
                <option value="Mother">Mother (Reliable)</option>
                <option value="Father">Father (Reliable)</option>
                <option value="Both Parents">Both Parents</option>
                <option value="Grandparent / Caregiver">Grandparent / Caregiver</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Delivery / Gestation</label>
              <select
                value={assessment.birthMode || 'Term NVD'}
                onChange={(e) => onUpdateAssessment({ ...assessment, birthMode: e.target.value as any })}
                className="w-full mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              >
                <option value="Term NVD">Term NVD</option>
                <option value="Term LSCS">Term LSCS</option>
                <option value="Preterm (<37w) NVD">Preterm (&lt;37w) NVD</option>
                <option value="Preterm (<37w) LSCS">Preterm (&lt;37w) LSCS</option>
                <option value="Instrumental">Instrumental</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Birth Wt (kg)</label>
              <input
                type="number"
                step="0.1"
                placeholder="e.g. 2.9"
                value={assessment.birthWeightKg ?? ''}
                onChange={(e) =>
                  onUpdateAssessment({
                    ...assessment,
                    birthWeightKg: e.target.value === '' ? undefined : parseFloat(e.target.value),
                  })
                }
                className="w-full mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Height / Length (cm)</label>
              <input
                type="number"
                step="0.5"
                placeholder="cm"
                value={assessment.childHeightCm ?? ''}
                onChange={(e) =>
                  onUpdateAssessment({
                    ...assessment,
                    childHeightCm: e.target.value === '' ? undefined : parseFloat(e.target.value),
                  })
                }
                className="w-full mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Head Circ (cm)</label>
              <input
                type="number"
                step="0.5"
                placeholder="OFC cm"
                value={assessment.headCircumferenceCm ?? ''}
                onChange={(e) =>
                  onUpdateAssessment({
                    ...assessment,
                    headCircumferenceCm: e.target.value === '' ? undefined : parseFloat(e.target.value),
                  })
                }
                className="w-full mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">MUAC (cm, 6–59m)</label>
              <input
                type="number"
                step="0.1"
                placeholder="> 12.5 cm"
                value={assessment.muacCm ?? ''}
                onChange={(e) =>
                  onUpdateAssessment({
                    ...assessment,
                    muacCm: e.target.value === '' ? undefined : parseFloat(e.target.value),
                  })
                }
                className="w-full mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">IYCF Feeding &amp; Nutrition</label>
              <select
                value={assessment.feedingPattern || 'Family Pot Balanced Diet'}
                onChange={(e) => onUpdateAssessment({ ...assessment, feedingPattern: e.target.value as any })}
                className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-semibold"
              >
                <option value="Exclusive Breastfeeding (0-6m)">Exclusive Breastfeeding (0–6m)</option>
                <option value="Breastfeeding + Complementary (IYCF)">Breastfeeding + Complementary Home Diet</option>
                <option value="Formula / Mixed Feeding">Formula / Mixed Feeding</option>
                <option value="Family Pot Balanced Diet">Family Pot Balanced Diet</option>
                <option value="Picky / Inadequate Intake">Picky / Inadequate Calorie-Protein Intake</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block">
                Neonatal Cry / NICU / Jaundice Notes
              </label>
              <input
                type="text"
                value={assessment.neonatalHistory || ''}
                onChange={(e) => onUpdateAssessment({ ...assessment, neonatalHistory: e.target.value })}
                placeholder="e.g. Immediate cry at birth, no NICU admission, physiological jaundice resolved"
                className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1 mb-1">
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              IMNCI Triage &amp; Danger Signs Screen
            </label>
            <div className="flex flex-wrap gap-1.5">
              {IMNCI_DANGER_SIGNS.map((sign) => {
                const selected = (assessment.imnciDangerSigns || []).includes(sign);
                const isSafe = sign === 'No General Danger Signs';
                return (
                  <button
                    key={sign}
                    type="button"
                    onClick={() => toggleDangerSign(sign)}
                    className={`px-2 py-0.5 rounded text-[11px] border transition-all ${
                      selected
                        ? isSafe
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold'
                          : 'bg-rose-100 text-rose-900 border-rose-300 font-bold'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {selected ? (isSafe ? '✓ ' : '⚠️ ') : ''}
                    {sign}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Weight-Based Dosage Calculator Box */}
        <div className="bg-emerald-50/80 p-4 rounded-xl border border-emerald-200 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-emerald-700" />
              Real-Time Pediatric Dosage Auto-Calculator (mg/kg basis)
            </label>
            <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
              Age: {patientAge} Yrs
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-600 uppercase">Child Weight (kg)</label>
              <input
                type="number"
                step="0.5"
                value={weightKg}
                onChange={(e) => handleWeightUpdate(parseFloat(e.target.value) || 1)}
                className="w-full px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 uppercase">Drug / Protocol to Compute</label>
              <select
                value={selectedDrug}
                onChange={(e) => setSelectedDrug(e.target.value as any)}
                className="w-full px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-semibold text-slate-900"
              >
                <option value="Paracetamol">Paracetamol Syrup (15 mg/kg)</option>
                <option value="Amoxicillin-Clav">Amox-Clav Syrup (45 mg/kg/day)</option>
                <option value="ORS + Zinc (IAP)">ORS + Zinc 14d (IAP Diarrhea)</option>
                <option value="Ondansetron">Ondansetron Syrup (0.15 mg/kg)</option>
                <option value="Ibuprofen">Ibuprofen Syrup (10 mg/kg)</option>
                <option value="Cetirizine">Cetirizine Syrup (Allergy)</option>
              </select>
            </div>
            <div className="sm:col-span-1 flex items-end">
              <button
                type="button"
                onClick={() =>
                  onUpdateAssessment({
                    ...assessment,
                    childWeightKg: weightKg,
                    calculatedDosageBasis: `${selectedDrug}: ${computeDosage()}`,
                  })
                }
                className="w-full py-1.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition-colors"
              >
                + Inject into Rx
              </button>
            </div>
          </div>

          <div className="mt-2.5 p-2 bg-white/90 rounded-lg border border-emerald-200 text-xs text-emerald-950 font-medium flex items-center gap-2">
            <span className="font-bold text-emerald-800">Computed Output:</span>
            <span>{computeDosage()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Developmental Milestones (RBSK 4D Screen)
            </label>
            <select
              value={assessment.developmentalMilestones}
              onChange={(e) => onUpdateAssessment({ ...assessment, developmentalMilestones: e.target.value as any })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
            >
              <option value="Age Appropriate">Age Appropriate / Normal Development</option>
              <option value="Mild Delay">Mild Delay (Language / Motor)</option>
              <option value="Needs Evaluation">Needs Detailed Developmental Evaluation</option>
            </select>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Syringe className="w-3.5 h-3.5 text-emerald-600" />
              Note on the prescription
            </label>
            <input
              type="text"
              value={(assessment.immunizationsDue || []).join(', ')}
              onChange={(e) =>
                onUpdateAssessment({
                  ...assessment,
                  immunizationsDue: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Optional note, for example influenza discussed"
              aria-label="Note on the prescription"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
