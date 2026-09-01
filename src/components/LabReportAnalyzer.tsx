import React, { useState } from 'react';
import { 
  FileText, 
  UploadCloud, 
  TrendingUp, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  Sparkles, 
  Activity, 
  Search, 
  Download, 
  Zap,
  Info,
  Calendar
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { LabReportRecord, Patient, LabResultParam } from '../types';
import { MOCK_LAB_REPORTS } from '../data/clinicalData';

interface LabReportAnalyzerProps {
  currentPatient?: Patient;
  patientName?: string;
  uhid?: string;
  onApplyClinicalFindings?: (findings: string[]) => void;
}

// Longitudinal historical datasets
const SAMPLE_GLYCEMIC_DATA = [
  { testDate: 'Nov 2025', hba1c: 9.1, creatinine: 1.15, egfr: 68, fbs: 185 },
  { testDate: 'Feb 2026', hba1c: 8.7, creatinine: 1.22, egfr: 62, fbs: 172 },
  { testDate: 'May 2026', hba1c: 7.9, creatinine: 1.28, egfr: 58, fbs: 154 },
  { testDate: 'Aug 2026', hba1c: 8.4, creatinine: 1.32, egfr: 54, fbs: 162 }
];

const SAMPLE_LIPID_DATA = [
  { testDate: 'Nov 2025', cholesterol: 248, ldl: 162, hdl: 38, triglycerides: 240 },
  { testDate: 'Feb 2026', cholesterol: 228, ldl: 145, hdl: 41, triglycerides: 210 },
  { testDate: 'May 2026', cholesterol: 198, ldl: 122, hdl: 45, triglycerides: 165 },
  { testDate: 'Aug 2026', cholesterol: 210, ldl: 134, hdl: 43, triglycerides: 185 }
];

const SAMPLE_CBC_DATA = [
  { testDate: 'Nov 2025', hemoglobin: 11.8, wbc: 11200, platelets: 210 },
  { testDate: 'Feb 2026', hemoglobin: 12.4, wbc: 9800, platelets: 235 },
  { testDate: 'May 2026', hemoglobin: 13.6, wbc: 7400, platelets: 260 },
  { testDate: 'Aug 2026', hemoglobin: 14.1, wbc: 7100, platelets: 255 }
];

const SAMPLE_LFT_DATA = [
  { testDate: 'Nov 2025', sgot: 62, sgpt: 74, bilirubin: 1.4 },
  { testDate: 'Feb 2026', sgot: 48, sgpt: 55, bilirubin: 1.1 },
  { testDate: 'May 2026', sgot: 34, sgpt: 38, bilirubin: 0.9 },
  { testDate: 'Aug 2026', sgot: 31, sgpt: 35, bilirubin: 0.8 }
];

export const LabReportAnalyzer: React.FC<LabReportAnalyzerProps> = ({
  currentPatient,
  patientName = 'Rajesh Deshmukh',
  uhid = 'UHID-2026-8841',
  onApplyClinicalFindings,
}) => {
  const effectivePatientName = currentPatient?.name || patientName;
  const effectiveUhid = currentPatient?.uhid || uhid;

  const [selectedReportId, setSelectedReportId] = useState<string>(
    MOCK_LAB_REPORTS[0]?.id || ''
  );
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [activeTab, setActiveTab] = useState<'extracted' | 'trends' | 'renal_safety'>('extracted');
  const [trendCategory, setTrendCategory] = useState<'glycemic' | 'lipid' | 'cbc' | 'lft'>('glycemic');
  const [searchFilter, setSearchFilter] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const activeReport = MOCK_LAB_REPORTS.find((r) => r.id === selectedReportId) || MOCK_LAB_REPORTS[0];

  const handleSimulateOcrUpload = (fileName: string = 'Thyrocare_Biochem_Report_Aug2026.pdf') => {
    setIsProcessingOcr(true);
    setUploadedFileName(fileName);
    setTimeout(() => {
      setIsProcessingOcr(false);
      setSelectedReportId(MOCK_LAB_REPORTS[0].id);
    }, 1200);
  };

  const filteredResults = activeReport.results.filter((res) =>
    res.param.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const abnormalCount = activeReport.results.filter((r) => r.status !== 'Normal').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-400">
              <Activity className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Lab Report OCR & Longitudinal Trend Visualizer</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Gemini Vision Scribe
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl">
            Upload PDF/JPG diagnostic sheets for automated test extraction, longitudinal biomarker trend plotting, and GFR-based renal medication dose adjustment warnings.
          </p>
        </div>

        {/* Upload Action */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSimulateOcrUpload}
            disabled={isProcessingOcr}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            {isProcessingOcr ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin text-blue-200" />
                <span>Extracting with Gemini OCR...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Upload Lab PDF / Photo</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Grid: Left Selector & Overview / Right Detailed Views */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Report Selectors & Patient Summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center justify-between">
              <span>Patient Lab Archive</span>
              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                {effectivePatientName} ({effectiveUhid})
              </span>
            </h3>

            <div className="space-y-2">
              {MOCK_LAB_REPORTS.map((rep) => (
                <button
                  key={rep.id}
                  onClick={() => setSelectedReportId(rep.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1 ${
                    selectedReportId === rep.id
                      ? 'bg-blue-50/80 border-blue-300 text-blue-900 shadow-xs'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{rep.category}</span>
                    <span className="text-[10px] text-slate-500">{rep.date}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">{rep.labName}</p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">
                      {rep.results.filter((r) => r.status !== 'Normal').length} Abnormal Flags
                    </span>
                    {rep.egfrMlMin && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                        eGFR {rep.egfrMlMin} mL/min
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick GFR Renal Safety Widget */}
          <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-xl border border-amber-200 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Automated Renal Dose Guard</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              Patient's current eGFR is <strong className="font-bold">{activeReport.egfrMlMin || 54} mL/min</strong>. Drug clearance for Metformin, Ciprofloxacin, and NSAIDs requires dose cap vigilance.
            </p>
            <button
              onClick={() => setActiveTab('renal_safety')}
              className="text-xs font-bold text-amber-900 hover:underline flex items-center gap-1 pt-1"
            >
              <span>View Renal Drug Table</span>
              <span>&rarr;</span>
            </button>
          </div>
        </div>

        {/* Right Column: Detailed Panels */}
        <div className="lg:col-span-3 space-y-4">
          {/* Sub Navigation Tabs */}
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-1.5 shadow-xs">
            <div className="flex space-x-1">
              <button
                onClick={() => setActiveTab('extracted')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'extracted'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Extracted Biomarker Table ({activeReport.results.length})
              </button>
              <button
                onClick={() => setActiveTab('trends')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'trends'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Longitudinal Trend Graph</span>
              </button>
              <button
                onClick={() => setActiveTab('renal_safety')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'renal_safety'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Renal Dose Adjustments</span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2 px-2 text-xs text-slate-500">
              <span>Date: <strong>{activeReport.date}</strong></span>
              <span>•</span>
              <span className="text-rose-600 font-bold">{abnormalCount} Out-of-Range</span>
            </div>
          </div>

          {/* TAB 1: Extracted Biomarker Table */}
          {activeTab === 'extracted' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-5">
              {/* Doctor Clinical Interpretation Summary */}
              {activeReport.doctorInterpretation && (
                <div className="bg-blue-50/80 border border-blue-200 rounded-lg p-3 text-xs text-blue-950 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">AI Clinical Synthesis: </span>
                    <span>{activeReport.doctorInterpretation}</span>
                  </div>
                </div>
              )}

              {/* Search Bar */}
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search test name (e.g. HbA1c, Creatinine)..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">Flag Legend:</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Normal</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">High / Low</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Critical</span>
                </div>
              </div>

              {/* Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                    <tr>
                      <th className="p-3">Biomarker / Test Parameter</th>
                      <th className="p-3">Extracted Result</th>
                      <th className="p-3">Normal Standard Range</th>
                      <th className="p-3">Delta / Comparison</th>
                      <th className="p-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredResults.map((item, idx) => {
                      let statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Normal
                        </span>
                      );
                      if (item.status === 'High' || item.status === 'Low') {
                        statusBadge = (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            {item.status}
                          </span>
                        );
                      } else if (item.status === 'Critical') {
                        statusBadge = (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">
                            ⚠️ Critical
                          </span>
                        );
                      }

                      return (
                        <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-3 font-semibold text-slate-900">{item.param}</td>
                          <td className="p-3 font-mono font-bold text-slate-800">
                            {item.value} <span className="text-slate-500 font-normal text-[11px]">{item.unit}</span>
                          </td>
                          <td className="p-3 text-slate-600">{item.normalRange} {item.unit}</td>
                          <td className="p-3 text-[11px] text-slate-500 font-medium">
                            {item.trendDelta || '—'}
                          </td>
                          <td className="p-3 text-right">{statusBadge}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Longitudinal Trend Graph */}
          {activeTab === 'trends' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <span>Longitudinal Diagnostic Biomarker Trajectory</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Multi-visit biometric time series for {effectivePatientName} ({effectiveUhid})
                  </p>
                </div>

                {/* Trend Category Switcher */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                  {[
                    { id: 'glycemic', label: 'Glycemic & Renal' },
                    { id: 'lipid', label: 'Lipid Panel' },
                    { id: 'cbc', label: 'CBC Blood' },
                    { id: 'lft', label: 'LFT Liver' }
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setTrendCategory(cat.id as any)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                        trendCategory === cat.id
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Glycemic & Renal Charts */}
              {trendCategory === 'glycemic' && (
                <div className="space-y-4">
                  {/* Chart 1: HbA1c & Fasting Glucose */}
                  <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>HbA1c Trend (%) vs Fasting Blood Sugar (mg/dL)</span>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1 text-blue-600 font-bold">
                          <span className="w-2 h-2 rounded-full bg-blue-600"></span> HbA1c (%)
                        </span>
                        <span className="flex items-center gap-1 text-amber-600 font-bold">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span> FBS (mg/dL)
                        </span>
                      </div>
                    </div>

                    <div className="h-56 w-full pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={SAMPLE_GLYCEMIC_DATA} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="testDate" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis yAxisId="left" domain={[5, 11]} tick={{ fontSize: 11, fill: '#2563eb' }} />
                          <YAxis yAxisId="right" orientation="right" domain={[100, 220]} tick={{ fontSize: 11, fill: '#d97706' }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0f172a',
                              borderRadius: '8px',
                              color: '#fff',
                              fontSize: '11px',
                              border: 'none'
                            }}
                          />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="hba1c"
                            name="HbA1c (%)"
                            stroke="#2563eb"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#2563eb' }}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="fbs"
                            name="FBS (mg/dL)"
                            stroke="#d97706"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#d97706' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Chart 2: eGFR vs Serum Creatinine */}
                  <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>Renal Function Trajectory: eGFR (mL/min) vs Serum Creatinine (mg/dL)</span>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1 text-emerald-600 font-bold">
                          <span className="w-2 h-2 rounded-full bg-emerald-600"></span> eGFR (mL/min)
                        </span>
                        <span className="flex items-center gap-1 text-rose-600 font-bold">
                          <span className="w-2 h-2 rounded-full bg-rose-500"></span> Creatinine (mg/dL)
                        </span>
                      </div>
                    </div>

                    <div className="h-56 w-full pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={SAMPLE_GLYCEMIC_DATA} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="testDate" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis yAxisId="left" domain={[40, 100]} tick={{ fontSize: 11, fill: '#10b981' }} />
                          <YAxis yAxisId="right" orientation="right" domain={[0.5, 2.0]} tick={{ fontSize: 11, fill: '#ef4444' }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0f172a',
                              borderRadius: '8px',
                              color: '#fff',
                              fontSize: '11px',
                              border: 'none'
                            }}
                          />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="egfr"
                            name="eGFR (mL/min)"
                            stroke="#10b981"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#10b981' }}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="creatinine"
                            name="Serum Creatinine (mg/dL)"
                            stroke="#ef4444"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#ef4444' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* Lipid Profile Chart */}
              {trendCategory === 'lipid' && (
                <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Lipid Profile Fractions (mg/dL): Total Chol, LDL, HDL, Triglycerides</span>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="flex items-center gap-1 text-rose-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-rose-600"></span> Total Chol
                      </span>
                      <span className="flex items-center gap-1 text-amber-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span> LDL
                      </span>
                      <span className="flex items-center gap-1 text-emerald-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-emerald-600"></span> HDL
                      </span>
                      <span className="flex items-center gap-1 text-indigo-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-indigo-600"></span> Triglycerides
                      </span>
                    </div>
                  </div>

                  <div className="h-64 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={SAMPLE_LIPID_DATA} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="testDate" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis domain={[30, 280]} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '11px',
                            border: 'none'
                          }}
                        />
                        <Line type="monotone" dataKey="cholesterol" name="Total Cholesterol" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="ldl" name="LDL Cholesterol" stroke="#d97706" strokeWidth={2.5} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="hdl" name="HDL (Good Chol)" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="triglycerides" name="Triglycerides" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* CBC Blood Chart */}
              {trendCategory === 'cbc' && (
                <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Complete Blood Count: Hemoglobin (g/dL) vs Total Leukocytes (WBC /mcL)</span>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="flex items-center gap-1 text-rose-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-rose-600"></span> Hb (g/dL)
                      </span>
                      <span className="flex items-center gap-1 text-blue-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-blue-600"></span> WBC (/mcL)
                      </span>
                      <span className="flex items-center gap-1 text-purple-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-purple-600"></span> Platelets (k/mcL)
                      </span>
                    </div>
                  </div>

                  <div className="h-64 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={SAMPLE_CBC_DATA} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="testDate" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis yAxisId="left" domain={[10, 16]} tick={{ fontSize: 11, fill: '#e11d48' }} />
                        <YAxis yAxisId="right" orientation="right" domain={[4000, 14000]} tick={{ fontSize: 11, fill: '#2563eb' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '11px',
                            border: 'none'
                          }}
                        />
                        <Line yAxisId="left" type="monotone" dataKey="hemoglobin" name="Hemoglobin (g/dL)" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 4 }} />
                        <Line yAxisId="right" type="monotone" dataKey="wbc" name="Total Leukocytes (/mcL)" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* LFT Liver Function Chart */}
              {trendCategory === 'lft' && (
                <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Liver Transaminases Trajectory: SGOT/AST & SGPT/ALT (U/L)</span>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="flex items-center gap-1 text-amber-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span> SGOT (AST)
                      </span>
                      <span className="flex items-center gap-1 text-rose-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-rose-600"></span> SGPT (ALT)
                      </span>
                      <span className="flex items-center gap-1 text-teal-600 font-bold">
                        <span className="w-2 h-2 rounded-full bg-teal-600"></span> Bilirubin (mg/dL)
                      </span>
                    </div>
                  </div>

                  <div className="h-64 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={SAMPLE_LFT_DATA} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="testDate" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis domain={[10, 90]} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '11px',
                            border: 'none'
                          }}
                        />
                        <Line type="monotone" dataKey="sgot" name="SGOT (AST) U/L" stroke="#d97706" strokeWidth={2.5} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="sgpt" name="SGPT (ALT) U/L" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Renal Dose Adjustments */}
          {activeTab === 'renal_safety' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="space-y-0.5">
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>eGFR-Guided Pharmacotherapy Dose Guard</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Patient eGFR: <strong className="text-slate-800">{activeReport.egfrMlMin || 54} mL/min/1.73m²</strong> (Stage 3a Chronic Kidney Disease)
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  Dose Adjustment Recommended
                </span>
              </div>

              <div className="space-y-3">
                {[
                  {
                    drug: 'Metformin',
                    normalDose: '500 - 2000 mg/day',
                    adjustedDose: 'Max 1000 mg/day (Cap at 500mg BID)',
                    rationale: 'Risk of lactic acidosis if eGFR < 45 mL/min. Discontinue if eGFR drops below 30 mL/min.',
                    status: 'Dose Capped'
                  },
                  {
                    drug: 'Aceclofenac / NSAIDs',
                    normalDose: '100 mg BID',
                    adjustedDose: 'Avoid prolonged use or switch to Paracetamol',
                    rationale: 'NSAIDs inhibit renal prostaglandins and reduce renal perfusion in pre-existing CKD.',
                    status: 'High Caution'
                  },
                  {
                    drug: 'Ciprofloxacin',
                    normalDose: '500 mg BID',
                    adjustedDose: '250 - 500 mg every 18-24 hours',
                    rationale: '50% renal elimination. Accumulation risk if CrCl < 50 mL/min.',
                    status: 'Interval Prolonged'
                  },
                  {
                    drug: 'Dapagliflozin / SGLT2i',
                    normalDose: '10 mg OD',
                    adjustedDose: '10 mg OD (Safe for cardio-renal protection)',
                    rationale: 'Proven renal protective outcomes for CKD with eGFR down to 25 mL/min.',
                    status: 'Beneficial'
                  }
                ].map((rule, idx) => (
                  <div key={idx} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900">{rule.drug}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        {rule.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                      <div><strong className="text-slate-500">Standard Dose:</strong> {rule.normalDose}</div>
                      <div><strong className="text-amber-800">Adjusted eGFR Dose:</strong> {rule.adjustedDose}</div>
                    </div>
                    <p className="text-[11px] text-slate-500 italic pt-1 border-t border-slate-200/60">
                      <strong>Clinical Rationale:</strong> {rule.rationale}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
