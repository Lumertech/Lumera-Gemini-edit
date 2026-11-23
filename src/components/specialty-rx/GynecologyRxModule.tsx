import React from 'react';
import {
  Heart,
  Calendar,
  Baby,
  Activity,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Stethoscope,
  Ribbon,
} from 'lucide-react';
import { GynecologyAssessment } from '../../types';
import { clinicCalendarDate } from '../../lib/clinicDay';

interface GynecologyRxModuleProps {
  assessment: GynecologyAssessment;
  onChange: (updated: GynecologyAssessment) => void;
}

const CLINICAL_MODES: NonNullable<GynecologyAssessment['clinicalMode']>[] = [
  'Antenatal / Obstetric',
  'Gynaecology & Menstrual',
  'Fertility & PCOS',
  'Postnatal / Menopause',
];

const HIGH_RISK_FLAGS = [
  'Anemia in Pregnancy (Hb < 11 g/dL)',
  'Gestational Diabetes (DIPSI >= 140)',
  'PIH / Pre-eclampsia',
  'Hypothyroidism in Pregnancy',
  'Rh Negative Mother',
  'Previous LSCS',
  'Bad Obstetric History (BOH)',
  'Low Lying Placenta / Previa',
  'Twin / Multiple Gestation',
  'IUGR / Oligohydramnios',
];

const PCOS_PHENOTYPE_FLAGS = [
  'Oligo / Anovulation (>35d cycles)',
  'Clinical Hirsutism (mFG >= 8)',
  'Inflammatory Acne / Seborrhea',
  'Acanthosis Nigricans (Insulin Resistance)',
  'PCOM on Pelvic USG',
  'Central Truncal Obesity (BMI >= 23 Asian)',
];

