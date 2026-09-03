import React, { useEffect, useState } from "react";
import {
  Sparkles,
  Phone,
  Calendar,
  Clock,
  TrendingUp,
  Bot,
  Mic,
  MessageCircle,
  CalendarCheck,
  Bell,
  CreditCard,
  ShieldCheck,
  Stethoscope,
  Smile,
  HeartPulse,
  Flower2,
  Activity,
  Briefcase,
  ArrowRight,
  Check,
  Globe,
  MessageSquare,
} from "lucide-react";
import { useNav } from "../nav/NavigationContext";

interface SitePayload {
  settings: {
    brandName: string;
    badgeText: string;
    heroTitle: string;
    heroSubtitle: string;
    contactEmail: string;
    ctaPrimary: string;
    ctaSecondary: string;
    ctaBannerTitle: string;
    ctaBannerSubtitle: string;
    logoUrl: string;
    clinicName: string;
  };
  stats: { icon: string; value: string; label: string }[];
  pains: { id: string; title: string; items: string[] }[];
  features: { id: string; title: string; desc: string }[];
  personas: { id: string; title: string; desc: string }[];
  testimonials: { id: string; quote: string; name: string; role: string }[];
  policies: { slug: string; title: string }[];
}

const STAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  calendar: Calendar,
  clock: Clock,
  trend: TrendingUp,
  bot: Bot,
};

const FEATURE_ICONS = [Mic, MessageCircle, CalendarCheck, Bell, CreditCard, ShieldCheck];
const FEATURE_COLORS = [
  "from-purple-500 to-indigo-500",
  "from-green-500 to-teal-500",
  "from-blue-500 to-cyan-500",
  "from-orange-500 to-red-500",
  "from-pink-500 to-purple-500",
  "from-teal-500 to-green-500",
];
const PERSONA_ICONS = [Stethoscope, Smile, HeartPulse, Flower2, Activity, Briefcase];
const PERSONA_COLORS = [
  "from-indigo-500 to-purple-600",
  "from-teal-500 to-cyan-600",
  "from-violet-500 to-fuchsia-600",
  "from-rose-400 to-orange-500",
  "from-emerald-500 to-teal-600",
  "from-slate-600 to-indigo-700",
];

const LANGUAGES = ["Hindi", "Tamil", "Telugu", "Marathi", "Bengali", "English"];

const FALLBACK: SitePayload = {
  settings: {
    brandName: "Lumera",
    badgeText: "AI-Powered Practice Management for Healthcare Professionals",
    heroTitle: "Your AI Receptionist for 24/7 Appointment Booking",
    heroSubtitle:
      "Let Lumera AI answer calls, book appointments via WhatsApp, and manage your practice automatically — in Hindi, Tamil, Telugu, Marathi, Bengali & English.",
    contactEmail: "ravee@lumer.me",
    ctaPrimary: "Get Started Free",
    ctaSecondary: "See Demo",
    ctaBannerTitle: "Ready to Transform Your Practice?",
    ctaBannerSubtitle: "Start your free trial today. No credit card required. Set up in under 5 minutes.",
    logoUrl: "",
    clinicName: "Lumera Solutions LLP",
  },
  stats: [
    { icon: "calendar", value: "50K+", label: "Appointments Booked" },
    { icon: "clock", value: "10K+", label: "Hours Saved Monthly" },
    { icon: "trend", value: "95%", label: "No-Show Reduction" },
    { icon: "bot", value: "24/7", label: "AI Availability" },
  ],
  pains: [],
  features: [],
  personas: [],
  testimonials: [],
  policies: [
    { slug: "privacy", title: "Privacy Policy" },
    { slug: "terms", title: "Terms of Service" },
    { slug: "disclaimer", title: "Medical Disclaimer" },
    { slug: "security", title: "Data Security" },
  ],
};

