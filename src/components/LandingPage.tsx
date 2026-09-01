import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
} from "lucide-react";

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
const PERSONA_ICONS = [Stethoscope, Smile, HeartPulse, Flower2, Activity, Briefcase];

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
  const navigate = useNavigate();

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
    <div className="min-h-screen text-white font-sans selection:bg-violet-500 selection:text-white bg-violet-950">
      <div className="relative overflow-hidden bg-gradient-to-b from-violet-700 via-violet-950 to-black">

        <div className="relative z-20 text-center text-[11px] text-violet-200/80 pt-3">
          Public marketing site · clinician app is at Login → Doctor
        </div>
        <header className="relative z-20 max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            {s.logoUrl ? (
              <img src={s.logoUrl} alt={s.brandName} className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-xl bg-violet-500 flex items-center justify-center shadow-lg shadow-violet-500/50">
                <Sparkles className="w-5 h-5" />
              </div>
            )}
            <span className="text-lg font-extrabold tracking-tight">{s.brandName}</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={`https://wa.me/919800012345`}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold"
            >
              WhatsApp Login
            </a>
            <Link to="/login" className="px-3 py-1.5 text-sm font-medium text-white/90 hover:text-white">
              Login
            </Link>
            <Link
              to="/login?next=/admin"
              className="px-4 py-1.5 rounded-full bg-violet-500 hover:bg-violet-400 text-sm font-semibold shadow-[0_0_22px_rgba(168,85,247,0.55)]"
            >
              Start Free Trial
            </Link>
          </div>
        </header>

        <section className="relative z-10 max-w-4xl mx-auto px-4 pt-10 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs text-violet-100 mb-6">
            <Bot className="w-3.5 h-3.5" />
            {s.badgeText}
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight tracking-tight">{s.heroTitle}</h1>
          <p className="mt-5 text-base sm:text-lg text-violet-100/80 max-w-2xl mx-auto">{s.heroSubtitle}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => navigate("/login?next=/app")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-violet-500 hover:bg-violet-400 font-semibold shadow-[0_0_32px_rgba(168,85,247,0.7)]"
            >
              <Sparkles className="w-4 h-4" />
              {s.ctaPrimary}
            </button>
            <button
              onClick={() => navigate("/login?next=/app&demo=1")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-white/25 bg-white/5 hover:bg-white/10 font-semibold"
            >
              <Phone className="w-4 h-4" />
              {s.ctaSecondary}
            </button>
          </div>

          <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {site.stats.map((stat) => {
              const Icon = STAT_ICONS[stat.icon] || Calendar;
              return (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md px-4 py-5"
                >
                  <Icon className="w-5 h-5 mx-auto mb-2 text-violet-200" />
                  <div className="text-2xl font-extrabold">{stat.value}</div>
                  <div className="text-xs text-violet-200/80 mt-1">{stat.label}</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {site.pains.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-3xl font-extrabold text-center">Sound Familiar? You're Not Alone.</h2>
          <p className="text-center text-violet-200/70 mt-3 mb-10">
            Healthcare professionals struggle with three inefficient ways to handle patient calls:
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {site.pains.map((p) => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="font-bold text-lg mb-4">{p.title}</h3>
                <ul className="space-y-2 text-sm text-violet-100/80">
                  {(p.items || []).map((item) => (
                    <li key={item}>✗ {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {site.features.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-8 pb-16">
          <h2 className="text-3xl font-extrabold text-center">Lumera AI Never Misses a Call</h2>
          <p className="text-center text-violet-200/70 mt-3 mb-10 max-w-2xl mx-auto">
            Trained on your practice, Lumera delivers accurate responses every time. Available 24/7/365, it handles
            calls and WhatsApp messages whenever you can't.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {site.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              return (
                <div key={f.id} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/20 text-violet-200 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold mb-2">{f.title}</h3>
                  <p className="text-sm text-violet-100/75">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {site.personas.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-8 pb-16">
          <h2 className="text-3xl font-extrabold text-center">Built for Healthcare Professionals Like You</h2>
          <p className="text-center text-violet-200/70 mt-3 mb-10">
            Join thousands of doctors, dentists, therapists, and wellness professionals using Lumera.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {site.personas.map((p, i) => {
              const Icon = PERSONA_ICONS[i % PERSONA_ICONS.length];
              return (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <Icon className="w-6 h-6 text-violet-300 mb-3" />
                  <h3 className="font-bold">{p.title}</h3>
                  <p className="text-sm text-violet-100/75 mt-1">{p.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {site.testimonials.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-8 pb-16">
          <h2 className="text-3xl font-extrabold text-center mb-10">What Doctors Are Saying</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {site.testimonials.map((t) => (
              <blockquote key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm text-violet-50 leading-relaxed">“{t.quote}”</p>
                <footer className="mt-4">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-violet-200/70">{t.role}</div>
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-4 pb-20 text-center">
        <div className="rounded-3xl border border-violet-400/30 bg-gradient-to-br from-violet-600/40 to-fuchsia-900/30 p-10">
          <h2 className="text-3xl font-extrabold">{s.ctaBannerTitle}</h2>
          <p className="text-violet-100/80 mt-3">{s.ctaBannerSubtitle}</p>
          <button
            onClick={() => navigate("/login?next=/app")}
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-violet-500 hover:bg-violet-400 font-semibold"
          >
            Start Free Trial <ArrowRight className="w-4 h-4" />
          </button>
          <p className="text-sm text-violet-200/70 mt-4">
            Questions?{" "}
            <a className="underline" href={`mailto:${s.contactEmail}`}>
              {s.contactEmail}
            </a>
          </p>
        </div>
      </section>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-violet-200/70">
        <div className="font-semibold text-violet-100 mb-2">Policies & Disclaimers</div>
        <div className="flex flex-wrap justify-center gap-4 mb-4">
          {site.policies.map((p) => (
            <Link key={p.slug} to={`/${p.slug}`} className="hover:text-white">
              {p.title}
            </Link>
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