export const GynecologyRxModule: React.FC<GynecologyRxModuleProps> = ({
  assessment,
  onChange,
}) => {
  const activeMode = assessment.clinicalMode || 'Antenatal / Obstetric';
  const gp = assessment.gravidaPara || { g: 1, p: 0, l: 0, a: 0 };

  // Naegele's rule calculation: LMP + 280 days, gestational age vs current IST clinic date
  const handleLmpChange = (newLmp: string) => {
    if (!newLmp) {
      onChange({ ...assessment, lmpDate: newLmp });
      return;
    }
    const lmp = new Date(`${newLmp}T00:00:00Z`);
    if (isNaN(lmp.getTime())) {
      onChange({ ...assessment, lmpDate: newLmp });
      return;
    }
    const edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000);
    const eddStr = edd.toISOString().split('T')[0];

    const todayIso = clinicCalendarDate();
    const today = new Date(`${todayIso}T00:00:00Z`);
    const diffDays = Math.max(0, Math.floor((today.getTime() - lmp.getTime()) / (24 * 60 * 60 * 1000)));
    const weeks = Math.min(44, Math.floor(diffDays / 7));
    const days = diffDays % 7;

    let trimester: GynecologyAssessment['trimester'] = '1st Trimester';
    if (weeks >= 28) trimester = '3rd Trimester';
    else if (weeks >= 14) trimester = '2nd Trimester';

    onChange({
      ...assessment,
      lmpDate: newLmp,
      calculatedEdd: eddStr,
      gestationalAgeWeeks: weeks,
      gestationalAgeDays: days,
      trimester,
    });
  };

  const updateGpla = (key: 'g' | 'p' | 'l' | 'a', raw: string) => {
    const val = Math.max(0, Math.min(15, parseInt(raw, 10) || 0));
    onChange({
      ...assessment,
      gravidaPara: {
        ...gp,
        [key]: val,
      },
    });
  };

  const toggleChecklist = (index: number) => {
    const list = assessment.antenatalChecklist || [];
    const updated = list.map((item, i) =>
      i === index ? { ...item, completed: !item.completed } : item
    );
    onChange({ ...assessment, antenatalChecklist: updated });
  };

  const toggleChip = (
    field: 'highRiskFactors' | 'pcosPhenotypeFlags',
    flag: string
  ) => {
    const current = assessment[field] || [];
    const updated = current.includes(flag)
      ? current.filter((f) => f !== flag)
      : [...current, flag];
    onChange({ ...assessment, [field]: updated });
  };

  const hbValue = assessment.maternalHemoglobinGdl;
  const isAnemic = typeof hbValue === 'number' && hbValue > 0 && hbValue < 11;
  const dipsiValue = assessment.dipsiOgtt2HrMgDl;
  const isDipsiGdm = typeof dipsiValue === 'number' && dipsiValue >= 140;

  return (
    <div
      data-testid="gynecology-rx-module"
      className="space-y-4 bg-gradient-to-br from-pink-50/60 via-white to-rose-50/40 p-4 sm:p-5 rounded-xl border border-pink-200/80 shadow-xs mb-6"
    >
      {/* Header & Obstetric Formula */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-pink-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-pink-600 text-white shadow-xs shrink-0">
            <Baby className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 flex flex-wrap items-center gap-2">
              <span>Obstetrics &amp; Gynaecology Clinical Desk (FOGSI / MoHFW MCP)</span>
              {activeMode === 'Antenatal / Obstetric' ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-100 text-pink-800 border border-pink-300">
                  {assessment.trimester} ({assessment.gestationalAgeWeeks}w {assessment.gestationalAgeDays}d)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
                  {activeMode}
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500">
              ANC MCP flowsheet, editable G/P/L/A/E obstetric formula, menstrual &amp; PCOS evaluation, cervical/breast screening, and PCPNDT compliance
            </p>
          </div>
        </div>

        {/* Editable G / P / L / A / E Steppers */}
        <div className="flex flex-wrap items-center gap-1.5 bg-white border border-pink-200 rounded-lg px-2.5 py-1.5 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-600 mr-1">Obstetric Formula:</span>
          {([
            ['g', 'G'],
            ['p', 'P'],
            ['l', 'L'],
            ['a', 'A'],
          ] as const).map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-0.5 text-xs font-mono font-bold text-pink-700">
              <span>{label}</span>
              <input
                type="number"
                min={0}
                max={15}
                aria-label={`Obstetric ${label}`}
                value={gp[key] ?? 0}
                onChange={(e) => updateGpla(key, e.target.value)}
                className="w-10 text-center text-xs font-bold text-pink-900 bg-pink-50/70 border border-pink-200 rounded px-1 py-0.5 focus:outline-none focus:border-pink-500"
              />
            </label>
          ))}
          <label className="inline-flex items-center gap-0.5 text-xs font-mono font-bold text-rose-700">
            <span>E</span>
            <input
              type="number"
              min={0}
              max={10}
              aria-label="Obstetric Ectopic"
              value={assessment.ectopicCount ?? 0}
              onChange={(e) =>
                onChange({ ...assessment, ectopicCount: Math.max(0, parseInt(e.target.value, 10) || 0) })
              }
              className="w-10 text-center text-xs font-bold text-rose-900 bg-rose-50/70 border border-rose-200 rounded px-1 py-0.5 focus:outline-none focus:border-rose-500"
            />
          </label>
        </div>
      </div>

      {/* Mode Switcher Tabs + Past Delivery Mode */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Gynaecology clinical workflow mode">
          {CLINICAL_MODES.map((mode) => {
            const active = activeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange({ ...assessment, clinicalMode: mode })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  active
                    ? 'bg-pink-600 text-white border-pink-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-pink-300 hover:bg-pink-50/50'
                }`}
              >
                {mode}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">Prev Delivery:</label>
          <select
            value={assessment.previousDeliveryMode || 'Nulliparous'}
            onChange={(e) => onChange({ ...assessment, previousDeliveryMode: e.target.value as any })}
            className="text-xs font-semibold text-slate-800 px-2 py-1 bg-white border border-pink-200 rounded-md focus:outline-none focus:border-pink-500"
          >
            <option value="Nulliparous">Nulliparous / Primigravida</option>
            <option value="NVD (Normal Vaginal)">NVD (Normal Vaginal)</option>
            <option value="Previous 1 LSCS">Previous 1 LSCS</option>
            <option value="Previous >=2 LSCS">Previous &gt;=2 LSCS</option>
            <option value="Instrumental (Vacuum/Forceps)">Instrumental (Vacuum / Forceps)</option>
          </select>
        </div>
      </div>

      {/* MODE 1: ANTENATAL / OBSTETRIC FLOWSHEET */}
      {activeMode === 'Antenatal / Obstetric' && (
        <div className="space-y-4">
          {/* LMP, EDD, USG EDD, FHR, Fundal Height */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
              <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-pink-600" />
                LMP Date:
              </label>
              <input
                type="date"
                value={assessment.lmpDate || ''}
                onChange={(e) => handleLmpChange(e.target.value)}
                className="w-full text-xs font-bold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
              <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-pink-600" />
                EDD (Naegele):
              </label>
              <input
                type="date"
                value={assessment.calculatedEdd || ''}
                onChange={(e) => onChange({ ...assessment, calculatedEdd: e.target.value })}
                className="w-full text-xs font-bold text-pink-700 p-1.5 mt-1 bg-pink-50/60 border border-pink-200 rounded-md focus:outline-none"
              />
            </div>

            <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
              <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-purple-600" />
                Corrected USG EDD:
              </label>
              <input
                type="date"
                value={assessment.correctedUsgEdd || ''}
                onChange={(e) => onChange({ ...assessment, correctedUsgEdd: e.target.value })}
                className="w-full text-xs font-semibold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
              <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 text-rose-500" />
                Fetal Heart Rate:
              </label>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  value={assessment.fetalHeartRateBpm ?? 144}
                  onChange={(e) => onChange({ ...assessment, fetalHeartRateBpm: Number(e.target.value) })}
                  className="w-20 text-xs font-bold text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
                />
                <span className="text-[11px] text-slate-500">bpm (110–160)</span>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-pink-200/70 p-3 shadow-xs">
              <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-pink-600" />
                Fundal Height:
              </label>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  value={assessment.fundalHeightCm ?? 24}
                  onChange={(e) => onChange({ ...assessment, fundalHeightCm: Number(e.target.value) })}
                  className="w-20 text-xs font-bold text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-pink-500"
                />
                <span className="text-[11px] text-slate-500">cm (~GA wks)</span>
              </div>
            </div>
          </div>

          {/* India ANC Lab & Maternal Risk Strip (Anemia Mukt Bharat + DIPSI GDM + Rh + TSH + Td/IFA) */}
          <div className="bg-white rounded-lg border border-pink-200/80 p-3.5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Stethoscope className="w-3.5 h-3.5 text-pink-600" />
                India ANC Maternal Screening (MoHFW MCP / DIPSI OGTT / Anemia Mukt Bharat)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {isAnemic && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                    Maternal Anemia (Hb &lt; 11 g/dL) — Escalate Therapeutic Iron
                  </span>
                )}
                {isDipsiGdm && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    DIPSI 2h &gt;= 140 mg/dL — GDM Protocol (MNT / Metformin / Insulin)
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Maternal Hb (g/dL)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 11.4"
                  value={assessment.maternalHemoglobinGdl ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...assessment,
                      maternalHemoglobinGdl: e.target.value === '' ? undefined : parseFloat(e.target.value),
                    })
                  }
                  className={`w-full mt-1 p-1.5 rounded border text-xs font-bold ${
                    isAnemic ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Blood Group &amp; Rh</label>
                <input
                  type="text"
                  placeholder="e.g. B+ / O- (Anti-D)"
                  value={assessment.maternalBloodGroupRh || ''}
                  onChange={(e) => onChange({ ...assessment, maternalBloodGroupRh: e.target.value })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">DIPSI 75g 2h (mg/dL)</label>
                <input
                  type="number"
                  placeholder="Normal < 140"
                  value={assessment.dipsiOgtt2HrMgDl ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...assessment,
                      dipsiOgtt2HrMgDl: e.target.value === '' ? undefined : parseFloat(e.target.value),
                    })
                  }
                  className={`w-full mt-1 p-1.5 rounded border text-xs font-bold ${
                    isDipsiGdm ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">TSH (mIU/L)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="Target < 2.5–3.0"
                  value={assessment.tshMiuL ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...assessment,
                      tshMiuL: e.target.value === '' ? undefined : parseFloat(e.target.value),
                    })
                  }
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Urine Alb / Sugar</label>
                <input
                  type="text"
                  placeholder="Nil / Nil"
                  value={assessment.urineAlbuminSugar || ''}
                  onChange={(e) => onChange({ ...assessment, urineAlbuminSugar: e.target.value })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Td / Tdap Vaccine</label>
                <select
                  value={assessment.tdVaccineStatus || 'Td-1 Given'}
                  onChange={(e) => onChange({ ...assessment, tdVaccineStatus: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="Td-1 Given">Td-1 Given</option>
                  <option value="Td-2 / Booster Complete">Td-2 / Booster Complete</option>
                  <option value="Tdap Given (27-36w)">Tdap Given (27–36w)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Fetal Biometry, Placental Site, Cervical Length & NST / BPP Strip */}
          <div className="bg-white rounded-lg border border-pink-200/70 p-3.5 shadow-xs space-y-2.5">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              Fetal Biometry, Placental Localization, Cervical Length &amp; NST / BPP Surveillance
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Est. Fetal Weight (g)</label>
                <input
                  type="number"
                  placeholder="e.g. 950 / 2450"
                  value={assessment.estimatedFetalWeightGrams ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...assessment,
                      estimatedFetalWeightGrams: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Cervical Length (mm)</label>
                <input
                  type="number"
                  placeholder="Normal >= 25 mm"
                  value={assessment.cervicalLengthMm ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...assessment,
                      cervicalLengthMm: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                    })
                  }
                  className={`w-full mt-1 p-1.5 rounded border text-xs font-bold ${
                    typeof assessment.cervicalLengthMm === 'number' && assessment.cervicalLengthMm > 0 && assessment.cervicalLengthMm < 25
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Placental Site</label>
                <select
                  value={assessment.placentalLocalization || 'Fundal / Anterior'}
                  onChange={(e) => onChange({ ...assessment, placentalLocalization: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                >
                  <option value="Fundal / Anterior">Fundal / Anterior (Upper)</option>
                  <option value="Fundal / Posterior">Fundal / Posterior (Upper)</option>
                  <option value="Low Lying (Grade I/II)">Low Lying (Grade I / II ⚠️)</option>
                  <option value="Placenta Previa (Major)">Placenta Previa (Major 🚨)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">NST / BPP Surveillance</label>
                <select
                  value={assessment.nstBppStatus || 'Not Done'}
                  onChange={(e) => onChange({ ...assessment, nstBppStatus: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                >
                  <option value="Not Done">Not Indicated (&lt;32w)</option>
                  <option value="Reactive NST">Reactive NST (Reassuring)</option>
                  <option value="BPP 8/8 Reassuring">Biophysical Profile 8/8</option>
                  <option value="Non-Reactive — Repeat/BPP">Non-Reactive ⚠️ Escalate</option>
                </select>
              </div>
            </div>
          </div>

          {/* Physical Findings & Antenatal Protocol Milestones */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-3 shadow-xs">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <ShieldCheck className="w-3.5 h-3.5 text-pink-600" />
                Obstetric Exam, Edema, Liquor &amp; PMSMA High-Risk Flags
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-slate-500">Presentation:</label>
                  <select
                    value={assessment.presentation || 'Cephalic / Vertex'}
                    onChange={(e) => onChange({ ...assessment, presentation: e.target.value as any })}
                    className="w-full text-xs font-semibold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md"
                  >
                    <option value="Cephalic / Vertex">Cephalic / Vertex</option>
                    <option value="Breech">Breech</option>
                    <option value="Transverse">Transverse</option>
                    <option value="Unstable">Unstable Lie</option>
                    <option value="Not Applicable (Early / Non-ANC)">Early (&lt;24w)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-500">Liquor / AFI:</label>
                  <select
                    value={assessment.liquorAdequacy || 'Adequate'}
                    onChange={(e) => onChange({ ...assessment, liquorAdequacy: e.target.value as any })}
                    className="w-full text-xs font-semibold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md"
                  >
                    <option value="Adequate">Adequate</option>
                    <option value="Borderline (AFI 5-8)">Borderline (AFI 5–8)</option>
                    <option value="Oligohydramnios (AFI <5)">Oligohydramnios (&lt;5)</option>
                    <option value="Polyhydramnios">Polyhydramnios</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-500">Pedal Edema:</label>
                  <select
                    value={assessment.pedalEdema || 'Absent'}
                    onChange={(e) => onChange({ ...assessment, pedalEdema: e.target.value as any })}
                    className="w-full text-xs font-semibold text-slate-800 p-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-md"
                  >
                    <option value="Absent">Absent</option>
                    <option value="Mild (+)">Mild (+)</option>
                    <option value="Moderate (++)">Moderate (++)</option>
                    <option value="Generalized / Facial">Generalized / Facial</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-500">Fetal Movements:</label>
                  <button
                    type="button"
                    onClick={() => onChange({ ...assessment, quickeningPresent: !assessment.quickeningPresent })}
                    className={`w-full text-xs font-bold p-1.5 mt-1 rounded-md border flex items-center justify-center gap-1 transition-all ${
                      assessment.quickeningPresent !== false
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-rose-50 text-rose-700 border-rose-300'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{assessment.quickeningPresent !== false ? 'Active' : 'Reduced'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-500">PMSMA High-Risk Obstetric Flags:</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {HIGH_RISK_FLAGS.map((flag) => {
                    const isSelected = assessment.highRiskFactors?.includes(flag);
                    return (
                      <button
                        key={flag}
                        type="button"
                        onClick={() => toggleChip('highRiskFactors', flag)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-all ${
                          isSelected
                            ? 'bg-rose-100 text-rose-800 border-rose-300 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {isSelected ? '⚠️ ' : ''}
                        {flag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Antenatal Milestone Checklist + IFA & PCPNDT Attestation */}
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Standard Antenatal Protocol Milestones
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {(assessment.antenatalChecklist || []).filter((i) => i.completed).length} /{' '}
                  {(assessment.antenatalChecklist || []).length} Completed
                </span>
              </div>

              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {(assessment.antenatalChecklist || []).map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => toggleChecklist(idx)}
                    className={`flex items-center justify-between p-2 rounded-md border text-xs cursor-pointer transition-all ${
                      item.completed
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => {}}
                        className="rounded text-pink-600 focus:ring-pink-500 h-3.5 w-3.5 cursor-pointer"
                      />
                      <span className={`font-medium ${item.completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                        {item.item}
                      </span>
                    </div>
                    {item.dueDate && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        Due: {item.dueDate}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(assessment.ifaCalciumStarted)}
                    onChange={(e) => onChange({ ...assessment, ifaCalciumStarted: e.target.checked })}
                    className="rounded text-emerald-600 h-3.5 w-3.5"
                  />
                  <span className="font-medium">
                    IFA (60mg Elemental Iron + 500mcg Folate) &amp; Calcium + Vit D3 started (180d ANC protocol)
                  </span>
                </label>

                <label className="flex items-start gap-2 text-[11px] bg-amber-50/80 border border-amber-200 rounded-md p-2 text-amber-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(assessment.pcpndtFormFLogged)}
                    onChange={(e) => onChange({ ...assessment, pcpndtFormFLogged: e.target.checked })}
                    className="rounded text-amber-700 h-3.5 w-3.5 mt-0.5"
                  />
                  <span>
                    <strong>PCPNDT Act Statutory Declaration:</strong> Foetal sex determination neither requested nor
                    disclosed; Form F requisition &amp; ID proof recorded where obstetric USG is ordered.
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2, 3, 4: GYNAECOLOGY, MENSTRUAL, PCOS, FERTILITY & PREVENTIVE SCREENING */}
      {activeMode !== 'Antenatal / Obstetric' && (
        <div className="space-y-4">
          {/* Menstrual & Bleeding Profile */}
          <div className="bg-white rounded-lg border border-pink-200/80 p-3.5 space-y-3 shadow-xs">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Calendar className="w-3.5 h-3.5 text-pink-600" />
              Menstrual, Bleeding &amp; Contraceptive History (PALM-COEIN / NHM Basket)
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">LMP Date</label>
                <input
                  type="date"
                  value={assessment.lmpDate || ''}
                  onChange={(e) => onChange({ ...assessment, lmpDate: e.target.value })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Menarche (Yrs)</label>
                <input
                  type="number"
                  min={8}
                  max={20}
                  placeholder="13"
                  value={assessment.menarcheAge ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...assessment,
                      menarcheAge: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Cycle Pattern</label>
                <select
                  value={assessment.cycleRegularity || 'Regular (26-32d)'}
                  onChange={(e) => onChange({ ...assessment, cycleRegularity: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                >
                  <option value="Regular (26-32d)">Regular (26–32d)</option>
                  <option value="Oligomenorrhea (>35d)">Oligomenorrhea (&gt;35d)</option>
                  <option value="Polymenorrhea (<21d)">Polymenorrhea (&lt;21d)</option>
                  <option value="Irregular / AUB">Irregular / AUB</option>
                  <option value="Amenorrhea">Secondary Amenorrhea</option>
                  <option value="Postmenopausal">Postmenopausal</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Flow (Days / Vol)</label>
                <select
                  value={assessment.menstrualFlowVolume || 'Moderate / Normal'}
                  onChange={(e) => onChange({ ...assessment, menstrualFlowVolume: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                >
                  <option value="Moderate / Normal">Moderate / Normal (3–5d)</option>
                  <option value="Heavy (Menorrhagia / Clots)">Heavy / Clots (HMB)</option>
                  <option value="Scanty (Hypomenorrhea)">Scanty (Hypomenorrhea)</option>
                  <option value="Spotting">Spotting Only</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Dysmenorrhea</label>
                <select
                  value={assessment.dysmenorrheaSeverity || 'None'}
                  onChange={(e) => onChange({ ...assessment, dysmenorrheaSeverity: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                >
                  <option value="None">None</option>
                  <option value="Mild">Mild</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Severe (Secondary)">Severe / Congestive</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">IMB / PCB Flag</label>
                <select
                  value={assessment.intermenstrualOrPostcoitalBleeding || 'None'}
                  onChange={(e) =>
                    onChange({ ...assessment, intermenstrualOrPostcoitalBleeding: e.target.value as any })
                  }
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                >
                  <option value="None">None</option>
                  <option value="Intermenstrual (IMB)">Intermenstrual (IMB)</option>
                  <option value="Postcoital (PCB)">Postcoital (PCB ⚠️)</option>
                  <option value="Both">Both IMB + PCB ⚠️</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Contraception</label>
                <select
                  value={assessment.contraceptionMethod || 'None'}
                  onChange={(e) => onChange({ ...assessment, contraceptionMethod: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                >
                  <option value="None">None / Trying to Conceive</option>
                  <option value="Barrier">Barrier</option>
                  <option value="Cu-IUCD (380A / 375)">Cu-IUCD 380A / 375</option>
                  <option value="LNG-IUS (Mirena)">LNG-IUS (Mirena)</option>
                  <option value="COCPs">Combined OCPs (Mala-N)</option>
                  <option value="Chhaya (Centchroman)">Chhaya (Centchroman)</option>
                  <option value="Antara (Inj. MPA)">Antara (Inj. MPA)</option>
                  <option value="Tubal Ligation">Tubal Ligation</option>
                </select>
              </div>
            </div>
          </div>

          {/* MODE 3 DEDICATED: FOLLICULAR STUDY, OVULATION INDUCTION & INFERTILITY WORKUP */}
          {activeMode === 'Fertility & PCOS' && (
            <div className="bg-white rounded-lg border border-purple-200 p-3.5 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-2">
                <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  Follicular Monitoring (TVS), Ovulation Induction &amp; Couple Fertility Workup (ISAR / FOGSI)
                </span>
                {typeof assessment.endometrialThicknessMm === 'number' && assessment.endometrialThicknessMm >= 8 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    Receptive Endometrium ({assessment.endometrialThicknessMm} mm)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Cycle Day (CD)</label>
                  <input
                    type="number"
                    min={1}
                    max={45}
                    placeholder="e.g. CD 12"
                    value={assessment.fertilityCycleDay ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...assessment,
                        fertilityCycleDay: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full mt-1 p-1.5 rounded border bg-purple-50/40 border-purple-200 text-xs font-bold text-purple-900"
                  />
                </div>

                <div className="col-span-1 sm:col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Ovulation Induction Protocol</label>
                  <select
                    value={assessment.ovulationInductionProtocol || 'Letrozole 2.5 mg (CD2-6)'}
                    onChange={(e) => onChange({ ...assessment, ovulationInductionProtocol: e.target.value as any })}
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                  >
                    <option value="Natural Cycle">Natural Cycle Follicular Tracking</option>
                    <option value="Letrozole 2.5 mg (CD2-6)">Letrozole 2.5 mg OD (CD2–CD6)</option>
                    <option value="Letrozole 5 mg (CD2-6)">Letrozole 5 mg OD (CD2–CD6)</option>
                    <option value="Clomiphene Citrate (CD2-6)">Clomiphene Citrate 50/100 mg (CD2–CD6)</option>
                    <option value="Gonadotropin (rFSH / hMG)">Low-Dose Gonadotropin (rFSH / hMG)</option>
                    <option value="IUI / IVF Prep">IUI / Controlled Ovarian Stimulation</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Right Ovary (mm)</label>
                  <input
                    type="text"
                    placeholder="e.g. 19x18 mm DF"
                    value={assessment.rightOvaryFollicleMm || ''}
                    onChange={(e) => onChange({ ...assessment, rightOvaryFollicleMm: e.target.value })}
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Left Ovary (mm)</label>
                  <input
                    type="text"
                    placeholder="e.g. 11 mm / PCOM"
                    value={assessment.leftOvaryFollicleMm || ''}
                    onChange={(e) => onChange({ ...assessment, leftOvaryFollicleMm: e.target.value })}
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">ET (mm) &amp; Pattern</label>
                  <div className="flex gap-1 mt-1">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="8.4"
                      value={assessment.endometrialThicknessMm ?? ''}
                      onChange={(e) =>
                        onChange({
                          ...assessment,
                          endometrialThicknessMm: e.target.value === '' ? undefined : parseFloat(e.target.value),
                        })
                      }
                      className="w-14 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-bold"
                    />
                    <select
                      value={assessment.endometrialPattern || 'Trilaminar (Grade A)'}
                      onChange={(e) => onChange({ ...assessment, endometrialPattern: e.target.value as any })}
                      className="flex-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-[11px] font-semibold"
                    >
                      <option value="Trilaminar (Grade A)">Trilaminar</option>
                      <option value="Isoechoic (Grade B)">Isoechoic</option>
                      <option value="Homogeneous">Homogeneous</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">AMH (ng/mL)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 3.8"
                    value={assessment.amhNgMl ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...assessment,
                        amhNgMl: e.target.value === '' ? undefined : parseFloat(e.target.value),
                      })
                    }
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Tubal Patency (HSG / SIS)</label>
                  <input
                    type="text"
                    placeholder="e.g. Bilateral spill free"
                    value={assessment.tubalPatencyStatus || ''}
                    onChange={(e) => onChange({ ...assessment, tubalPatencyStatus: e.target.value })}
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Partner Semen (WHO 6th)</label>
                  <input
                    type="text"
                    placeholder="e.g. Normozoospermia 42M/mL"
                    value={assessment.partnerSemenSummary || ''}
                    onChange={(e) => onChange({ ...assessment, partnerSemenSummary: e.target.value })}
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Trigger &amp; TI / IUI Plan</label>
                  <input
                    type="text"
                    placeholder="e.g. Inj r-hCG 250mcg -> IUI at 36h"
                    value={assessment.ovulationTriggerPlan || ''}
                    onChange={(e) => onChange({ ...assessment, ovulationTriggerPlan: e.target.value })}
                    className="w-full mt-1 p-1.5 rounded border bg-purple-50/40 border-purple-200 text-xs font-semibold text-purple-950"
                  />
                </div>
              </div>
            </div>
          )}

          {/* MODE 2 DEDICATED: FIGO PALM-COEIN AUB & SYNDROMIC RTI/STI CARE */}
          {activeMode === 'Gynaecology & Menstrual' && (
            <div className="bg-white rounded-lg border border-pink-200 p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs shadow-xs">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">
                  FIGO PALM-COEIN Classification (Abnormal Uterine Bleeding)
                </label>
                <select
                  value={assessment.aubPalmCoeinClass || 'Not Applicable'}
                  onChange={(e) => onChange({ ...assessment, aubPalmCoeinClass: e.target.value as any })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold text-slate-800"
                >
                  <option value="Not Applicable">Not Applicable / Routine Gynae</option>
                  <option value="AUB-P (Polyp)">AUB-P (Endometrial / Cervical Polyp)</option>
                  <option value="AUB-A (Adenomyosis)">AUB-A (Adenomyosis)</option>
                  <option value="AUB-L (Leiomyoma / Fibroid)">AUB-L (Leiomyoma / Submucosal-Intramural Fibroid)</option>
                  <option value="AUB-M (Malignancy / Hyperplasia)">AUB-M (Endometrial Hyperplasia / EIN ⚠️)</option>
                  <option value="AUB-C (Coagulopathy)">AUB-C (Systemic Coagulopathy)</option>
                  <option value="AUB-O (Ovulatory)">AUB-O (Ovulatory Dysfunction)</option>
                  <option value="AUB-E (Endometrial)">AUB-E (Primary Endometrial)</option>
                  <option value="AUB-I (Iatrogenic)">AUB-I (Iatrogenic / Anticoagulant / Hormonal)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">
                  Leucorrhea / PID / Endometriosis Clinical Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Candidal vaginitis / Chronic pelvic pain / Dyspareunia check"
                  value={assessment.vaginalDischargeSyndromic || ''}
                  onChange={(e) => onChange({ ...assessment, vaginalDischargeSyndromic: e.target.value })}
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                />
              </div>
            </div>
          )}

          {/* MODE 4 DEDICATED: POSTNATAL / PUERPERIUM (42d) & MENOPAUSE CLINIC */}
          {activeMode === 'Postnatal / Menopause' && (
            <div className="bg-white rounded-lg border border-rose-200 p-3.5 space-y-3 shadow-xs text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 pb-2">
                <span className="text-xs font-bold text-rose-950 flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 text-rose-600" />
                  Postnatal Puerperium (MoHFW 42-Day Care) &amp; Menopause / Bone Health Suite
                </span>
                <div className="flex gap-1.5">
                  {(['Postnatal / Lactation (42d)', 'Perimenopause / Menopause'] as const).map((focus) => {
                    const selected = (assessment.postnatalOrMenopauseFocus || 'Postnatal / Lactation (42d)') === focus;
                    return (
                      <button
                        key={focus}
                        type="button"
                        onClick={() => onChange({ ...assessment, postnatalOrMenopauseFocus: focus })}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold border ${
                          selected
                            ? 'bg-rose-600 text-white border-rose-700'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        {focus}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(assessment.postnatalOrMenopauseFocus || 'Postnatal / Lactation (42d)') === 'Postnatal / Lactation (42d)' ? (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block">Postpartum Day</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      placeholder="e.g. Day 10 / Day 42"
                      value={assessment.postpartumDays ?? ''}
                      onChange={(e) =>
                        onChange({
                          ...assessment,
                          postpartumDays: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block">Lochia &amp; Scar / Episiotomy</label>
                    <input
                      type="text"
                      placeholder="e.g. Lochia serosa; LSCS scar clean & dry"
                      value={assessment.lochiaAndScarStatus || ''}
                      onChange={(e) => onChange({ ...assessment, lochiaAndScarStatus: e.target.value })}
                      className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block">Lactation &amp; Latch</label>
                    <select
                      value={assessment.lactationLatchStatus || 'Exclusive BF — Good Latch'}
                      onChange={(e) => onChange({ ...assessment, lactationLatchStatus: e.target.value as any })}
                      className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                    >
                      <option value="Exclusive BF — Good Latch">Exclusive BF — Good Latch</option>
                      <option value="Latch Support Needed">Cracked Nipple / Latch Support</option>
                      <option value="Mixed / Top Feed">Mixed / Galactagogue Counsel</option>
                      <option value="Lactation Suppressed">Lactation Suppressed</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block">Postpartum Mood (EPDS)</label>
                    <select
                      value={assessment.epdsPostnatalMood || 'Normal (EPDS <10)'}
                      onChange={(e) => onChange({ ...assessment, epdsPostnatalMood: e.target.value as any })}
                      className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                    >
                      <option value="Normal (EPDS <10)">Normal Mood (EPDS &lt;10)</option>
                      <option value="Borderline (10-12) — Counsel">Baby Blues / Borderline (10–12)</option>
                      <option value="High Risk (>=13) — Refer">Postpartum Depression Risk (&gt;=13 ⚠️)</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block">Vasomotor / GSM Severity (IMS)</label>
                    <select
                      value={assessment.vasomotorSeverity || 'Moderate'}
                      onChange={(e) => onChange({ ...assessment, vasomotorSeverity: e.target.value as any })}
                      className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                    >
                      <option value="None">None / Routine Preventive</option>
                      <option value="Mild">Mild Hot Flushes / Sleep Disturbance</option>
                      <option value="Moderate">Moderate VMS + Genitourinary Dryness (GSM)</option>
                      <option value="Severe Hot Flushes / Night Sweats">Severe VMS — MHT Eligibility Screen</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block">DEXA Bone Density (T-Score) &amp; Mammogram</label>
                    <input
                      type="text"
                      placeholder="e.g. Lumbar T-score -1.6 (Osteopenia); Mammogram BIRADS-1; ET 3.4 mm"
                      value={assessment.dexaTScoreSummary || ''}
                      onChange={(e) => onChange({ ...assessment, dexaTScoreSummary: e.target.value })}
                      className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* PCOS, Fertility & Pelvic / USG Findings */}
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-3 shadow-xs">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-purple-600" />
                PCOS Rotterdam Phenotype, Fertility &amp; Pelvic / USG Exam
              </span>

              <div>
                <label className="text-[11px] font-medium text-slate-500">PCOS &amp; Hyperandrogenic / Metabolic Criteria:</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {PCOS_PHENOTYPE_FLAGS.map((flag) => {
                    const selected = assessment.pcosPhenotypeFlags?.includes(flag);
                    return (
                      <button
                        key={flag}
                        type="button"
                        onClick={() => toggleChip('pcosPhenotypeFlags', flag)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-all ${
                          selected
                            ? 'bg-purple-100 text-purple-900 border-purple-300 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {selected ? '✓ ' : ''}
                        {flag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">
                    Marital / Fertility / Consanguinity Notes
                  </label>
                  <input
                    type="text"
                    value={assessment.maritalObstetricNotes || ''}
                    onChange={(e) => onChange({ ...assessment, maritalObstetricNotes: e.target.value })}
                    placeholder="e.g. Married 3 yrs, non-consanguineous, trying 14m"
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">
                    Pelvic USG (TAS / TVS) Findings
                  </label>
                  <input
                    type="text"
                    value={assessment.pelvicUsgSummary || ''}
                    onChange={(e) => onChange({ ...assessment, pelvicUsgSummary: e.target.value })}
                    placeholder="e.g. ET 8mm, bilateral PCOM / FIGO Type 2 fibroid 2.4cm"
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">
                    Per-Speculum (P/S) &amp; Bimanual Pelvic (P/V) Findings
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assessment.chaperonePresent !== false}
                      onChange={(e) => onChange({ ...assessment, chaperonePresent: e.target.checked })}
                      className="rounded text-emerald-600 h-3.5 w-3.5"
                    />
                    <span>Female Chaperone Present</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={assessment.pelvicSpeculumSummary || ''}
                  onChange={(e) => onChange({ ...assessment, pelvicSpeculumSummary: e.target.value })}
                  placeholder="e.g. P/S: Cervix healthy, no erosion/bleeding; P/V: Uterus AV normal size, fornices free & non-tender"
                  className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                />
              </div>
            </div>

            {/* Preventive Oncology (Cervical Pap/VIA + HPV Cervavac/Gardasil + Breast Exam) */}
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-3 shadow-xs">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Ribbon className="w-3.5 h-3.5 text-pink-600" />
                Preventive Women&apos;s Oncology &amp; Anemia Screen (FOGSI / NPCDCS)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">
                    Cervical Screen (Pap / LBC / VIA)
                  </label>
                  <input
                    type="text"
                    value={assessment.cervicalScreeningPapVia || ''}
                    onChange={(e) => onChange({ ...assessment, cervicalScreeningPapVia: e.target.value })}
                    placeholder="e.g. LBC NILM (2026) / VIA Negative / Advised HPV Co-test"
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">
                    HPV Vaccine Status
                  </label>
                  <select
                    value={assessment.hpvVaccineStatus || 'Unvaccinated'}
                    onChange={(e) => onChange({ ...assessment, hpvVaccineStatus: e.target.value as any })}
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                  >
                    <option value="Unvaccinated">Unvaccinated — Counsel Cervavac / Gardasil</option>
                    <option value="Dose 1 Given">Dose 1 Administered</option>
                    <option value="Completed (Cervavac / Gardasil)">Completed (Cervavac / Gardasil)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">
                    Clinical Breast Exam (CBE)
                  </label>
                  <input
                    type="text"
                    value={assessment.breastExamSummary || ''}
                    onChange={(e) => onChange({ ...assessment, breastExamSummary: e.target.value })}
                    placeholder="e.g. Bilateral breasts soft, no palpable lump/nipple discharge, axillae clear"
                    className="w-full mt-1 p-1.5 rounded border bg-slate-50 border-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">
                    Hemoglobin (g/dL) &amp; TSH (mIU/L)
                  </label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Hb g/dL"
                      value={assessment.maternalHemoglobinGdl ?? ''}
                      onChange={(e) =>
                        onChange({
                          ...assessment,
                          maternalHemoglobinGdl: e.target.value === '' ? undefined : parseFloat(e.target.value),
                        })
                      }
                      className="w-full p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                    />
                    <input
                      type="number"
                      step="0.1"
                      placeholder="TSH mIU/L"
                      value={assessment.tshMiuL ?? ''}
                      onChange={(e) =>
                        onChange({
                          ...assessment,
                          tshMiuL: e.target.value === '' ? undefined : parseFloat(e.target.value),
                        })
                      }
                      className="w-full p-1.5 rounded border bg-slate-50 border-slate-200 text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
