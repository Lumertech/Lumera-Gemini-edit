import React, { useEffect, useState } from "react";
import {
  Sparkles,
  Phone,
  Calendar,
  Clock,
  TrendingUp,
  Bot,
  Mic,
  MicOff,
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
  Lock,
  FileCode2,
  CheckCircle2,
  Play,
  RotateCcw,
  Send,
  ExternalLink,
  ShieldAlert,
  Award
} from "lucide-react";
import { Link } from "react-router-dom";
import { LEGAL_ENTITY_NAME, PRODUCT_NAME } from "../brand";
import { BrandMark } from "./BrandMark";
import { useNav } from "../nav/NavigationContext";
import { surfaceToPath } from "../nav/surfaces";

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

export const REGIONAL_LANGUAGES = [
  { name: "Hindi", script: "हिंदी", greeting: "नमस्ते, अपॉइंटमेंट बुक करें", flag: "🇮🇳" },
  { name: "Tamil", script: "தமிழ்", greeting: "வணக்கம், முன்பதிவு செய்க", flag: "🇮🇳" },
  { name: "Telugu", script: "తెలుగు", greeting: "నమస్కారం, అపాయింట్‌మెంట్ తీసుకోండి", flag: "🇮🇳" },
  { name: "Marathi", script: "मराठी", greeting: "नमस्कार, अपॉइंटमेंट बुक करा", flag: "🇮🇳" },
  { name: "Bengali", script: "বাংলা", greeting: "নমস্কার, অ্যাপয়েন্টমেন্ট বুক করুন", flag: "🇮🇳" },
  { name: "English", script: "English", greeting: "Hello, schedule your consultation", flag: "🌐" },
];

const FALLBACK: SitePayload = {
  settings: {
    brandName: PRODUCT_NAME,
    badgeText: "ABDM-aligned AI Healthcare OS & Voice Receptionist (sandbox path)",
    heroTitle: "Next-Gen AI Receptionist & Ambient Clinical Scribe",
    heroSubtitle:
      "Automate patient call answering, 3-click WhatsApp appointment scheduling, and ambient consultation SOAP notes across regional Indian languages.",
    contactEmail: "contact@lumera.health",
    ctaPrimary: "Experience Doctor EHR",
    ctaSecondary: "Open Clinical Demo",
    ctaBannerTitle: "Ready to Supercharge Your Practice?",
    ctaBannerSubtitle: "Experience seamless AI receptionist calls, smart prescriptions, and ABDM-aligned records (sandbox path).",
    logoUrl: "",
    clinicName: PRODUCT_NAME,
  },
  stats: [
    { icon: "calendar", value: "50K+", label: "Appointments Booked" },
    { icon: "clock", value: "12K+", label: "Doctor Hours Saved" },
    { icon: "trend", value: "96%", label: "No-Show Reduction" },
    { icon: "bot", value: "24/7", label: "Multi-Lingual AI Live" },
  ],
  pains: [],
  features: [],
  personas: [],
  testimonials: [],
  policies: [
    { slug: "privacy-policy", title: "Privacy Policy" },
    { slug: "terms-of-service", title: "Terms of Service" },
    { slug: "data-deletion-instructions", title: "Data Deletion Instructions" },
    { slug: "government-data-request-policy", title: "Government Data Requests" },
    { slug: "security", title: "Data Security" },
  ],
};
