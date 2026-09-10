import React, { useEffect, useState } from 'react';
import { 
  Award, 
  TrendingUp, 
  ShieldCheck, 
  RefreshCw, 
  CheckCircle2, 
  Coins, 
  Building2, 
  Sparkles, 
  FileText, 
  Activity, 
  ArrowUpRight,
  AlertCircle,
  Clock,
  Layers,
  ExternalLink
} from 'lucide-react';

interface DhisOverview {
  currentMonth: string;
  transactionsCount: number;
  threshold: number;
  progressPercent: number;
  thresholdReached: boolean;
  totalIncentiveEarned: number;
  clinicShare: number;
  lumeraShare: number;
  breakdown: {
    OP_CONSULT: number;
    PRESCRIPTION: number;
    DIAGNOSTIC_REPORT: number;
    DISCHARGE_SUMMARY: number;
  };
  kycVerifiedPatients: number;
  recentTransactions: Array<{
    id: string;
    transaction_type: string;
    abha_address: string;
    abha_number: string;
    kyc_status: string;
    fhir_bundle_id: string;
    incentive_amount: number;
    clinic_share: number;
    lumera_share: number;
    created_at: string;
  }>;
  schemeDetails: {
    schemeName: string;
    baseRate: string;
    splitRatio: string;
    disbursementSchedule: string;
  };
}

