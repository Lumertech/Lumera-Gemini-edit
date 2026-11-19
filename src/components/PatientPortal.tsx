import React, { useEffect, useState } from 'react';
import { formatINR } from '../lib/currency.ts';
import { 
  User, 
  FileText, 
  Calendar, 
  Pill, 
  Download, 
  Activity, 
  Clock, 
  Heart, 
  ShieldCheck, 
  ArrowUpRight,
  Printer
} from 'lucide-react';
import { apiFetch } from '../api/http';
import { Patient, Prescription, Appointment } from '../types';
import { ImmunizationChartPanel } from './immunization/ImmunizationChart';
import type { ChartDiagnosis, ChartNote, ChartVitalsEntry } from './PatientChartRecord';
import type { PatientTimelineItem } from './PatientTimeline';

interface PatientPortalProps {
  currentPatient: Patient;
  prescriptions: Prescription[];
  appointments: Appointment[];
  onBookNewSlot: () => void;
  unlinked?: boolean;
}

export const PatientPortal: React.FC<PatientPortalProps> = ({
  currentPatient,
  prescriptions,
  appointments,
  onBookNewSlot,
  unlinked = false,
}) => {
  const [activeTab, setActiveTab] = useState<'Prescriptions' | 'Appointments' | 'Vitals' | 'LabReports' | 'Chart'>('Chart');
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [diagnoses, setDiagnoses] = useState<ChartDiagnosis[]>([]);
  const [vitalsHistory, setVitalsHistory] = useState<ChartVitalsEntry[]>([]);
  const [uploads, setUploads] = useState<PatientTimelineItem[]>([]);
  const [chartError, setChartError] = useState("");

  useEffect(() => {
    if (unlinked || !currentPatient.id) return;
    let cancelled = false;
    void apiFetch<{
      notes?: ChartNote[];
      diagnoses?: ChartDiagnosis[];
      vitalsHistory?: ChartVitalsEntry[];
      timeline?: PatientTimelineItem[];
    }>(`/api/patients/${encodeURIComponent(currentPatient.id)}/chart`)
      .then((chart) => {
        if (cancelled) return;
        setNotes(chart.notes || []);
        setDiagnoses(chart.diagnoses || []);
        setVitalsHistory(chart.vitalsHistory || []);
        setUploads((chart.timeline || []).filter((item) => item.type === "upload"));
        setChartError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setChartError(err instanceof Error ? err.message : "Could not load this chart");
      });
    return () => {
      cancelled = true;
    };
  }, [currentPatient.id, unlinked]);

  if (unlinked) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
          <p className="text-sm font-medium text-slate-800">Verify via WhatsApp OTP to see your records</p>
        </div>
      </div>
    );
  }

  const patientRxList = prescriptions.filter((p) => p.patientId === currentPatient.id);
  const patientAptList = appointments.filter((a) => a.patientId === currentPatient.id);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Patient Profile Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-lg">
            {currentPatient.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold text-slate-900">{currentPatient.name}</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                UHID: {currentPatient.uhid}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {currentPatient.age} Years • {currentPatient.gender} • Blood Group: <strong className="text-slate-800">{currentPatient.bloodGroup}</strong> • Phone: {currentPatient.phone}
            </p>
            {(currentPatient.allergies || []).filter((item) => item && item !== 'None known').length > 0 && (
              <p className="text-[11px] text-red-600 mt-0.5 font-medium break-words">
                Allergies: {(currentPatient.allergies || []).filter((item) => item && item !== 'None known').join(', ')}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={onBookNewSlot}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-100 transition-all self-stretch sm:self-auto justify-center"
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Book Follow-up Slot</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      {chartError && (
        <p className="text-sm text-rose-700 break-words" role="alert">{chartError}</p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2 text-xs font-medium">
        {(['Chart', 'Prescriptions', 'Appointments', 'Vitals', 'LabReports'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === tab
                ? 'bg-blue-600 text-white shadow-xs font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab === 'Chart' ? 'My chart' :
             tab === 'Prescriptions' ? 'My prescriptions' :
             tab === 'Appointments' ? 'Visits' :
             tab === 'Vitals' ? 'Vitals' : 'Reports on file'}
          </button>
        ))}
      </div>

      {activeTab === 'Chart' && (
        <div className="space-y-4 min-w-0" data-testid="portal-chart">
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-slate-900">Diagnoses</h3>
            {diagnoses.length === 0 ? <p className="text-sm text-slate-600">Not recorded</p> : (
              <ul className="space-y-2">
                {diagnoses.map((item) => (
                  <li key={item.id} className="text-sm text-slate-800 break-words">
                    {item.label}{item.icd10 ? ` (${item.icd10})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="text-sm font-bold text-slate-900">Notes</h3>
            {notes.length === 0 ? <p className="text-sm text-slate-600">Not recorded</p> : (
              <ul className="space-y-3">
                {notes.map((item) => (
                  <li key={item.id} className="text-sm text-slate-800 whitespace-pre-wrap break-words">
                    {item.body || 'Note recorded'}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ImmunizationChartPanel patientId={currentPatient.id} audience="auto" canRecord={false} />
        </div>
      )}

      {/* Tab 1: Prescriptions */}
      {activeTab === 'Prescriptions' && (
        <div className="space-y-4">
          {patientRxList.length > 0 ? (
            patientRxList.map((rx) => (
              <div
                key={rx.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3.5"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {rx.rxNumber}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">Date: {rx.date}</span>
                    </div>
                    <h3 className="font-bold text-sm text-slate-900 mt-1">
                      Diagnosis: {rx.diagnosis} ({rx.icd10Code})
                    </h3>
                    <p className="text-xs text-blue-700 font-medium">Prescribed by {rx.doctorName} ({rx.doctorSpecialty})</p>
                  </div>

                  <button
                    onClick={() => window.print()}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                  >
                    <Printer className="w-3 h-3" />
                    <span>Print / PDF</span>
                  </button>
                </div>

                {/* Medicines List */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Medication Schedule:
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {rx.medicines.map((med, idx) => (
                      <div key={idx} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-slate-900 font-bold">{med.drugName}</strong>
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 font-mono font-semibold text-[10px]">
                            {med.frequency}
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px]">{med.dosage} • {med.timing} • For {med.durationDays} Days</p>
                        {med.instructions && (
                          <p className="text-[10px] text-blue-700 italic">Instruction: {med.instructions}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Advice & Review */}
                <div className="bg-blue-50/50 p-2.5 rounded-lg border border-blue-100 text-xs space-y-0.5">
                  <strong className="text-blue-900 block font-semibold">Doctor's Advice:</strong>
                  <p className="text-slate-700">{rx.advice.join(' • ')}</p>
                  {rx.followUpDate && (
                    <p className="text-blue-800 font-medium pt-1">
                      🗓️ Next Follow-up Review: {rx.followUpDate}
                    </p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
              <Pill className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-medium">No prescriptions recorded yet for this patient.</p>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Appointments */}
      {activeTab === 'Appointments' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3.5">
          <h3 className="font-bold text-slate-900 text-xs">Consultation History & Upcoming Visits</h3>
          <div className="space-y-2.5">
            {patientAptList.map((apt) => (
              <div key={apt.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded bg-slate-900 text-blue-300 font-bold flex items-center justify-center text-[9px]">
                      #{apt.tokenNumber}
                    </span>
                    <strong className="text-slate-900 text-xs">{apt.date} • {apt.timeSlot}</strong>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                      {apt.status}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-1 text-[11px]">
                    With <strong>{apt.doctorName}</strong> ({apt.specialty}) • Type: {apt.type}
                  </p>
                </div>
                <div className="font-mono font-bold text-slate-800 text-xs">
                  {formatINR(apt.consultationFee)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Vitals */}
      {activeTab === 'Vitals' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3" data-testid="portal-vitals">
          <h3 className="font-bold text-slate-900 text-sm">Vitals recorded at visits</h3>
          {vitalsHistory.length === 0 ? (
            <p className="text-sm text-slate-600">Not recorded</p>
          ) : (
            <ul className="space-y-2">
              {vitalsHistory.map((item) => (
                <li key={item.id} className="text-sm text-slate-800 break-words">
                  <span className="font-semibold">{item.summary}</span>
                  <span className="block text-xs text-slate-500">{item.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'LabReports' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3" data-testid="portal-reports">
          <h3 className="font-bold text-slate-900 text-sm">Reports on file</h3>
          <p className="text-xs text-slate-600 break-words">
            Files the clinic saved on this chart. A reading of the values stays a draft until a doctor confirms it.
          </p>
          {uploads.length === 0 ? (
            <p className="text-sm text-slate-600">Not recorded</p>
          ) : (
            <ul className="space-y-2">
              {uploads.map((item) => (
                <li key={item.id} className="text-sm text-slate-800 break-words">
                  <span className="font-semibold">{item.title}</span>
                  {item.summary ? <span className="block text-xs text-slate-500">{item.summary}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
