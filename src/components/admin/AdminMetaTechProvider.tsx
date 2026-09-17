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

interface PlatformCredentials {
  appId: string | null;
  appIdConfigured?: boolean;
  appSecretConfigured?: boolean;
  appSecretPreview?: string;
  systemTokenConfigured?: boolean;
  systemTokenPreview?: string;
  phoneNumberId?: string | null;
  fallbackPhoneNumberId?: string | null;
  fallbackTokenConfigured?: boolean;
  embeddedSignupConfigIdConfigured?: boolean;
  webhookUrl?: string;
  webhookVerifyTokenConfigured?: boolean;
  notice?: string;
}

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
  const [platform, setPlatform] = useState<PlatformCredentials | null>(null);
  const [wabas, setWabas] = useState<WabaItem[]>([]);
  const [templates, setTemplates] = useState<MetaWhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"review" | "wabas" | "templates" | "tester">("review");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");

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
      const [ovRes, wabasRes, tplRes, credRes] = await Promise.all([
        fetch("/api/meta/overview").then((r) => r.json()),
        fetch("/api/meta/wabas").then((r) => r.json()),
        fetch("/api/meta/templates").then((r) => r.json()),
        fetch("/api/admin/meta/platform-credentials").then((r) => r.json()).catch(() => null),
      ]);
      setOverview(ovRes);
      setWabas(wabasRes.wabas || []);
      setTemplates(tplRes.templates || []);
      if (credRes && !credRes.error) setPlatform(credRes);
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

      {/* TAB CONTENT TRUNCATED FOR MCP - USE FULL FILE */}
    </div>
  );
};
