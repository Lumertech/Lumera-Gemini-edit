import React, { useEffect, useState } from "react";
import {
  Shield,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  FileText,
  Lock,
  Trash2,
  ExternalLink,
  Search,
  Printer,
  Copy,
  Mail,
  Building,
} from "lucide-react";
import { useNav } from "../nav/NavigationContext";

export const PolicyPage: React.FC<{ slug: string }> = ({ slug: initialSlug }) => {
  const { go } = useNav();
  const [currentSlug, setCurrentSlug] = useState(initialSlug || "privacy-policy");
  const [title, setTitle] = useState("Legal & Compliance");
  const [body, setBody] = useState("Loading policy documentation…");
  const [updatedAt, setUpdatedAt] = useState("");
  const [copied, setCopied] = useState(false);

  // Live Deletion Checker State
  const [checkCode, setCheckCode] = useState("");
  const [deletionStatus, setDeletionStatus] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);

  // Normalize slug
  const activeTab = currentSlug.includes("data-deletion")
    ? "data-deletion"
    : currentSlug.includes("terms")
    ? "terms"
    : "privacy";

  const fetchPolicy = (s: string) => {
    fetch(`/api/public/policies/${s}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setTitle(d.title);
        setBody(d.body);
        setUpdatedAt(d.updated_at || "");
      })
      .catch(() => {
        setTitle("Policy Document");
        setBody("Documentation is currently being refreshed. Please check back shortly or email compliance@lumera.health.");
      });
  };

  useEffect(() => {
    const slugToLoad =
      currentSlug === "privacy"
        ? "privacy-policy"
        : currentSlug === "terms"
        ? "terms-of-service"
        : currentSlug === "data-deletion"
        ? "data-deletion-instructions"
        : currentSlug;
    fetchPolicy(slugToLoad);
  }, [currentSlug]);

  const handleCheckDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkCode.trim()) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/meta/data-deletion-status?code=${encodeURIComponent(checkCode.trim())}`);
      const data = await res.json();
      setDeletionStatus(data);
    } catch {
      setDeletionStatus({ error: "Failed to connect to compliance registry" });
    } finally {
      setChecking(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="public-policy"
      className="h-full overflow-y-auto bg-slate-50 text-slate-900 flex flex-col font-sans"
    >
      {/* Top Compliance Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => go("landing", { explicitPublic: true })}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Lumera
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center text-white">
                <Shield className="w-3.5 h-3.5" />
              </div>
              <span className="font-bold text-sm text-slate-900 tracking-tight">Lumera Compliance Hub</span>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <AlertCircle className="w-3 h-3" /> Meta WhatsApp — not Tech Provider certified
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
              title="Copy Page URL"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? "Copied Link!" : "Share Link"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
              title="Print Document"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        </div>
      </header>

      {/* Hero Strip */}
      <div className="bg-gradient-to-b from-white to-slate-50 border-b border-slate-200/80 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Governance documentation for Lumera Health Clinical OS, WhatsApp Cloud API integration (not Tech Provider certified), and data protection.
            </p>
            {updatedAt && (
              <div className="mt-3 text-xs text-slate-400">
                Last statutory revision: {new Date(updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </div>
            )}
          </div>

          {/* Policy Switcher Tabs */}
          <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200/60 pb-1">
            <button
              type="button"
              onClick={() => setCurrentSlug("privacy-policy")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-lg text-xs font-bold transition border-b-2 ${
                activeTab === "privacy"
                  ? "border-emerald-600 text-emerald-700 bg-white shadow-xs"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              <Lock className="w-3.5 h-3.5" /> Privacy Policy &amp; Meta Scope
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlug("terms-of-service")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-lg text-xs font-bold transition border-b-2 ${
                activeTab === "terms"
                  ? "border-emerald-600 text-emerald-700 bg-white shadow-xs"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Terms of Service
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlug("data-deletion-instructions")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-lg text-xs font-bold transition border-b-2 ${
                activeTab === "data-deletion"
                  ? "border-emerald-600 text-emerald-700 bg-white shadow-xs"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" /> Data Deletion Instructions
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Document Body (2 Columns) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-xs">
            <article className="prose prose-slate max-w-none text-sm leading-relaxed whitespace-pre-wrap font-sans text-slate-800">
              {body}
            </article>
          </div>
        </div>

        {/* Sidebar: Compliance Verification & Tools (1 Column) */}
        <div className="space-y-5">
          {/* Data Deletion Status Tracker */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Check Deletion Status</h3>
                <p className="text-[11px] text-slate-500">Verify execution of a confirmation code</p>
              </div>
            </div>

            <form onSubmit={handleCheckDeletion} className="space-y-2">
              <input
                type="text"
                value={checkCode}
                onChange={(e) => setCheckCode(e.target.value)}
                placeholder="Enter DEL-XXXX confirmation code"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 uppercase"
              />
              <button
                type="submit"
                disabled={checking}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {checking ? "Checking Registry..." : "Verify Erasure Status"}
              </button>
            </form>

            {deletionStatus && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs font-mono text-slate-800 space-y-1">
                <div className="text-emerald-700 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {deletionStatus.status || "CONFIRMED"}
                </div>
                <div className="text-[11px] text-slate-600">{deletionStatus.message}</div>
                {deletionStatus.confirmationCode && (
                  <div className="text-[10px] text-slate-400">Code: {deletionStatus.confirmationCode}</div>
                )}
              </div>
            )}
          </div>

          {/* Meta Tech Provider Badging & Authority */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl p-5 shadow-md space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Statutory Notice</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Lumera Health is building a WhatsApp Cloud API integration. This is not Meta Tech Provider certification and App Review is not submitted. Policies below describe intended processing:
            </p>
            <ul className="text-xs space-y-1.5 text-slate-200">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Meta WhatsApp Business Messaging Policy
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                India DPDP Act &amp; ABDM Health Standards
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                TLS 1.3 End-to-End Edge Encryption
              </li>
            </ul>
          </div>

          {/* Designated DPO Contacts */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs text-slate-600">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-700" />
              Designated Compliance Officer
            </h4>
            <div className="space-y-1">
              <div className="text-slate-900 font-medium">Data Protection Office (DPO)</div>
              <div>Lumera Solutions LLP</div>
              <div className="text-emerald-700 font-mono">dpo@lumera.me</div>
              <div className="text-slate-500 font-mono">compliance@lumera.health</div>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
              SLA for regulatory data requests: Under 48 hours.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
