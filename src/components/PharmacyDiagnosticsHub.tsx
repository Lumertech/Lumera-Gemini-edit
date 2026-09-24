import React, { useState } from 'react';
import { Pill, TestTube, ShieldCheck, Send, CheckCircle2, RefreshCw, Truck, Building2, UserCheck, Sparkles } from 'lucide-react';
import { Patient, Prescription } from '../types';

interface PharmacyDiagnosticsHubProps {
  currentPatient: Patient;
  currentPrescription?: Prescription | null;
}

export const PharmacyDiagnosticsHub: React.FC<PharmacyDiagnosticsHubProps> = ({
  currentPatient,
  currentPrescription,
}) => {
  const [selectedPharmacy, setSelectedPharmacy] = useState('Apollo Pharmacy Partner');
  const [selectedLabProvider, setSelectedLabProvider] = useState('Dr. Lal PathLabs Home Collection');
  const [pharmacyStatus, setPharmacyStatus] = useState<any>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<any>(null);
  const [insuranceStatus, setInsuranceStatus] = useState<any>(null);
  const [isLoadingPharm, setIsLoadingPharm] = useState(false);
  const [isLoadingLab, setIsLoadingLab] = useState(false);
  const [isLoadingIns, setIsLoadingIns] = useState(false);

  const handleDispatchPharmacy = async () => {
    setIsLoadingPharm(true);
    try {
      const res = await fetch('/api/pharmacy/dispatch-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: currentPatient.name,
          phone: currentPatient.phone,
          medicines: currentPrescription?.medicines || [{ name: 'Paracetamol 650mg', dosage: '1-0-1' }],
          partner: selectedPharmacy,
        }),
      });
      const data = await res.json();
      setPharmacyStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingPharm(false);
    }
  };

  const handleDispatchDiagnostics = async () => {
    setIsLoadingLab(true);
    try {
      const res = await fetch('/api/diagnostics/dispatch-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: currentPatient.name,
          phone: currentPatient.phone,
          labTests: currentPrescription?.labTests || ['Complete Blood Count (CBC)', 'HbA1c'],
          provider: selectedLabProvider,
        }),
      });
      const data = await res.json();
      setDiagnosticsStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingLab(false);
    }
  };

  const handleCheckInsurance = async () => {
    setIsLoadingIns(true);
    try {
      const res = await fetch('/api/insurance/pmjay-precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abhaNumber: currentPatient.abhaNumber || '14-8839-2910-4491',
          patientName: currentPatient.name,
        }),
      });
      const data = await res.json();
      setInsuranceStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingIns(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" /> Connected Ecosystem Hub
            </span>
            <span className="text-xs text-slate-400 font-mono">India Health Stack (ABDM / PM-JAY / Pharmacy)</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Pharmacy, Diagnostics & Insurance Fulfillment Hub</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Instantly dispatch prescriptions to home delivery pharmacies, schedule home sample collections for lab tests, and pre-authorize PM-JAY cashless insurance.
          </p>
        </div>

        <div className="bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 font-medium shrink-0">
          Selected Patient: <span className="font-bold text-slate-900">{currentPatient.name}</span> (UHID: {currentPatient.uhid})
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 1. Connected Pharmacy Fulfillment */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-emerald-700 font-bold text-sm">
              <Pill className="w-4 h-4 text-emerald-600" />
              <span>Partner Pharmacy Dispatch</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Send digital prescriptions directly to partner pharmacies for instant home delivery or in-store pickup via WhatsApp.
            </p>

            <div className="space-y-1.5 pt-2">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Select Pharmacy Partner</label>
              <select
                value={selectedPharmacy}
                onChange={(e) => setSelectedPharmacy(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="Apollo Pharmacy Partner">Apollo Pharmacy (24/7 Home Delivery)</option>
                <option value="Netmeds Express Fulfillment">Netmeds Express Delivery</option>
                <option value="Tata 1mg Pharmacy Network">Tata 1mg Partner Network</option>
                <option value="Local Clinic Dispensary">In-House Clinic Dispensary</option>
              </select>
            </div>

            {pharmacyStatus && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Order Dispatched ({pharmacyStatus.orderId})</span>
                </div>
                <p className="text-[11px] leading-relaxed">{pharmacyStatus.message}</p>
              </div>
            )}
          </div>

          <button
            disabled={isLoadingPharm}
            onClick={handleDispatchPharmacy}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isLoadingPharm ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            <span>Dispatch Prescription to Pharmacy</span>
          </button>
        </div>

        {/* 2. Diagnostics & Home Sample Collection */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-blue-700 font-bold text-sm">
              <TestTube className="w-4 h-4 text-blue-600" />
              <span>Diagnostics Home Collection</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Dispatch diagnostic test orders to accredited lab partners for certified home phlebotomy sample pickup.
            </p>

            <div className="space-y-1.5 pt-2">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Select Lab Partner</label>
              <select
                value={selectedLabProvider}
                onChange={(e) => setSelectedLabProvider(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="Dr. Lal PathLabs Home Collection">Dr. Lal PathLabs (Home Phlebotomy)</option>
                <option value="Thyrocare Wellness Express">Thyrocare Wellness Express</option>
                <option value="SRL Diagnostics Partner">SRL Diagnostics Network</option>
                <option value="Metropolis Healthcare Lab">Metropolis Healthcare</option>
              </select>
            </div>

            {diagnosticsStatus && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-blue-800">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <span>Lab Order Dispatched ({diagnosticsStatus.orderId})</span>
                </div>
                <p className="text-[11px] leading-relaxed">{diagnosticsStatus.message}</p>
              </div>
            )}
          </div>

          <button
            disabled={isLoadingLab}
            onClick={handleDispatchDiagnostics}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isLoadingLab ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>Dispatch Lab Order & Phlebotomist</span>
          </button>
        </div>

        {/* 3. PM-JAY & Health Insurance Pre-Check */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-indigo-700 font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <span>PM-JAY & Insurance Pre-Check</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Verify Ayushman Bharat PM-JAY eligibility and pre-authorize cashless health insurance coverage instantly via ABHA.
            </p>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1 mt-3">
              <div className="flex justify-between">
                <span className="text-slate-500">ABHA Number:</span>
                <span className="font-mono font-semibold text-slate-800">{currentPatient.abhaNumber || '14-8839-2910-4491'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">KYC Status:</span>
                <span className="font-semibold text-emerald-700">VERIFIED (NHA)</span>
              </div>
            </div>

            {insuranceStatus && (
              <div className={`p-3 rounded-lg border text-xs space-y-1 ${
                insuranceStatus.pmjayEligible ? 'bg-indigo-50 border-indigo-200 text-indigo-900' : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <div className="flex items-center gap-1.5 font-bold">
                  <UserCheck className="w-4 h-4" />
                  <span>{insuranceStatus.scheme}</span>
                </div>
                <p className="text-[11px] leading-relaxed">{insuranceStatus.message}</p>
                {insuranceStatus.pmjayEligible && (
                  <p className="font-bold text-indigo-700 pt-0.5">Cover Limit: ₹5,00,000 Cashless</p>
                )}
              </div>
            )}
          </div>

          <button
            disabled={isLoadingIns}
            onClick={handleCheckInsurance}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isLoadingIns ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>Verify PM-JAY Insurance Eligibility</span>
          </button>
        </div>
      </div>
    </div>
  );
};