export const LandingPage: React.FC = () => {
  const [site, setSite] = useState<SitePayload>(FALLBACK);
  const { go } = useNav();

  useEffect(() => {
    fetch("/api/public/site")
      .then((r) => r.json())
      .then((d) =>
        setSite({
          ...FALLBACK,
          ...d,
          settings: { ...FALLBACK.settings, ...(d.settings || {}) },
          stats: Array.isArray(d.stats) && d.stats.length ? d.stats : FALLBACK.stats,
          pains: d.pains || FALLBACK.pains,
          features: d.features || FALLBACK.features,
          personas: d.personas || FALLBACK.personas,
          testimonials: d.testimonials || FALLBACK.testimonials,
          policies: d.policies || FALLBACK.policies,
        })
      )
      .catch(() => undefined);
  }, []);

  const s = site.settings;

  return (
    <div className="min-h-screen text-white font-sans selection:bg-purple-600 selection:text-white bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <header className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
        <button type="button" onClick={() => go("landing")} className="flex items-center gap-3">
          {s.logoUrl ? (
            <img src={s.logoUrl} alt={s.brandName} className="h-12 w-12 rounded-xl object-cover shadow-lg shadow-purple-500/30" />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
          )}
          <span className="font-manrope text-2xl font-bold tracking-tight">{s.brandName}</span>
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => go("login", { loginNext: "app", loginDemo: true })}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold"
          >
            <MessageSquare className="w-4 h-4" />
            WhatsApp Login
          </button>
          <button
            type="button"
            onClick={() => go("login", { loginNext: "app" })}
            className="px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 rounded-lg"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => go("login", { loginNext: "admin" })}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-sm font-semibold shadow-lg shadow-purple-500/30"
          >
            Start Free Trial
          </button>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-4 pt-10 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/20 border border-purple-500/30 text-sm text-purple-300 mb-8">
          <Bot className="w-4 h-4 text-purple-400" />
          {s.badgeText}
        </div>
        <h1 className="font-manrope text-4xl sm:text-6xl font-bold leading-tight tracking-tight">{s.heroTitle}</h1>
        <p className="mt-6 text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed">{s.heroSubtitle}</p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={() => go("login", { loginNext: "app" })}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 font-manrope font-semibold shadow-xl shadow-purple-500/30"
          >
            <Sparkles className="w-5 h-5" />
            {s.ctaPrimary}
          </button>
          <button
            type="button"
            onClick={() => go("login", { loginNext: "app", loginDemo: true })}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-lg border-2 border-purple-500/50 bg-transparent hover:bg-purple-500/20 font-manrope font-semibold"
          >
            <Phone className="w-5 h-5" />
            {s.ctaSecondary}
          </button>
        </div>

        <div className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {site.stats.map((stat) => {
            const Icon = STAT_ICONS[stat.icon] || Calendar;
            return (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-6">
                <Icon className="w-8 h-8 mx-auto mb-3 text-purple-400" />
                <div className="font-manrope text-3xl font-bold">{stat.value}</div>
                <div className="text-sm text-slate-400 mt-1">{stat.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {site.pains.length > 0 && (
        <section className="py-20 bg-slate-900/50">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="font-manrope text-3xl sm:text-4xl font-bold text-center">Sound Familiar? You're Not Alone.</h2>
            <p className="text-center text-slate-400 mt-4 mb-12 text-lg">
              Healthcare professionals struggle with three inefficient ways to handle patient calls:
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {site.pains.map((p) => (
                <div key={p.id} className="rounded-2xl border border-red-500/20 bg-red-500/10 backdrop-blur-sm p-6">
                  <h3 className="font-manrope font-bold text-xl mb-4">{p.title}</h3>
                  <ul className="space-y-3 text-sm text-slate-300">
                    {(p.items || []).map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">✗</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {site.features.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-20">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/30 text-sm text-green-300 mb-6">
              <Check className="w-4 h-4 text-green-400" />
              The Lumera Solution
            </div>
            <h2 className="font-manrope text-3xl sm:text-4xl font-bold">Lumera AI Never Misses a Call</h2>
            <p className="text-slate-400 mt-4 max-w-2xl mx-auto text-lg">
              Trained on your practice, Lumera delivers accurate responses every time. Available 24/7/365, it handles
              calls and WhatsApp messages whenever you can't.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {site.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              return (
                <div key={f.id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${FEATURE_COLORS[i % FEATURE_COLORS.length]} flex items-center justify-center mb-4 shadow-lg`}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-manrope font-bold text-xl mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="py-16 bg-gradient-to-r from-purple-900/50 to-indigo-900/50">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-4">
            <Globe className="w-12 h-12 text-purple-400" />
            <div>
              <h3 className="font-manrope font-bold text-2xl">Multi-Language AI Voice</h3>
              <p className="text-slate-400">Natural conversations in your patients' preferred language</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            {LANGUAGES.map((lang) => (
              <span key={lang} className="px-4 py-2 bg-white/10 rounded-full text-sm border border-white/20">
                {lang}
              </span>
            ))}
          </div>
        </div>
      </section>

      {site.personas.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-20">
          <h2 className="font-manrope text-3xl sm:text-4xl font-bold text-center">Built for Healthcare Professionals Like You</h2>
          <p className="text-center text-slate-400 mt-4 mb-12 text-lg">
            Join thousands of doctors, dentists, therapists, and wellness professionals using Lumera.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {site.personas.map((p, i) => {
              const Icon = PERSONA_ICONS[i % PERSONA_ICONS.length];
              return (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${PERSONA_COLORS[i % PERSONA_COLORS.length]} flex items-center justify-center mb-4 shadow-lg`}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-manrope font-bold text-xl">{p.title}</h3>
                  <p className="text-sm text-slate-400 mt-2">{p.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {site.testimonials.length > 0 && (
        <section className="py-20 bg-slate-900/50">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="font-manrope text-3xl sm:text-4xl font-bold text-center mb-12">What Doctors Are Saying</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {site.testimonials.map((t) => (
                <blockquote key={t.id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
                  <p className="text-slate-300 leading-relaxed">“{t.quote}”</p>
                  <footer className="mt-6">
                    <div className="font-manrope font-bold">{t.name}</div>
                    <div className="text-sm text-purple-400">{t.role}</div>
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="max-w-5xl mx-auto px-4 py-20">
        <div className="rounded-3xl bg-gradient-to-r from-purple-600 to-indigo-600 p-12 text-center shadow-2xl shadow-purple-500/20">
          <h2 className="font-manrope text-3xl sm:text-4xl font-bold">{s.ctaBannerTitle}</h2>
          <p className="text-purple-100 mt-3 text-lg">{s.ctaBannerSubtitle}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => go("login", { loginNext: "admin" })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-white text-purple-700 hover:bg-purple-50 font-semibold"
            >
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => go("login", { loginNext: "app", loginDemo: true })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-white/40 hover:bg-white/10 font-semibold"
            >
              Schedule Demo Call
            </button>
          </div>
          <p className="text-sm text-purple-100/80 mt-6">
            Questions?{" "}
            <a className="underline" href={`mailto:${s.contactEmail}`}>
              {s.contactEmail}
            </a>
          </p>
        </div>
      </section>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-slate-400">
        <div className="font-manrope font-semibold text-white mb-2">Policies & Disclaimers</div>
        <div className="flex flex-wrap justify-center gap-4 mb-4">
          {site.policies.map((p) => (
            <button key={p.slug} type="button" onClick={() => go("policy", { policySlug: p.slug })} className="hover:text-white">
              {p.title}
            </button>
          ))}
        </div>
        <p>
          © {new Date().getFullYear()} Lumera Solutions LLP. All rights reserved. Made with care for healthcare
          professionals.
        </p>
      </footer>
    </div>
  );
};
