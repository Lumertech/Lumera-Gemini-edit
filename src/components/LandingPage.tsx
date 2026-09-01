import React from 'react';
import { 
  Sparkles, 
  ArrowRight, 
  ShieldCheck, 
  Stethoscope, 
  Mic, 
  FileText, 
  Activity, 
  TrendingUp, 
  Building2, 
  CheckCircle2, 
  ExternalLink,
  ChevronRight,
  Zap,
  Globe2,
  Lock,
  Clock,
  Layers,
  HeartPulse,
  BrainCircuit,
  MessageSquare
} from 'lucide-react';

interface LandingPageProps {
  onEnterApp: (portal?: 'clinician' | 'admin' | 'patient') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterApp }) => {
  return (
    <div className="h-full w-full overflow-y-auto bg-slate-950 text-slate-100 font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-900/60 via-indigo-900/40 to-slate-900 border-b border-slate-800/80 px-4 py-2 text-center text-xs text-slate-300 flex items-center justify-center gap-2">
        <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30 text-[10px]">
          NEW V2.4
        </span>
        <span>ABDM Compliant • Multilingual Ambient Scribe • Specialty Modules</span>
        <a 
          href="https://lumera.me" 
          target="_blank" 
          rel="noreferrer"
          className="text-blue-400 hover:text-blue-300 font-semibold inline-flex items-center gap-0.5 ml-2"
        >
          Visit lumera.me <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center space-y-6 max-w-4xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-blue-400 text-xs font-semibold shadow-inner">
            <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
            <span>Next-Gen Healthcare Intelligence & Clinical Operating System</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight">
            The AI-Native EMR & <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-cyan-400">
              Practice Operating Suite
            </span>
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Eliminate hours of manual charting. Lumera listens to multilingual doctor-patient consultations, extracts structured clinical SOAP notes, powers specialty workflows, and automates patient engagement.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <button
              onClick={() => onEnterApp('clinician')}
              className="px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/30 flex items-center space-x-2"
            >
              <Stethoscope className="w-4 h-4" />
              <span>Launch Clinician Suite</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onEnterApp('admin')}
              className="px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-sm transition-all flex items-center space-x-2"
            >
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>Admin Console</span>
            </button>

            <button
              onClick={() => onEnterApp('patient')}
              className="px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-sm transition-all flex items-center space-x-2"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Patient EMR Portal</span>
            </button>
          </div>
        </div>

        {/* Hero Interactive Feature Highlights Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 max-w-6xl mx-auto">
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 space-y-3 hover:border-blue-500/50 transition-all">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Multilingual Ambient Scribe</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Real-time code-switching transcription across Hinglish, Hindi, Marathi, Tamil, and Telugu with automatic clinical entity normalization into structured SOAP fields.
            </p>
          </div>

          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 space-y-3 hover:border-emerald-500/50 transition-all">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Activity className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">AI OCR & Longitudinal Trends</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Instant scan-and-extract for printed pathology PDFs, automated renal dose-adjustment safety guardrails, and time-series biometric tracking.
            </p>
          </div>

          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 space-y-3 hover:border-indigo-500/50 transition-all">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">8+ Specialty Workflows</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Interactive 32-tooth odontogram, joint ROM & VAS trajectory tracker, dual-eye refraction matrices, and automated Naegele's rule OB-GYN tracker.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Deep Dive Section */}
      <section className="bg-slate-900/50 border-t border-slate-800 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              Engineered for Modern Clinics & Polyclinic Hospitals
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto">
              A comprehensive clinical suite uniting patient intake, doctor consultations, smart diagnostics, pharmacy inventory, and automated billing.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: HeartPulse,
                title: 'Queue & Waiting TV',
                desc: 'Real-time multi-doctor token display, multi-lingual audio chimes, and ABHA QR self-checkin.',
                action: () => onEnterApp('clinician'),
              },
              {
                icon: FileText,
                title: 'Smart Digital Rx',
                desc: '1,000+ curated Indian brand molecules, drug-interaction warnings, and instant WhatsApp PDF delivery.',
                action: () => onEnterApp('clinician'),
              },
              {
                icon: BrainCircuit,
                title: 'HEXA AI Decision Support',
                desc: 'AI co-pilot for differential diagnoses, contraindication screening, and clinical guidelines.',
                action: () => onEnterApp('clinician'),
              },
              {
                icon: Building2,
                title: 'Admin & Role Security',
                desc: 'Doctor rosters, clinic branch locations, audit trails, and granular RBAC controls.',
                action: () => onEnterApp('admin'),
              },
            ].map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div 
                  key={i} 
                  onClick={feature.action}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2.5 hover:border-slate-700 cursor-pointer transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-800 text-blue-400 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-sm text-white flex items-center justify-between">
                    <span>{feature.title}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white transition-colors" />
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-300">Lumera Health Systems</span>
            <span>•</span>
            <span>Clinical Practice Suite</span>
          </div>
          <div className="flex items-center space-x-4">
            <a href="https://lumera.me" target="_blank" rel="noreferrer" className="hover:text-slate-300 transition-colors">
              www.lumera.me
            </a>
            <span>•</span>
            <span>ABDM / NDHM Compliant</span>
            <span>•</span>
            <span>ISO 27001 Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
