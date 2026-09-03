import React from 'react';
import { X, Printer, Download, FileText, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

export interface DocumentPreviewData {
  type: 'prescription' | 'lab-report';
  id: string;
  title: string;
  pdfUrl: string;
  data?: any;
}

interface DocumentPreviewModalProps {
  document: DocumentPreviewData | null;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ document, onClose }) => {
  if (!document) return null;

  const isRx = document.type === 'prescription';
  const rawData = document.data || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Top Bar */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isRx ? 'bg-blue-600' : 'bg-emerald-600'} text-white`}>
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-white">{document.title}</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> EMR Verified
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Document Reference: #{document.id}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <a
              href={document.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5" /> Open / Print Official PDF
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800 text-sm">
          {/* Clinic Header Banner */}
          <div className="border-b-2 border-blue-600 pb-4 flex justify-between items-start">
            <div>
              <h2 className="text-xl font-black text-blue-900 tracking-tight">LUMERA HEALTHCARE POLYCLINIC</h2>
              <p className="text-xs text-slate-500">
                Integrated Multispecialty OPD, Diagnostic Pathology & Rehabilitation<br />
                Indiranagar, Bengaluru • Phone: +91 80 4123 4567 • emr@lumera.health
              </p>
            </div>
            <div className="text-right">
              <div className="font-bold text-sm text-slate-900">{rawData.doctorName || 'Dr. Siddharth Varma (PT)'}</div>
              <div className="text-xs text-blue-700 font-medium">{rawData.doctorSpecialty || 'Physiotherapy & Rehabilitation'}</div>
              <div className="text-[11px] text-slate-500 font-mono">Reg: {rawData.doctorRegNumber || 'KMC-88129'}</div>
            </div>
          </div>

          {/* Patient Details Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
            <div>
              <span className="text-slate-400 block font-medium">PATIENT NAME</span>
              <span className="font-bold text-slate-900">{rawData.patientName || 'Rajiv Saxena'}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">UHID / MRN</span>
              <span className="font-mono font-bold text-slate-900">{rawData.patientUhid || 'LUM-2026-0106'}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">PHONE NUMBER</span>
              <span className="font-mono text-slate-700">{rawData.patientPhone || '+91 98450 12345'}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">DATE</span>
              <span className="font-semibold text-slate-700">{rawData.date || '2026-09-03'}</span>
            </div>
          </div>

          {/* PRESCRIPTION VIEW */}
          {isRx && (
            <div className="space-y-4">
              <div className="bg-blue-50/60 p-3 rounded-lg border border-blue-100">
                <span className="text-xs font-bold text-blue-900 uppercase tracking-wider block">Provisional Diagnosis</span>
                <span className="text-sm font-semibold text-slate-900 mt-0.5 block">
                  {rawData.diagnosis || 'Acute Lumbar Radiculopathy & L4-L5 Disc Herniation (ICD-10: M54.16)'}
                </span>
              </div>

              <div>
                <div className="text-lg font-serif font-bold text-blue-800 mb-2">℞ Prescribed Medications</div>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Medication Name</th>
                        <th className="p-2.5">Dosage</th>
                        <th className="p-2.5">Frequency</th>
                        <th className="p-2.5">Duration</th>
                        <th className="p-2.5">Instructions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {rawData.medicines && rawData.medicines.length > 0 ? (
                        rawData.medicines.map((m: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2.5 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="p-2.5 font-bold text-slate-900">{m.drugName}</td>
                            <td className="p-2.5 text-slate-700">{m.dosage}</td>
                            <td className="p-2.5 font-semibold text-blue-700">{m.frequency}</td>
                            <td className="p-2.5 text-slate-700">{m.timing} ({m.durationDays}d)</td>
                            <td className="p-2.5 text-slate-500 italic">{m.instructions || '-'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-400">
                            No active medications listed.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {rawData.advice && rawData.advice.length > 0 && (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-1">
                    Physiotherapy & Ergonomic Rehabilitation Advice
                  </span>
                  <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                    {rawData.advice.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {rawData.dietInstructions && (
                <div className="bg-amber-50/70 p-3 rounded-lg border border-amber-200 text-xs text-amber-900">
                  <span className="font-bold">Dietary Guidance:</span> {rawData.dietInstructions}
                </div>
              )}
            </div>
          )}

          {/* LAB REPORT VIEW */}
          {!isRx && (
            <div className="space-y-4">
              <div className="bg-emerald-50/60 p-3 rounded-lg border border-emerald-100 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider block">Panel Category</span>
                  <span className="text-sm font-semibold text-slate-900">{rawData.category || 'Biochemistry & Inflammatory Markers'}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Laboratory Facility</span>
                  <span className="text-xs font-medium text-slate-700">{rawData.labName || 'Lumera Diagnostic Central Lab'}</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Parameter Investigated</th>
                      <th className="p-2.5">Observed Value</th>
                      <th className="p-2.5">Normal Reference</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Trend / Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {rawData.results && rawData.results.length > 0 ? (
                      rawData.results.map((r: any, idx: number) => {
                        const isAbnormal = r.status && r.status !== 'Normal';
                        return (
                          <tr key={idx} className={isAbnormal ? 'bg-rose-50/50' : 'hover:bg-slate-50'}>
                            <td className="p-2.5 font-bold text-slate-900">{r.param}</td>
                            <td className={`p-2.5 font-extrabold ${isAbnormal ? 'text-rose-700 font-mono text-sm' : 'text-slate-800'}`}>
                              {r.value} {r.unit}
                            </td>
                            <td className="p-2.5 text-slate-500">{r.normalRange} {r.unit}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isAbnormal
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-slate-500 text-[11px]">{r.trendDelta || '-'}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-slate-400">
                          No laboratory test rows available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {rawData.doctorInterpretation && (
                <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-950">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    Pathologist & Consultant Clinical Interpretation:
                  </div>
                  <p className="leading-relaxed">{rawData.doctorInterpretation}</p>
                </div>
              )}
            </div>
          )}

          {/* Digital Signature & Verification Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Cryptographically signed on Lumera Health Cloud • Tamper-proof EMR Record</span>
            </div>
            <div className="text-right font-serif italic text-blue-900 font-bold text-base">
              {rawData.doctorName || 'Dr. Siddharth Varma'}
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">Press Esc or Close to return to WhatsApp Suite</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold transition-colors"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};
