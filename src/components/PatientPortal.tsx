import React, { useState } from 'react';
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
import { Patient, Prescription, Appointment } from '../types';
import { LabReportAnalyzer } from './LabReportAnalyzer';

interface PatientPortalProps {
  currentPatient: Patient;
  prescriptions: Prescription[];
  appointments: Appointment[];
  onBookNewSlot: () => void;
}

export const PatientPortal: React.FC<PatientPortalProps> = ({
  currentPatient,
  prescriptions,
  appointments,
  onBookNewSlot,
}) => {
  const [activeTab, setActiveTab] = useState<'Prescriptions' | 'Appointments' | 'Vitals' | 'LabReports'>('Prescriptions');

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
            {currentPatient.allergies.length > 0 && currentPatient.allergies[0] !== 'None known' && (
              <p className="text-[11px] text-red-600 mt-0.5 font-medium">
                ⚠️ Allergies: {currentPatient.allergies.join(', ')}
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
      <div className="flex space-x-1 border-b border-slate-200 pb-2 overflow-x-auto text-xs font-medium">
        {(['Prescriptions', 'Appointments', 'Vitals', 'LabReports'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === tab
                ? 'bg-blue-600 text-white shadow-xs font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab === 'Prescriptions' ? '💊 My Prescriptions' :
             tab === 'Appointments' ? '📅 Visits & Appointments' :
             tab === 'Vitals' ? '❤️ Vitals History' : '🔬 Diagnostic Lab Reports'}
          </button>
        ))}
      </div>

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
                  ₹{apt.consultationFee}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Vitals */}
      {activeTab === 'Vitals' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3.5">
          <h3 className="font-bold text-slate-900 text-xs">Vitals & Physiological Trend</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 text-center">
              <span className="text-[11px] text-blue-800 font-medium block">Blood Pressure</span>
              <strong className="text-lg font-bold font-mono text-slate-900 block mt-0.5">120/80</strong>
              <span className="text-[10px] text-blue-600 font-medium">Optimal</span>
            </div>
            <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 text-center">
              <span className="text-[11px] text-blue-800 font-medium block">Heart Rate</span>
              <strong className="text-lg font-bold font-mono text-slate-900 block mt-0.5">74 bpm</strong>
              <span className="text-[10px] text-blue-600 font-medium">Normal Sinus</span>
            </div>
            <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 text-center">
              <span className="text-[11px] text-blue-800 font-medium block">Blood Sugar (RBS)</span>
              <strong className="text-lg font-bold font-mono text-slate-900 block mt-0.5">118 mg/dL</strong>
              <span className="text-[10px] text-blue-600 font-medium">Euglycemic</span>
            </div>
            <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 text-center">
              <span className="text-[11px] text-blue-800 font-medium block">SpO2 (Room Air)</span>
              <strong className="text-lg font-bold font-mono text-blue-700 block mt-0.5">99%</strong>
              <span className="text-[10px] text-emerald-600 font-medium">Adequate</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Lab Reports */}
      {activeTab === 'LabReports' && (
        <LabReportAnalyzer
          patientName={currentPatient.name}
          uhid={currentPatient.uhid}
        />
      )}
    </div>
  );
};