export const DhisMeter: React.FC<{ compact?: boolean; onSimulateSuccess?: () => void }> = ({ 
  compact = false,
  onSimulateSuccess 
}) => {
  const [data, setData] = useState<DhisOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/abdm/dhis/overview');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch DHIS data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleSimulate = async (type: 'OP_CONSULT' | 'PRESCRIPTION' | 'DIAGNOSTIC_REPORT' | 'DISCHARGE_SUMMARY') => {
    try {
      setSimulating(true);
      const res = await fetch('/api/abdm/dhis/simulate-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        const result = await res.json();
        setLastActionMessage(`+₹20 Incentive Recorded: ${result.transaction.transaction_type} linked to ${result.transaction.abha_address}`);
        await fetchOverview();
        if (onSimulateSuccess) onSimulateSuccess();
        setTimeout(() => setLastActionMessage(null), 4000);
      }
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setSimulating(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 flex items-center justify-center space-x-3 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin text-purple-600" />
        <span className="text-sm font-medium">Synchronizing NHA DHIS Incentive Ledger...</span>
      </div>
    );
  }

  const d = data || {
    currentMonth: '2026-09',
    transactionsCount: 79,
    threshold: 100,
    progressPercent: 79,
    thresholdReached: false,
    totalIncentiveEarned: 1580,
    clinicShare: 1106,
    lumeraShare: 474,
    breakdown: { OP_CONSULT: 34, PRESCRIPTION: 23, DIAGNOSTIC_REPORT: 11, DISCHARGE_SUMMARY: 11 },
    kycVerifiedPatients: 5,
    recentTransactions: [],
    schemeDetails: {
      schemeName: 'NHA Digital Health Incentive Scheme (DHIS v3)',
      baseRate: '₹20 / Qualifying Transaction',
      splitRatio: '70% Facility (₹14) / 30% Lumera Digital Solution (₹6)',
      disbursementSchedule: 'Simulated ledger only (local stub — not a live incentive rail)'
    }
  };

  // Compact widget view for main admin overview
  if (compact) {
    return (
      <div className="bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 text-white rounded-xl p-6 border border-purple-500/30 shadow-xl relative overflow-hidden">
        {/* Background ambient glow */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-lg bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-purple-300 shadow-inner">
                <Award className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                  DHIS Incentive Meter
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-mono font-semibold">
                    NHA sandbox
                  </span>
                </h3>
                <p className="text-xs text-purple-200/70">NHA Digital Health Incentive Scheme ({d.currentMonth})</p>
              </div>
            </div>

            <button
              onClick={() => fetchOverview()}
              disabled={loading}
              title="Refresh DHIS Ledger"
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-purple-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Progress Bar towards 100 Transaction Threshold */}
          <div className="space-y-1.5 bg-black/20 p-3.5 rounded-lg border border-white/5">
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-purple-200/90 font-medium">Monthly Threshold Progress</span>
              <span className="font-mono font-bold text-white">
                <span className="text-emerald-400">{d.transactionsCount}</span> / {d.threshold} Txns ({d.progressPercent}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-white/10">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 via-indigo-400 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, d.progressPercent)}%` }}
              />
            </div>
            <p className="text-[11px] text-purple-200/60 flex items-center gap-1">
              {d.thresholdReached ? (
                <span className="text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 100-txn simulated threshold met (local stub — not a live payout).
                </span>
              ) : (
                <span>
                  {d.threshold - d.transactionsCount} more simulated transactions this month to reach the local-stub meter (not a live claim).
                </span>
              )}
            </p>
          </div>

          {/* Revenue Split Cards */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="flex items-center justify-between text-purple-200/70 text-[11px]">
                <span>Clinic Share (70%)</span>
                <Building2 className="w-3.5 h-3.5 text-purple-300" />
              </div>
              <div className="mt-1 font-mono font-bold text-lg text-emerald-400">
                ₹{d.clinicShare.toLocaleString('en-IN')}
              </div>
              <div className="text-[10px] text-purple-200/50">₹14 / qualifying txn</div>
            </div>

            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="flex items-center justify-between text-purple-200/70 text-[11px]">
                <span>Lumera Share (30%)</span>
                <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
              </div>
              <div className="mt-1 font-mono font-bold text-lg text-indigo-300">
                ₹{d.lumeraShare.toLocaleString('en-IN')}
              </div>
              <div className="text-[10px] text-purple-200/50">₹6 / qualifying txn</div>
            </div>
          </div>

          {/* Quick Simulation Trigger */}
          <div className="pt-1 flex items-center gap-2">
            <button
              onClick={() => handleSimulate('OP_CONSULT')}
              disabled={simulating}
              className="flex-1 text-xs py-2 px-3 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white rounded-lg font-medium transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {simulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
              <span>Simulate sandbox txn (+₹20)</span>
            </button>
          </div>

          {lastActionMessage && (
            <div className="text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1.5 rounded text-center animate-fade-in font-medium">
              {lastActionMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full Expanded View (For dedicated ABDM / DHIS admin tab)
  return (
    <div className="space-y-6">
      {/* Top Banner with ABDM Status & Scheme Info */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-700">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900 font-manrope">
                    ABDM v3 Gateway & DHIS Incentive Automation
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> NHA sandbox
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  Ayushman Bharat Digital Mission (ABDM) M1–M3 path — local stub / NHA sandbox (not a live incentive claim)
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchOverview()}
              disabled={loading}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Ledger</span>
            </button>
            <a
              href="https://sandbox.abdm.gov.in"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
            >
              <span>ABDM Sandbox Portal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Milestone / Audit Checklist Badges */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold text-slate-700">M1: Bridge OAuth</span>
            </div>
            <span className="font-mono text-xs font-bold text-slate-900 block">/v3/bridgesession</span>
            <span className="text-[11px] text-slate-500">Local stub session</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold text-slate-700">M2: Aadhaar e-KYC</span>
            </div>
            <span className="font-mono text-xs font-bold text-slate-900 block">ABHA Creation & QR</span>
            <span className="text-[11px] text-slate-500">NHA sandbox path</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold text-slate-700">M3: NRCeS FHIR R4</span>
            </div>
            <span className="font-mono text-xs font-bold text-slate-900 block">4 Clinical Bundles</span>
            <span className="text-[11px] text-slate-500">Sample bundles (local stub)</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold text-slate-700">M4: ECDH + GCM</span>
            </div>
            <span className="font-mono text-xs font-bold text-slate-900 block">Diffie-Hellman P-256</span>
            <span className="text-[11px] text-slate-500">Zero-Knowledge Encrypted</span>
          </div>
        </div>
      </div>

      {/* Main Meter Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8 Cols: DHIS Threshold Progress & Revenue Split */}
        <div className="lg:col-span-8 space-y-6">
          {/* Progress Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Monthly Threshold Tracker: Month of {d.currentMonth}
                </h3>
                <p className="text-xs text-slate-500">
                  NHA guidelines mandate minimum 100 ABDM-linked health records/month to qualify for direct incentive disbursements.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-bold font-mono ${
                  d.thresholdReached 
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}>
                  {d.thresholdReached ? 'THRESHOLD UNLOCKED' : `${d.threshold - d.transactionsCount} TO UNLOCK`}
                </span>
              </div>
            </div>

            {/* Visual Progress Bar */}
            <div className="space-y-2 mt-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center text-sm">
                <span className="font-semibold text-slate-700">Simulated transactions logged (local stub)</span>
                <span className="font-mono font-bold text-slate-900">
                  <span className="text-purple-600 text-lg">{d.transactionsCount}</span> / {d.threshold} txns
                </span>
              </div>
              <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden p-0.5 border border-slate-300">
                <div 
                  className="h-full bg-gradient-to-r from-purple-600 via-indigo-500 to-emerald-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2 text-[10px] font-bold text-white"
                  style={{ width: `${Math.min(100, d.progressPercent)}%` }}
                >
                  {d.progressPercent >= 15 ? `${d.progressPercent}%` : ''}
                </div>
              </div>
              <div className="flex justify-between items-center text-[11px] text-slate-500 pt-1">
                <span>0 txns</span>
                <span className="font-bold text-purple-700">Target: 100 Qualified Records</span>
                <span>250+ (Max tier)</span>
              </div>
            </div>

            {/* Split Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Total Earned</span>
                  <Coins className="w-4 h-4 text-purple-600" />
                </div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  ₹{d.totalIncentiveEarned.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">₹20 per verified transaction</div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <div className="flex items-center justify-between text-xs text-emerald-700">
                  <span className="font-bold">Facility / Clinic Share (70%)</span>
                  <Building2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
                  ₹{d.clinicShare.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-emerald-600 mt-0.5">₹14 per transaction direct to clinic account</div>
              </div>

              <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200">
                <div className="flex items-center justify-between text-xs text-indigo-700">
                  <span className="font-bold">Lumera Digital Solution (30%)</span>
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="text-2xl font-bold font-mono text-indigo-700 mt-1">
                  ₹{d.lumeraShare.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-indigo-600 mt-0.5">₹6 per transaction for EMR/ABDM SaaS</div>
              </div>
            </div>

            {/* Breakdown by clinical artifact type */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Transaction Volume by Clinical Artifact
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="text-slate-500 block text-[11px]">OPD Consultations</span>
                  <span className="font-bold text-base text-slate-900 font-mono">{d.breakdown.OP_CONSULT}</span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">₹{d.breakdown.OP_CONSULT * 20}</span>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="text-slate-500 block text-[11px]">Tele-Prescriptions</span>
                  <span className="font-bold text-base text-slate-900 font-mono">{d.breakdown.PRESCRIPTION}</span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">₹{d.breakdown.PRESCRIPTION * 20}</span>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="text-slate-500 block text-[11px]">Diagnostic Reports</span>
                  <span className="font-bold text-base text-slate-900 font-mono">{d.breakdown.DIAGNOSTIC_REPORT}</span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">₹{d.breakdown.DIAGNOSTIC_REPORT * 20}</span>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="text-slate-500 block text-[11px]">Discharge Summaries</span>
                  <span className="font-bold text-base text-slate-900 font-mono">{d.breakdown.DISCHARGE_SUMMARY}</span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">₹{d.breakdown.DISCHARGE_SUMMARY * 20}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Simulated DHIS ledger (local stub) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-base text-slate-900">Recent DHIS simulated transactions</h3>
                <p className="text-xs text-slate-500">Local stub ledger — NHA sandbox-unverified, not a live incentive claim</p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {d.recentTransactions.length} records shown
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                    <th className="py-2.5 px-3">Transaction ID</th>
                    <th className="py-2.5 px-3">Artifact Type</th>
                    <th className="py-2.5 px-3">Patient ABHA</th>
                    <th className="py-2.5 px-3">FHIR Bundle</th>
                    <th className="py-2.5 px-3">Clinic (70%)</th>
                    <th className="py-2.5 px-3">Lumera (30%)</th>
                    <th className="py-2.5 px-3 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.recentTransactions.slice(0, 10).map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-[11px] font-medium text-slate-900">
                        {tx.id}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                          {tx.transaction_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                        {tx.abha_address || 'rajiv.saxena@abdm'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                        {tx.fhir_bundle_id || 'bundle-nrc-r4'}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                        ₹{tx.clinic_share}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-indigo-700">
                        ₹{tx.lumera_share}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400 font-mono text-[11px]">
                        {new Date(tx.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 4 Cols: Live Sandbox Simulation Controls & Configuration */}
        <div className="lg:col-span-4 space-y-6">
          {/* Simulation Playground */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Live Sandbox Simulator</h3>
                <p className="text-xs text-slate-500">Simulate ABDM events & earn +₹20</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Each clinical event serializes an NRCeS FHIR R4 Bundle, encrypts it via Diffie-Hellman ECDH, and logs an audited ₹20 transaction.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleSimulate('OP_CONSULT')}
                disabled={simulating}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50/50 transition-all flex items-center justify-between text-xs group"
              >
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-purple-700">
                    OPD Consultation
                  </div>
                  <div className="text-[11px] text-slate-500">OPConsultRecord profile</div>
                </div>
                <span className="font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                  +₹20
                </span>
              </button>

              <button
                onClick={() => handleSimulate('PRESCRIPTION')}
                disabled={simulating}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50/50 transition-all flex items-center justify-between text-xs group"
              >
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-purple-700">
                    Digital Prescription
                  </div>
                  <div className="text-[11px] text-slate-500">MedicationRequest + SNOMED</div>
                </div>
                <span className="font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                  +₹20
                </span>
              </button>

              <button
                onClick={() => handleSimulate('DIAGNOSTIC_REPORT')}
                disabled={simulating}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50/50 transition-all flex items-center justify-between text-xs group"
              >
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-purple-700">
                    Diagnostic Lab Report
                  </div>
                  <div className="text-[11px] text-slate-500">Observation + LOINC codes</div>
                </div>
                <span className="font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                  +₹20
                </span>
              </button>

              <button
                onClick={() => handleSimulate('DISCHARGE_SUMMARY')}
                disabled={simulating}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50/50 transition-all flex items-center justify-between text-xs group"
              >
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-purple-700">
                    Discharge Summary
                  </div>
                  <div className="text-[11px] text-slate-500">CarePlan + Encounter profile</div>
                </div>
                <span className="font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                  +₹20
                </span>
              </button>
            </div>

            {lastActionMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs flex items-center gap-2 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{lastActionMessage}</span>
              </div>
            )}
          </div>

          {/* Gateway Credentials Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-purple-600" />
              ABDM Sandbox Credentials
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">HFR Facility ID</span>
                <span className="font-mono font-bold text-slate-900">HFR-IN-8829104</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Facility Name</span>
                <span className="font-medium text-slate-900 text-right">Lumera Polyclinic</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Client ID</span>
                <span className="font-mono text-slate-700">SBX_LUMERA_HEALTH_2026</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Encryption Scheme</span>
                <span className="font-mono font-semibold text-purple-700">ECDH (prime256v1) + AES-GCM</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Disbursement Rail</span>
                <span className="font-semibold text-emerald-700">Simulated ledger (local stub)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
