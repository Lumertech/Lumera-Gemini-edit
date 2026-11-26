import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  CreditCard,
  Stethoscope,
  Info,
  ListChecks,
  X,
} from "lucide-react";
import {
  FAQ_CATEGORIES,
  PLATFORM_FAQS,
  WHATSAPP_LINKING_JOURNEY_STEPS,
  WHATSAPP_NUMBER_OPTIONS,
  WHATSAPP_SETUP_FAQS,
  buildFaqPageJsonLd,
  type FaqCategoryId,
  type PlatformFaqItem,
} from "../data/platformFaqs";
import { CONTACT_EMAIL } from "../lib/pricingCopy";

const CATEGORY_ICONS: Record<FaqCategoryId, React.ComponentType<{ className?: string }>> = {
  "whatsapp-linking": MessageCircle,
  "voice-languages": Phone,
  "shared-mobile": Users,
  "clinical-scribe": Stethoscope,
  "pricing-billing": CreditCard,
  "privacy-records": ShieldCheck,
};

function matchesFaqQuery(item: PlatformFaqItem, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.question,
    item.answer,
    ...(item.bullets || []),
    item.highlightNote || "",
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

export const WhatsAppLinkingJourneyGuide: React.FC<{
  variant?: "dark" | "light";
  compact?: boolean;
}> = ({ variant = "dark", compact = false }) => {
  const isDark = variant === "dark";

  return (
    <div
      data-testid="whatsapp-number-options-matrix"
      className={
        isDark
          ? "mb-8 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-slate-900/95 to-slate-900/95 p-5 sm:p-6 space-y-6"
          : "mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 sm:p-6 space-y-6"
      }
    >
      {/* Part A: 3 Number Choices Side-by-Side */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span
              className={
                isDark
                  ? "text-[11px] font-bold uppercase tracking-wider text-emerald-300"
                  : "text-[11px] font-bold uppercase tracking-wider text-emerald-800"
              }
            >
              WhatsApp Number Linking — Complete Clinic Walkthrough
            </span>
            <h3
              className={
                isDark
                  ? "text-base sm:text-xl font-bold text-white mt-0.5"
                  : "text-sm sm:text-lg font-bold text-slate-900 mt-0.5"
              }
            >
              Part 1: Which Phone Number Can Your Clinic Connect?
            </h3>
            <p className={isDark ? "text-xs text-slate-300 mt-1" : "text-xs text-slate-600 mt-1"}>
              Before launching Meta Embedded Signup, choose which of these three phone number paths fits your practice:
            </p>
          </div>
          <span
            className={
              isDark
                ? "text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 self-start sm:self-auto shrink-0"
                : "text-[11px] px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-800 font-medium self-start sm:self-auto shrink-0"
            }
          >
            3 Supported Number Paths
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {WHATSAPP_NUMBER_OPTIONS.map((opt) => {
            const verdictStyle =
              opt.verdict === "Recommended"
                ? isDark
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-emerald-100 text-emerald-800 border-emerald-300"
                : opt.verdict === "No Extra SIM Needed"
                  ? isDark
                    ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                    : "bg-blue-100 text-blue-800 border-blue-300"
                  : isDark
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    : "bg-amber-100 text-amber-900 border-amber-300";

            return (
              <div
                key={opt.id}
                className={
                  isDark
                    ? "rounded-xl border border-slate-800 bg-slate-950/85 p-4 flex flex-col justify-between space-y-3"
                    : "rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between space-y-3 shadow-2xs"
                }
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className={
                        isDark
                          ? "text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
                          : "text-[10px] font-semibold text-slate-500 uppercase tracking-wider"
                      }
                    >
                      {opt.badge}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${verdictStyle}`}>
                      {opt.verdict}
                    </span>
                  </div>
                  <h4 className={isDark ? "text-sm font-bold text-white" : "text-sm font-bold text-slate-900"}>
                    {opt.title}
                  </h4>
                  <p className={isDark ? "text-xs text-slate-300 leading-relaxed" : "text-xs text-slate-600 leading-relaxed"}>
                    {opt.summary}
                  </p>
                </div>

                <ul className="space-y-1.5 pt-2 border-t border-slate-800/40">
                  {opt.details.map((detail, idx) => (
                    <li
                      key={idx}
                      className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
                        isDark ? "text-slate-300" : "text-slate-600"
                      }`}
                    >
                      <CheckCircle2
                        className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                          isDark ? "text-emerald-400" : "text-emerald-600"
                        }`}
                      />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Part B: End-to-End 6-Step Linking Journey */}
      <div
        data-testid="whatsapp-linking-journey-steps"
        className={`pt-5 border-t ${isDark ? "border-slate-800" : "border-emerald-200/80"} space-y-4`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span
              className={
                isDark
                  ? "text-[11px] font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5"
                  : "text-[11px] font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1.5"
              }
            >
              <ListChecks className="w-3.5 h-3.5" />
              End-to-End Onboarding Flow
            </span>
            <h3
              className={
                isDark
                  ? "text-base sm:text-xl font-bold text-white mt-0.5"
                  : "text-sm sm:text-lg font-bold text-slate-900 mt-0.5"
              }
            >
              Part 2: Step-by-Step WhatsApp Number Linking Journey (Steps 1 to 6)
            </h3>
            <p className={isDark ? "text-xs text-slate-300 mt-1" : "text-xs text-slate-600 mt-1"}>
              Exactly what happens before, during, and right after you connect your clinic's WhatsApp Business Account:
            </p>
          </div>
        </div>

        <div className={`grid grid-cols-1 ${compact ? "" : "md:grid-cols-2"} gap-4`}>
          {WHATSAPP_LINKING_JOURNEY_STEPS.map((step) => (
            <div
              key={step.id}
              data-testid={`wa-journey-step-${step.stepNumber}`}
              className={
                isDark
                  ? "rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2.5"
                  : "rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 shadow-2xs"
              }
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      isDark
                        ? "w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-extrabold flex items-center justify-center shrink-0"
                        : "w-6 h-6 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-extrabold flex items-center justify-center shrink-0"
                    }
                  >
                    {step.stepNumber}
                  </span>
                  <span
                    className={
                      isDark
                        ? "text-[10px] font-bold uppercase tracking-wider text-emerald-300"
                        : "text-[10px] font-bold uppercase tracking-wider text-emerald-700"
                    }
                  >
                    Step {step.stepNumber} · {step.badge}
                  </span>
                </div>
              </div>

              <h4 className={isDark ? "text-sm font-bold text-white" : "text-sm font-bold text-slate-900"}>
                {step.title}
              </h4>
              <p className={isDark ? "text-xs text-slate-300 leading-relaxed" : "text-xs text-slate-600 leading-relaxed"}>
                {step.summary}
              </p>

              <ul className="space-y-1.5 pt-1">
                {step.points.map((pt, idx) => (
                  <li
                    key={idx}
                    className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
                      isDark ? "text-slate-300" : "text-slate-600"
                    }`}
                  >
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                        isDark ? "text-blue-400" : "text-blue-600"
                      }`}
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export interface FaqSectionProps {
  variant?: "dark" | "light";
  includeJsonLd?: boolean;
  defaultCategory?: "all" | FaqCategoryId;
  id?: string;
}

export const FaqSection: React.FC<FaqSectionProps> = ({
  variant = "dark",
  includeJsonLd = false,
  defaultCategory = "all",
  id = "faq",
}) => {
  const isDark = variant === "dark";
  const [selectedCategory, setSelectedCategory] = useState<"all" | FaqCategoryId>(defaultCategory);
  const [searchQuery, setSearchQuery] = useState("");
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({
    "wa-existing-number": true,
    "wa-virtual-number": true,
    "wa-landline-number": true,
    "wa-checklist-before-signup": true,
    "wa-2fa-pin": true,
    "wa-meta-billing-and-templates": true,
    "shared-mobile-multi-pet-child-family": true,
  });

  const filteredFaqs = useMemo(() => {
    return PLATFORM_FAQS.filter((item) => {
      if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
      return matchesFaqQuery(item, searchQuery);
    });
  }, [selectedCategory, searchQuery]);

  const toggleItem = (faqId: string) => {
    setOpenIds((prev) => ({ ...prev, [faqId]: !prev[faqId] }));
  };

  const allFilteredOpen =
    filteredFaqs.length > 0 && filteredFaqs.every((item) => Boolean(openIds[item.id]));

  const handleToggleAll = () => {
    if (allFilteredOpen) {
      setOpenIds({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const item of filteredFaqs) {
      next[item.id] = true;
    }
    setOpenIds(next);
  };

  const showWhatsAppMatrix =
    (selectedCategory === "all" || selectedCategory === "whatsapp-linking") &&
    (!searchQuery.trim() ||
      /whatsapp|number|sim|virtual|landline|existing|meta|coexistence|business|pin|template|step/i.test(
        searchQuery
      ));

  const jsonLd = useMemo(() => JSON.stringify(buildFaqPageJsonLd(PLATFORM_FAQS)), []);

  return (
    <section
      id={id}
      data-testid="platform-faq-section"
      className={
        isDark
          ? "max-w-6xl mx-auto px-4 py-16 border-t border-slate-800/80 scroll-mt-6"
          : "w-full space-y-6"
      }
    >
      {includeJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      )}

      {/* Header */}
      <div className={isDark ? "text-center mb-10" : "space-y-2"}>
        <div
          className={
            isDark
              ? "inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-xs text-blue-300 mb-3"
              : "inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700"
          }
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Setup, WhatsApp Number Linking Journey &amp; Clinical Workflow Guide</span>
        </div>
        <h2
          className={
            isDark
              ? "font-manrope text-3xl sm:text-4xl font-extrabold text-white"
              : "text-xl sm:text-2xl font-bold text-slate-900"
          }
        >
          WhatsApp Linking Journey &amp; Frequently Asked Questions
        </h2>
        <p
          className={
            isDark
              ? "text-slate-400 mt-2 max-w-3xl mx-auto text-sm"
              : "text-slate-600 text-xs sm:text-sm max-w-3xl"
          }
        >
          Step-by-step walkthrough of connecting your clinic WhatsApp number (new SIM, clinic landline, existing WhatsApp rules, or Meta virtual number), plus answers on shared family/pet mobile numbers, ambient scribing, pricing, and data privacy.
        </p>
      </div>

      {/* Search & Expand Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            data-testid="faq-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search questions (e.g. existing WhatsApp number, virtual number, landline, 6-digit PIN, multiple pets, trial)..."
            aria-label="Search frequently asked questions"
            className={
              isDark
                ? "w-full pl-10 pr-9 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                : "w-full pl-10 pr-9 py-2.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            }
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear FAQ search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleToggleAll}
          className={
            isDark
              ? "px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition shrink-0"
              : "px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition shrink-0"
          }
        >
          {allFilteredOpen ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Category Filter Pills */}
      <div
        role="tablist"
        aria-label="FAQ categories"
        className="flex flex-wrap gap-2 mb-8"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === "all"}
          onClick={() => setSelectedCategory("all")}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
            selectedCategory === "all"
              ? isDark
                ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                : "bg-blue-600 border-blue-600 text-white shadow-xs"
              : isDark
                ? "bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          All Topics ({PLATFORM_FAQS.length})
        </button>

        {FAQ_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id];
          const count = PLATFORM_FAQS.filter((f) => f.category === cat.id).length;
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`faq-tab-${cat.id}`}
              onClick={() => setSelectedCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
                active
                  ? isDark
                    ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                    : "bg-blue-600 border-blue-600 text-white shadow-xs"
                  : isDark
                    ? "bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{cat.shortLabel}</span>
              <span className={active ? "text-blue-100" : "opacity-60"}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Full WhatsApp Number Options + 6-Step End-to-End Linking Journey */}
      {showWhatsAppMatrix && <WhatsAppLinkingJourneyGuide variant={variant} />}

      {/* FAQ Accordion List */}
      {filteredFaqs.length === 0 ? (
        <div
          className={
            isDark
              ? "rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-2"
              : "rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-2"
          }
        >
          <p className={isDark ? "text-sm font-semibold text-white" : "text-sm font-semibold text-slate-900"}>
            No questions matched “{searchQuery}”
          </p>
          <p className={isDark ? "text-xs text-slate-400" : "text-xs text-slate-500"}>
            Try clearing your search filter or write directly to {CONTACT_EMAIL}.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("all");
            }}
            className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
          >
            Show all {PLATFORM_FAQS.length} questions
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredFaqs.map((item) => {
            const isOpen = Boolean(openIds[item.id]);
            const catMeta = FAQ_CATEGORIES.find((c) => c.id === item.category);
            const Icon = CATEGORY_ICONS[item.category];

            return (
              <div
                key={item.id}
                data-testid={`faq-item-${item.id}`}
                className={
                  isDark
                    ? `rounded-2xl border transition-all ${
                        isOpen
                          ? "border-blue-500/50 bg-slate-900/95 shadow-lg shadow-blue-950/20"
                          : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                      }`
                    : `rounded-xl border transition-all ${
                        isOpen
                          ? "border-blue-300 bg-white shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`
                }
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleItem(item.id)}
                  className="w-full px-4 sm:px-5 py-4 flex items-start justify-between gap-4 text-left cursor-pointer"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={
                          isDark
                            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-semibold text-slate-300"
                            : "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-600"
                        }
                      >
                        <Icon className="w-3 h-3" />
                        {catMeta?.shortLabel}
                      </span>
                    </div>
                    <h3
                      className={
                        isDark
                          ? "text-sm sm:text-base font-bold text-white leading-snug"
                          : "text-sm sm:text-base font-bold text-slate-900 leading-snug"
                      }
                    >
                      {item.question}
                    </h3>
                  </div>

                  <span
                    className={`mt-1 p-1 rounded-lg shrink-0 ${
                      isDark
                        ? "bg-slate-800 text-slate-300"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </button>

                {isOpen && (
                  <div
                    className={`px-4 sm:px-5 pb-4 pt-1 space-y-3 text-xs sm:text-sm leading-relaxed border-t ${
                      isDark
                        ? "border-slate-800/80 text-slate-300"
                        : "border-slate-100 text-slate-600"
                    }`}
                  >
                    <p>{item.answer}</p>

                    {item.bullets && item.bullets.length > 0 && (
                      <ul className="space-y-1.5 pl-1">
                        {item.bullets.map((bullet, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs sm:text-[13px]">
                            <CheckCircle2
                              className={`w-4 h-4 shrink-0 mt-0.5 ${
                                isDark ? "text-emerald-400" : "text-emerald-600"
                              }`}
                            />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {item.highlightNote && (
                      <div
                        className={
                          isDark
                            ? "flex items-start gap-2 p-3 rounded-xl bg-blue-950/50 border border-blue-500/30 text-xs text-blue-200"
                            : "flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900"
                        }
                      >
                        <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                        <span>{item.highlightNote}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Support Footer Strip */}
      <div
        className={
          isDark
            ? "mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-300"
            : "mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-600"
        }
      >
        <div className="flex items-center gap-2">
          <Info className={isDark ? "w-4 h-4 text-blue-400 shrink-0" : "w-4 h-4 text-blue-600 shrink-0"} />
          <span>
            Need help choosing between migrating an existing number, a clinic landline, or a Meta virtual number?
          </span>
        </div>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className={
            isDark
              ? "font-semibold text-blue-300 hover:text-blue-200 underline underline-offset-2 shrink-0"
              : "font-semibold text-blue-700 hover:text-blue-800 underline underline-offset-2 shrink-0"
          }
        >
          Email {CONTACT_EMAIL}
        </a>
      </div>
    </section>
  );
};

/**
 * Contextual WhatsApp Number Linking Walkthrough + FAQs placed directly alongside
 * ClinicWabaConnect in Onboarding & Clinic Settings so clinicians get the full
 * step-by-step explanation right where they connect their number.
 */
export const WhatsAppLinkingFaqCard: React.FC<{
  variant?: "dark" | "light";
  defaultOpen?: boolean;
}> = ({ variant = "light", defaultOpen = false }) => {
  const isDark = variant === "dark";
  const [expanded, setExpanded] = useState(defaultOpen);
  const [subTab, setSubTab] = useState<"journey" | "faqs">("journey");
  const [openQuestionId, setOpenQuestionId] = useState<string>(WHATSAPP_SETUP_FAQS[0]?.id || "");

  return (
    <div
      data-testid="whatsapp-linking-faq-card"
      className={
        isDark
          ? "mt-3 mb-4 rounded-xl border border-emerald-800/50 bg-slate-950/80 overflow-hidden"
          : "mt-3 rounded-xl border border-slate-200 bg-slate-50/90 overflow-hidden"
      }
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <HelpCircle className={isDark ? "w-4 h-4 text-emerald-400 shrink-0" : "w-4 h-4 text-emerald-700 shrink-0"} />
          <div className="min-w-0">
            <span className={isDark ? "text-xs font-bold text-white block" : "text-xs font-bold text-slate-900 block"}>
              Step-by-Step WhatsApp Number Linking Guide &amp; FAQs
            </span>
            <span className={isDark ? "text-[11px] text-slate-400 block" : "text-[11px] text-slate-600 block"}>
              New SIM / Landline vs. Meta Virtual Number vs. Existing WhatsApp Number Rules (Steps 1–6)
            </span>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 ${
            isDark ? "bg-slate-800 text-emerald-300" : "bg-white border border-slate-200 text-emerald-800"
          }`}
        >
          {expanded ? "Hide Guide" : "Read Guide"}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {expanded && (
        <div
          className={`px-4 pb-4 pt-3 space-y-4 border-t ${
            isDark ? "border-slate-800" : "border-slate-200"
          }`}
        >
          {/* Mode Toggle: Step-by-Step Journey vs. Detailed Q&A */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSubTab("journey")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                subTab === "journey"
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : isDark
                    ? "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
                    : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              1. Complete Linking Journey (3 Paths + 6 Steps)
            </button>
            <button
              type="button"
              onClick={() => setSubTab("faqs")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                subTab === "faqs"
                  ? "bg-blue-600 border-blue-600 text-white"
                  : isDark
                    ? "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
                    : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              2. Specific Questions ({WHATSAPP_SETUP_FAQS.length} FAQs)
            </button>
          </div>

          {subTab === "journey" ? (
            <WhatsAppLinkingJourneyGuide variant={variant} compact />
          ) : (
            <div className="space-y-2">
              {WHATSAPP_SETUP_FAQS.map((faq) => {
                const isItemOpen = openQuestionId === faq.id;
                return (
                  <div
                    key={faq.id}
                    className={
                      isDark
                        ? "rounded-lg border border-slate-800 bg-slate-900/80"
                        : "rounded-lg border border-slate-200 bg-white"
                    }
                  >
                    <button
                      type="button"
                      aria-expanded={isItemOpen}
                      onClick={() => setOpenQuestionId(isItemOpen ? "" : faq.id)}
                      className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <span className={isDark ? "text-xs font-semibold text-white" : "text-xs font-semibold text-slate-900"}>
                        {faq.question}
                      </span>
                      {isItemOpen ? (
                        <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                    </button>
                    {isItemOpen && (
                      <div
                        className={`px-3 pb-3 pt-1 space-y-1.5 text-[11px] leading-relaxed border-t ${
                          isDark ? "border-slate-800 text-slate-300" : "border-slate-100 text-slate-600"
                        }`}
                      >
                        <p>{faq.answer}</p>
                        {faq.bullets && (
                          <ul className="space-y-1">
                            {faq.bullets.map((b, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <CheckCircle2
                                  className={`w-3 h-3 shrink-0 mt-0.5 ${
                                    isDark ? "text-emerald-400" : "text-emerald-600"
                                  }`}
                                />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
