import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  User,
  FileText,
  Clock,
  ShieldCheck,
  Activity,
  Phone
} from 'lucide-react';
import { Patient, Prescription } from '../types';

export interface PatientDocument {
  id: string;
  name: string;
  type: 'Lab Report' | 'Prescription' | 'Clinical Photo' | 'Discharge Summary' | 'Scan / X-Ray' | 'Other';
  date: string;
  url: string;
  size?: string;
}

interface PatientRecordModalProps {
  patient: Patient | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdatePatient?: (updated: Patient) => void;
  pastPrescriptions?: Prescription[];
}

export const PatientRecordModal: React.FC<PatientRecordModalProps> = ({
  patient,
  isOpen,
  onClose,
  pastPrescriptions = [],
}) => {
  if (!isOpen || !patient) return null;

  const [activeTab, setActiveTab] = useState<'history' | 'documents' | 'vitals' | 'demographics'>('documents');

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-100"
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 rounded-full bg-indigo-600/30 border-2 border-indigo-400 flex items-center justify-center text-xl font-bold text-indigo-200">
                  {patient.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-xl font-bold tracking-tight">{patient.name}</h2>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                      {patient.uhid}
                    </span>
                    {patient.abhaNumber && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> ABHA Linked (sandbox)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-1 flex items-center space-x-3">
                    <span>{patient.age} yrs, {patient.gender}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {patient.phone}</span>
                    <span>•</span>
                    <span className="text-rose-300 font-medium">Blood: {patient.bloodGroup || 'Not recorded'}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-header / Tabs */}
            <div className="bg-slate-50 border-b border-slate-200 px-6 flex space-x-6 text-sm font-medium">
              <button
                onClick={() => setActiveTab('documents')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'documents'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Medical History & Documents</span>
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'history'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>Visit History & Prescriptions</span>
              </button>
              <button
                onClick={() => setActiveTab('vitals')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'vitals'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Activity className="w-4 h-4" />
                <span>Vitals & Clinical Data</span>
              </button>
              <button
                onClick={() => setActiveTab('demographics')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'demographics'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Demographics & Allergies</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 bg-slate-100/50 space-y-6">
              {activeTab === 'documents' && (
                <div className="space-y-3" data-testid="record-modal-documents">
                  <h3 className="text-sm font-bold text-slate-800">Saved reports</h3>
                  <p className="text-sm text-slate-600">
                    Reports are saved on the patient chart. Open Patients, record consent, then attach a photo or PDF. This window does not keep a local copy.
                  </p>
                </div>
              )}

              {/* Visit History Tab */}
              {activeTab === 'history' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-800">Past Consultations & Prescriptions</h3>
                  {pastPrescriptions.length === 0 ? (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-500 text-xs">
                      <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                      No past prescription history recorded in this session. All clinical records are securely linked to UHID {patient.uhid}.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pastPrescriptions.map((rx, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-slate-900">Consultation #{idx + 1}</span>
                              <span className="text-xs text-slate-500">{rx.date || 'Recent'}</span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1">Diagnosis: <span className="font-semibold text-slate-800">{rx.diagnosis || 'Not recorded'}</span></p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">Completed</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Vitals Tab */}
              {activeTab === 'vitals' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-800">Recorded Vitals & Clinical Metrics</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Blood Pressure</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.bloodPressureSystolic && patient.vitals?.bloodPressureDiastolic ? `${patient.vitals.bloodPressureSystolic}/${patient.vitals.bloodPressureDiastolic} mmHg` : 'Not recorded'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Heart Rate</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.heartRate ? `${patient.vitals.heartRate} bpm` : 'Not recorded'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">SpO2 (Oxygen)</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.spO2 ? `${patient.vitals.spO2}%` : 'Not recorded'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Temperature</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.temperature ? `${patient.vitals.temperature}°F` : 'Not recorded'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Demographics & Allergies Tab */}
              {activeTab === 'demographics' && (
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-800">Patient Demographics & Clinical Profile</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block">Full Name</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.name}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">UHID</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.uhid}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Phone Number</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.phone}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Age / Gender</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.age} years, {patient.gender}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Blood Group</span>
                        <span className="font-semibold text-rose-600 mt-0.5 block">{patient.bloodGroup || 'Not recorded'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Emergency Contact</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.emergencyContact || 'Not Provided'}</span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100">
                      <span className="text-xs text-slate-500 block mb-1">Known Allergies</span>
                      <div className="flex flex-wrap gap-1.5">
                        {patient.allergies && patient.allergies.length > 0 ? (
                          patient.allergies.map((a, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-200">
                              {a}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500 italic">No known drug or food allergies</span>
                        )}
                      </div>
                    </div>

                    <div className="pt-2">
                      <span className="text-xs text-slate-500 block mb-1">Chronic Conditions</span>
                      <div className="flex flex-wrap gap-1.5">
                        {patient.chronicConditions && patient.chronicConditions.length > 0 ? (
                          patient.chronicConditions.map((c, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500 italic">No chronic conditions recorded</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

    </AnimatePresence>
  );
};
