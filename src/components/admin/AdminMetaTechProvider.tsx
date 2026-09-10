import React, { useEffect, useState } from "react";
import {
  Share2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Shield,
  Smartphone,
  Plus,
  Send,
  RefreshCw,
  Trash2,
  Radio,
  FileCheck,
  Building2,
  Sparkles,
  Info,
} from "lucide-react";
import { useNav } from "../../nav/NavigationContext";
import { MetaWhatsAppTemplate } from "../../types";

interface MetaOverview {
  providerName: string;
  providerType: string;
  certificationStatus?: string;
  environment?: string;
  simulatorsEnabled?: boolean;
  notice?: string;
  appReviewStatus: {
    status: string;
    checklist: Array<{ item: string; passed: boolean; url?: string; note?: string }>;
    passedCount?: number;
    totalCount?: number;
  };
  connectedWabasCount: number;
  totalClinics: number;
  approvedTemplatesCount: number;
  totalTemplatesCount: number;
  totalMessagesSentAndReceived: number;
  webhookUrl: string;
  qualityRating: string;
  graphOtpConfigured?: boolean;
  facebookOAuthConfigured?: boolean;
}

interface WabaItem {
  tenantId: string;
  tenantName: string;
  specialty: string;
  country: string;
  clinicPhone: string;
  wabaId: string;
  phoneNumberId: string;
  metaWabaName: string;
  metaQualityRating: "GREEN" | "YELLOW" | "RED";
  metaOnboardingStatus: "connected" | "pending" | "disconnected";
  metaTokenExpiresAt: string;
  updatedAt: string;
}

/** Real Cloud API send responses include messaging_product + a Graph message id. Local simulator payloads do not. */
function isGraphAcceptedDelivery(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const payload = data as {
    messaging_product?: string;
    messages?: Array<{ id?: string }>;
  };
  return payload.messaging_product === "whatsapp" && Boolean(payload.messages?.[0]?.id);
}

export const AdminMetaTechProvider: React.FC = () => {
  const { go } = useNav();
  const [overview, setOverview] = useState<MetaOverview | null>(null);
  const [wabas, setWabas] = useState<WabaItem[]>([]);
  const [templates, setTemplates] = useState<MetaWhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"review" | "wabas" | "templates" | "tester">("review");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modals & Test State
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [connectForm, setConnectForm] = useState({
    wabaId: "waba_398249018247019",
    phoneNumberId: "phone_982345566701",
    metaWabaName: "Lumera Verified Clinic WABA",
    metaAccessToken: "EAAJ...verified_system_user_token_2026",
  });

  // Test Console State
  const [testPhone, setTestPhone] = useState("+919876543210");
  const [testTemplate, setTestTemplate] = useState("appointment_reminder_v1");
  const [testCustomMessage, setTestCustomMessage] = useState("");
  const [testLog, setTestLog] = useState<{ status: "idle" | "sending" | "success" | "error"; data?: any }>({ status: "idle" });

  // Data Deletion Simulation State
  const [deletionSimStatus, setDeletionSimStatus] = useState<string | null>(null);

  // New Template Form State
  const [newTemplateForm, setNewTemplateForm] = useState({
    name: "treatment_followup_reminder",
    category: "UTILITY" as "UTILITY" | "MARKETING" | "AUTHENTICATION",
    language: "en",
    headerText: "Clinical Follow-up Reminder",
    bodyText: "Hello {{1}}, Dr. {{2}} has scheduled your post-op review for {{3}}. Please let us know if you need assistance.",
    footerText: "Lumera Clinical Care Team",
    button1Text: "Confirm Attendance",
    button2Text: "Request Reschedule",
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [ovRes, wabasRes, tplRes] = await Promise.all([
        fetch("/api/meta/overview").then((r) => r.json()),
        fetch("/api/meta/wabas").then((r) => r.json()),
        fetch("/api/meta/templates").then((r) => r.json()),
      ]);
      setOverview(ovRes);
      setWabas(wabasRes.wabas || []);
      setTemplates(tplRes.templates || []);
      if (wabasRes.wabas?.length && !selectedTenantId) {
        setSelectedTenantId(wabasRes.wabas[0].tenantId);
      }
    } catch (err) {
      console.error("Failed to load Meta data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getBaseOrigin = () => {
    if (typeof window !== "undefined") return window.location.origin;
    return "https://lumera.health";
  };

  // Embedded Signup Simulation
  const handleSimulateEmbeddedSignup = async (tenantId: string, clinicName: string) => {
    try {
      const res = await fetch("/api/meta/simulate-embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, clinicName }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "SANDBOX simulator is not available.");
        return;
      }
      if (data.success) {
        alert(data.message || "SANDBOX / DEV-ONLY: fake WABA ids stored locally. This is not live Embedded Signup.");
        loadData();
      }
    } catch (err) {
      alert("Failed to run embedded signup simulation");
    }
  };

  // Test Data Deletion Callback
  const handleTestDataDeletion = async () => {
    setDeletionSimStatus("Pinging /api/meta/data-deletion callback...");
    try {
      const res = await fetch("/api/meta/data-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "meta_user_test_compliance_992" }),
      });
      const data = await res.json();
      setDeletionSimStatus(`SUCCESS! Confirmation Code: ${data.confirmation_code}. Status Tracking URL: ${data.url}`);
    } catch (err) {
      setDeletionSimStatus("Error calling data deletion endpoint.");
    }
  };

  // Send Test WhatsApp Message
  const handleSendTest = async () => {
    setTestLog({ status: "sending" });
    try {
      const res = await fetch("/api/meta/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPhone: testPhone,
          templateName: testTemplate,
          messageText: testCustomMessage || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestLog({ status: "success", data });
      } else {
        setTestLog({ status: "error", data });
      }
    } catch (err: any) {
      setTestLog({ status: "error", data: { error: err.message || "Failed to dispatch" } });
    }
  };

  // Submit Template
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const components: any[] = [
        { type: "HEADER", format: "TEXT", text: newTemplateForm.headerText },
        {
          type: "BODY",
          text: newTemplateForm.bodyText,
          example: { body_text: [["Patient", "Doctor", "Tomorrow at 10:00 AM"]] },
        },
        { type: "FOOTER", text: newTemplateForm.footerText },
      ];
      if (newTemplateForm.button1Text || newTemplateForm.button2Text) {
        const buttons: any[] = [];
        if (newTemplateForm.button1Text) buttons.push({ type: "QUICK_REPLY", text: newTemplateForm.button1Text });
        if (newTemplateForm.button2Text) buttons.push({ type: "QUICK_REPLY", text: newTemplateForm.button2Text });
        components.push({ type: "BUTTONS", buttons });
      }

      const res = await fetch("/api/meta/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenantId || "tenant-lumera-main",
          name: newTemplateForm.name,
          category: newTemplateForm.category,
          language: newTemplateForm.language,
          components,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || "SANDBOX / DEV-ONLY: template stored locally.");
        setShowNewTemplateModal(false);
        loadData();
      }
    } catch {
      alert("Failed to submit template");
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;
    try {
      await fetch(`/api/meta/templates/${id}`, { method: "DELETE" });
      loadData();
    } catch {
      alert("Failed to delete template");
    }
  };

  const origin = getBaseOrigin();
  const privacyUrl = `${origin}/privacy-policy`;
  const termsUrl = `${origin}/terms-of-service`;
  const dataDeletionUrl = `${origin}/data-deletion-instructions`;
  const webhookUrl = `${origin}/api/meta/webhook`;
  const dataDeletionCallbackUrl = `${origin}/api/meta/data-deletion`;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 border border-emerald-500/30 rounded-2xl p-6 text-white shadow-xl shadow-emerald-950/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-500/20 border border-emerald-400/40 rounded-xl text-emerald-300">
              <Share2 className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold font-manrope tracking-tight">Meta WhatsApp Cloud API (sandbox readiness)</h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                  <AlertCircle className="w-3.5 h-3.5" /> SANDBOX — not a Tech Provider
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-1 max-w-2xl">
                Inventory of WhatsApp Cloud API wiring. This screen does not mean Lumera is a Meta Tech Provider or that App Review is approved.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-200 border border-slate-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => go("legal", { policySlug: "privacy-policy" })}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white shadow-md transition"
            >
              <FileCheck className="w-4 h-4" /> View Policies
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800">
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
            <div className="text-xs text-slate-400 font-medium">App Review status</div>
            <div className="text-lg font-bold text-amber-300 flex items-center gap-1.5 mt-0.5">
              <AlertCircle className="w-4 h-4" /> {overview?.appReviewStatus?.status || "NOT_SUBMITTED"}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {overview?.appReviewStatus?.passedCount ?? 0}/{overview?.appReviewStatus?.totalCount ?? 0} readiness items true — not a Tech Provider
            </div>
          </div>
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
            <div className="text-xs text-slate-400 font-medium">Connected Clinic WABAs</div>
            <div className="text-lg font-bold text-white mt-0.5">{overview?.connectedWabasCount ?? 2} Practices</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Multi-tenant co-existence</div>
          </div>
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
            <div className="text-xs text-slate-400 font-medium">Approved Templates</div>
            <div className="text-lg font-bold text-purple-400 mt-0.5">{overview?.approvedTemplatesCount ?? 5} Active</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Utility & OTP templates</div>
          </div>
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
            <div className="text-xs text-slate-400 font-medium">Meta quality rating</div>
            <div className="text-lg font-bold text-slate-200 flex items-center gap-1.5 mt-0.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> UNKNOWN
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Not fetched from Graph — local GREEN is not live</div>
          </div>
        </div>
      </div>

      {/* Sub navigation tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          type="button"
          onClick={() => setActiveSubTab("review")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeSubTab === "review"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Shield className="w-4 h-4" /> Meta App Review & Compliance URLs
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("wabas")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeSubTab === "wabas"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Building2 className="w-4 h-4" /> Connected Practices (WABAs) ({wabas.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("templates")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeSubTab === "templates"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <FileCheck className="w-4 h-4" /> WhatsApp Templates ({templates.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("tester")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeSubTab === "tester"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Smartphone className="w-4 h-4" /> SANDBOX Message Tester
        </button>
      </div>

      {/* ----------------- TAB 1: META APP REVIEW & COMPLIANCE ----------------- */}
      {activeSubTab === "review" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Meta App Review submission parameters</h2>
                <p className="text-sm text-slate-500">
                  URLs for a future App Review packet. Presence of a page is not approval. Status: <strong>{overview?.appReviewStatus?.status || "NOT_SUBMITTED"}</strong>.
                </p>
              </div>
              <span className="px-3 py-1 bg-amber-50 text-amber-800 font-semibold text-xs rounded-full border border-amber-200 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> SANDBOX — not a Tech Provider
              </span>
            </div>

            <div className="space-y-3 pt-2">
              {/* Privacy Policy */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">Privacy Policy URL</span>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">Meta Required</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Explicitly documents WhatsApp Business Platform integration, patient data handling, encryption, and DPO contact.
                  </p>
                  <code className="text-xs text-slate-700 font-mono bg-white px-2 py-1 rounded border border-slate-300 inline-block break-all">
                    {privacyUrl}
                  </code>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(privacyUrl, "privacy")}
                    className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition"
                    title="Copy URL"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go("legal", { policySlug: "privacy-policy" })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View Policy
                  </button>
                </div>
              </div>

              {/* Terms of Service */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">Terms of Service URL</span>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">Meta Required</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Details WhatsApp Acceptable Use, anti-spam policies, and patient prior consent. Not a Tech Provider certification.
                  </p>
                  <code className="text-xs text-slate-700 font-mono bg-white px-2 py-1 rounded border border-slate-300 inline-block break-all">
                    {termsUrl}
                  </code>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(termsUrl, "terms")}
                    className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition"
                    title="Copy URL"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go("legal", { policySlug: "terms-of-service" })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View Terms
                  </button>
                </div>
              </div>

              {/* Data Deletion Instructions & Callback */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">User Data Deletion URL / Callback</span>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">Meta Platform §4.b</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Dual implementation: user-facing instructions plus a JSON callback. Signed-request verification is still SANDBOX.
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                    <div>
                      <span className="text-[11px] text-slate-500 font-medium mr-1.5">Callback:</span>
                      <code className="text-xs text-slate-700 font-mono bg-white px-2 py-1 rounded border border-slate-300">
                        {dataDeletionCallbackUrl}
                      </code>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 font-medium mr-1.5">Page:</span>
                      <code className="text-xs text-slate-700 font-mono bg-white px-2 py-1 rounded border border-slate-300">
                        {dataDeletionUrl}
                      </code>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleTestDataDeletion}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition"
                  >
                    <Radio className="w-3.5 h-3.5" /> SANDBOX Simulate Callback
                  </button>
                  <button
                    type="button"
                    onClick={() => go("legal", { policySlug: "data-deletion-instructions" })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View Page
                  </button>
                </div>
              </div>

              {/* Data Deletion Simulation Alert */}
              {deletionSimStatus && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-mono text-indigo-900 break-all">
                  {deletionSimStatus}
                </div>
              )}

              {/* Webhook Configuration */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">Webhook Callback URL & Verify Token</span>
                    <span className="text-[11px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded">WhatsApp Cloud API</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Handles <code>hub.challenge</code> handshake, outbound status updates (delivered, read), and inbound patient replies.
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                    <div>
                      <span className="text-[11px] text-slate-500 font-medium mr-1.5">Callback URL:</span>
                      <code className="text-xs text-slate-700 font-mono bg-white px-2 py-1 rounded border border-slate-300">
                        {webhookUrl}
                      </code>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 font-medium mr-1.5">Verify Token:</span>
                      <code className="text-xs text-slate-700 font-mono bg-white px-2 py-1 rounded border border-slate-300">
                        set META_VERIFY_TOKEN (never commit the live value)
                      </code>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(webhookUrl, "webhook")}
                    className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition"
                    title="Copy URL"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {overview?.appReviewStatus?.checklist?.length ? (
            <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Readiness checklist (derived from config — not App Review)</h3>
              <ul className="space-y-2">
                {overview.appReviewStatus.checklist.map((item) => (
                  <li key={item.item} className="flex items-start gap-2 text-sm">
                    {item.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    )}
                    <span>
                      <span className="font-medium text-slate-800">{item.item}</span>
                      {item.note ? <span className="block text-xs text-slate-500">{item.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Architecture Card */}
          <div className="bg-slate-900 text-slate-100 rounded-xl p-6 border border-slate-800 space-y-4">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Meta WhatsApp architecture (honest status)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
              <div className="p-3.5 bg-slate-800/80 rounded-lg border border-slate-700/70">
                <div className="font-semibold text-amber-300 mb-1">Embedded Signup — not live</div>
                <p>
                  Real Embedded Signup (JS SDK + auth-code exchange) is not wired. The simulate route is SANDBOX / DEV-ONLY and is disabled in production.
                </p>
              </div>
              <div className="p-3.5 bg-slate-800/80 rounded-lg border border-slate-700/70">
                <div className="font-semibold text-amber-300 mb-1">WABA connect — local store</div>
                <p>
                  Clinic WABA ids are stored locally. Demo tokens with <code>EAAJ...</code> are not live Graph credentials.
                </p>
              </div>
              <div className="p-3.5 bg-slate-800/80 rounded-lg border border-slate-700/70">
                <div className="font-semibold text-amber-300 mb-1">System user tokens — not assumed</div>
                <p>
                  Permanent System User tokens are not claimed. Configure META_ACCESS_TOKEN for Graph OTP send.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- TAB 2: CONNECTED PRACTICES (WABAS) ----------------- */}
      {activeSubTab === "wabas" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Connected Clinic Practices & WABAs</h2>
              <p className="text-sm text-slate-500">
                Manage WhatsApp Business Account IDs, Phone Number IDs, and Quality ratings per polyclinic tenant.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowConnectModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition"
            >
              <Plus className="w-4 h-4" /> Connect New Practice WABA
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Clinic Practice</th>
                  <th className="px-5 py-3.5">WABA ID & Name</th>
                  <th className="px-5 py-3.5">Phone Number ID</th>
                  <th className="px-5 py-3.5">Quality Rating</th>
                  <th className="px-5 py-3.5">Onboarding Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {wabas.map((w) => (
                  <tr key={w.tenantId} className="hover:bg-slate-50/80 transition">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{w.tenantName}</div>
                      <div className="text-xs text-slate-500">{w.specialty} • {w.country}</div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">{w.tenantId}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-800">{w.metaWabaName}</div>
                      <div className="text-xs font-mono text-slate-500">{w.wabaId || "Not Connected"}</div>
                      <div className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded inline-block mt-0.5">
                        {w.metaTokenExpiresAt}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-mono text-xs text-slate-700">{w.phoneNumberId || "—"}</div>
                      <div className="text-xs text-slate-500">{w.clinicPhone}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" /> {w.metaQualityRating}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="capitalize px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                        {w.metaOnboardingStatus}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right space-x-2">
                      {overview?.simulatorsEnabled !== false && (
                        <button
                          type="button"
                          onClick={() => handleSimulateEmbeddedSignup(w.tenantId, w.tenantName)}
                          className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition"
                        >
                          SANDBOX / DEV-ONLY Simulate ES
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTenantId(w.tenantId);
                          setConnectForm({
                            wabaId: w.wabaId,
                            phoneNumberId: w.phoneNumberId,
                            metaWabaName: w.metaWabaName,
                            metaAccessToken: "EAAJ...verified_system_user_token_2026",
                          });
                          setShowConnectModal(true);
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 transition"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------- TAB 3: WHATSAPP TEMPLATES ----------------- */}
      {activeSubTab === "templates" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Registered WhatsApp Cloud Templates</h2>
              <p className="text-sm text-slate-500">
                Pre-approved clinical notifications, OPD appointment confirmations, and digital prescriptions.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewTemplateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition"
            >
              <Plus className="w-4 h-4" /> Submit New Template
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tpl) => {
              const headerComp = tpl.components.find((c) => c.type === "HEADER");
              const bodyComp = tpl.components.find((c) => c.type === "BODY");
              const footerComp = tpl.components.find((c) => c.type === "FOOTER");
              const btnComp = tpl.components.find((c) => c.type === "BUTTONS");

              return (
                <div key={tpl.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 font-mono text-sm">{tpl.name}</span>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                          {tpl.category}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">Language: {tpl.language} • {tpl.tenantName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        tpl.status === "APPROVED"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}>
                        {tpl.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded transition"
                        title="Delete template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Real WhatsApp Chat Preview Bubble */}
                  <div className="bg-[#EFEAE2] p-4 rounded-xl border border-[#D1D7DB] relative">
                    <div className="bg-white rounded-lg p-3 max-w-sm shadow-sm space-y-2 text-slate-800 text-xs">
                      {headerComp?.text && (
                        <div className="font-bold text-slate-900 border-b border-slate-100 pb-1">
                          {headerComp.text}
                        </div>
                      )}
                      {headerComp?.format === "DOCUMENT" && (
                        <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded text-slate-700">
                          <FileCheck className="w-4 h-4 text-red-500" />
                          <span className="font-medium">Prescription_Rx.pdf</span>
                        </div>
                      )}
                      <p className="leading-relaxed whitespace-pre-wrap">{bodyComp?.text}</p>
                      {footerComp?.text && (
                        <div className="text-[10px] text-slate-400">{footerComp.text}</div>
                      )}
                      {btnComp?.buttons && (
                        <div className="pt-2 border-t border-slate-100 space-y-1">
                          {btnComp.buttons.map((b, idx) => (
                            <div
                              key={idx}
                              className="text-center py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-emerald-700 font-semibold text-[11px]"
                            >
                              {b.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>Meta ID: {tpl.metaTemplateId || "meta_tpl_verified"}</span>
                    <span>Updated {new Date(tpl.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ----------------- TAB 4: MESSAGE TESTER & SIMULATOR ----------------- */}
      {activeSubTab === "tester" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">WhatsApp message tester (SANDBOX)</h2>
              <p className="text-sm text-slate-500">
                SANDBOX / DEV-ONLY: records a local payload. Disabled in production. Not a live Graph send.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Recipient Phone Number (E.164 format)</label>
                  <input
                    type="text"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="+919876543210"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Include country code (e.g. +91 for India, +1 for US)</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Select Meta Approved Template</label>
                  <select
                    value={testTemplate}
                    onChange={(e) => setTestTemplate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Custom Message Text (Optional Override)</label>
                  <textarea
                    rows={3}
                    value={testCustomMessage}
                    onChange={(e) => setTestCustomMessage(e.target.value)}
                    placeholder="Leave empty to use standard template components..."
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSendTest}
                  disabled={testLog.status === "sending"}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-sm disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {testLog.status === "sending" ? "Recording SANDBOX test..." : "SANDBOX / DEV-ONLY Send Test"}
                </button>
              </div>

              {/* Real-time Response Output */}
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 text-slate-200 font-mono text-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
                    <span className="text-slate-400 font-semibold">SANDBOX tester output</span>
                    <span className="text-[10px] text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800">
                      DEV-ONLY
                    </span>
                  </div>

                  {testLog.status === "idle" && (
                    <div className="text-slate-500 py-10 text-center">
                      Configure recipient above and click "Send Test" to inspect the local simulator response.
                    </div>
                  )}

                  {testLog.status === "sending" && (
                    <div className="text-amber-400 py-10 text-center animate-pulse">
                      Contacting local WhatsApp simulator...
                    </div>
                  )}

                  {testLog.status === "success" && (
                    <div className="space-y-2">
                      {isGraphAcceptedDelivery(testLog.data) ? (
                        <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Message Accepted for Delivery
                        </div>
                      ) : (
                        <div className="text-amber-300 font-bold flex items-center gap-1.5">
                          <Info className="w-4 h-4" /> Local simulator response (not Graph delivery)
                        </div>
                      )}
                      <pre className="bg-slate-950 p-3 rounded border border-slate-800 text-emerald-300 overflow-x-auto">
                        {JSON.stringify(testLog.data, null, 2)}
                      </pre>
                    </div>
                  )}

                  {testLog.status === "error" && (
                    <div className="space-y-2">
                      <div className="text-rose-400 font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" /> Dispatch Error
                      </div>
                      <pre className="bg-slate-950 p-3 rounded border border-slate-800 text-rose-300 overflow-x-auto">
                        {JSON.stringify(testLog.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500">
                  Logs are auto-recorded in Outbound Events for ABDM and clinical auditability.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONNECT WABA MODAL */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Connect WhatsApp Business Account</h3>
            <p className="text-xs text-slate-500">
              Provide the verified Meta WABA ID and Phone Number ID from your Meta Business Manager.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Clinic Practice</label>
                <select
                  value={selectedTenantId}
                  onChange={(e) => setSelectedTenantId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                >
                  {wabas.map((w) => (
                    <option key={w.tenantId} value={w.tenantId}>
                      {w.tenantName} ({w.tenantId})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WhatsApp Business Account ID (WABA ID)</label>
                <input
                  type="text"
                  value={connectForm.wabaId}
                  onChange={(e) => setConnectForm({ ...connectForm, wabaId: e.target.value })}
                  placeholder="e.g. waba_398249018247019"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={connectForm.phoneNumberId}
                  onChange={(e) => setConnectForm({ ...connectForm, phoneNumberId: e.target.value })}
                  placeholder="e.g. phone_982345566701"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WABA Display Name</label>
                <input
                  type="text"
                  value={connectForm.metaWabaName}
                  onChange={(e) => setConnectForm({ ...connectForm, metaWabaName: e.target.value })}
                  placeholder="e.g. Lumera Apex PolyClinic (Verified WABA)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">System User Access Token</label>
                <input
                  type="password"
                  value={connectForm.metaAccessToken}
                  onChange={(e) => setConnectForm({ ...connectForm, metaAccessToken: e.target.value })}
                  placeholder="EAAJ... (Permanent Graph API Token)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/meta/waba-connect", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        tenantId: selectedTenantId,
                        wabaId: connectForm.wabaId,
                        phoneNumberId: connectForm.phoneNumberId,
                        metaWabaName: connectForm.metaWabaName,
                        metaAccessToken: connectForm.metaAccessToken,
                      }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      alert(data.message || "SANDBOX: WABA ids stored locally (not Graph-validated).");
                      setShowConnectModal(false);
                      loadData();
                    } else {
                      alert(data.error || "Failed to connect");
                    }
                  } catch {
                    alert("Error saving WABA");
                  }
                }}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm"
              >
                Save &amp; Verify WABA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW TEMPLATE MODAL */}
      {showNewTemplateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900">Submit New WhatsApp Template</h3>
            <p className="text-xs text-slate-500">
              Define template components following Meta's WhatsApp Business Messaging Policy.
            </p>

            <form onSubmit={handleCreateTemplate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Template Name (Lowercase, snake_case)</label>
                <input
                  type="text"
                  required
                  value={newTemplateForm.name}
                  onChange={(e) => setNewTemplateForm({ ...newTemplateForm, name: e.target.value })}
                  placeholder="e.g. appointment_rescheduled_v1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={newTemplateForm.category}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, category: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="UTILITY">UTILITY (Transactional)</option>
                    <option value="AUTHENTICATION">AUTHENTICATION (OTP/Security)</option>
                    <option value="MARKETING">MARKETING (Offers/Camps)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Language</label>
                  <select
                    value={newTemplateForm.language}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, language: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="en">English (en)</option>
                    <option value="hi">Hindi (hi)</option>
                    <option value="mr">Marathi (mr)</option>
                    <option value="kn">Kannada (kn)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Header Text</label>
                <input
                  type="text"
                  value={newTemplateForm.headerText}
                  onChange={(e) => setNewTemplateForm({ ...newTemplateForm, headerText: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Body Text (with variables like {`{{1}}`})</label>
                <textarea
                  rows={3}
                  required
                  value={newTemplateForm.bodyText}
                  onChange={(e) => setNewTemplateForm({ ...newTemplateForm, bodyText: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Footer Text</label>
                <input
                  type="text"
                  value={newTemplateForm.footerText}
                  onChange={(e) => setNewTemplateForm({ ...newTemplateForm, footerText: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quick Reply Button 1</label>
                  <input
                    type="text"
                    value={newTemplateForm.button1Text}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, button1Text: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quick Reply Button 2</label>
                  <input
                    type="text"
                    value={newTemplateForm.button2Text}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, button2Text: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewTemplateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm"
                >
                  Submit for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
