import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Stethoscope,
  Eye,
  EyeOff,
  Building2,
  Phone,
  Mail,
  Lock,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  KeyRound,
  ArrowLeft,
  Zap,
} from "lucide-react";
import { destinationAfterAuth, useAuth } from "../auth/AuthContext";
import {
  emptyPublicLoginFields,
  LOGIN_EMAIL_PLACEHOLDER,
  LOGIN_PASSWORD_PLACEHOLDER,
  LOGIN_WHATSAPP_PLACEHOLDER,
  persistRememberedLoginEmail,
  readRememberedLoginEmail,
  REGISTER_EMAIL_PLACEHOLDER,
  REGISTER_PASSWORD_PLACEHOLDER,
  sanitizePhoneDigits,
} from "../lib/loginFormDefaults";
import { useNav } from "../nav/NavigationContext";
import {
  DEFAULT_PRACTICE_TYPE,
  initialRegisterPracticeType,
  registerPracticeTypePayload,
  type PracticeType,
} from "../lib/practiceOnboarding";
import { PolyclinicSpecialty } from "../types";
import { DEMO_LOGIN_MATRIX, DEMO_PASSWORD } from "../lib/demoAccounts";

const SPECIALTIES: PolyclinicSpecialty[] = [
  "General Medicine",
  "Cardiology",
  "Pediatrics",
  "Dermatology",
  "Orthopedics",
  "Physiotherapy & Rehabilitation",
  "Gynecology",
  "ENT",
  "Neurology",
  "Ophthalmology",
  "Dental Surgery",
  "Psychiatry & Mental Health",
];

const COUNTRIES = [
  { name: "India", code: "+91", timezone: "IST (UTC+5:30)" },
  { name: "United States", code: "+1", timezone: "EST (UTC-5:00)" },
  { name: "United Kingdom", code: "+44", timezone: "GMT (UTC+0:00)" },
  { name: "United Arab Emirates", code: "+971", timezone: "GST (UTC+4:00)" },
  { name: "Singapore", code: "+65", timezone: "SGT (UTC+8:00)" },
  { name: "Australia", code: "+61", timezone: "AEST (UTC+10:00)" },
];

export const LoginPage: React.FC = () => {
  const {
    login,
    oauthLogin,
    verifyWhatsAppOtp,
    sendWhatsAppOtp,
    registerClinic,
    requestPasswordReset,
    resetPassword,
    user,
    loading: authLoading,
    refreshSession,
  } = useAuth();
  const { go, loginNext, loginMode } = useNav();
  // Empty on first render so the public form never mounts with seeded demo credentials.
  const publicLoginDefaults = emptyPublicLoginFields();
  const rememberedEmail = readRememberedLoginEmail();

  // Mode: Sign In vs Create Clinic Account
  const [mode, setMode] = useState<"signin" | "register">(loginMode || "signin");
  const [regPracticeType, setRegPracticeType] = useState<PracticeType>(() =>
    initialRegisterPracticeType(typeof window !== "undefined" ? window.location.search : "")
  );
  const [explicitPolyclinicChoice, setExplicitPolyclinicChoice] = useState(false);

  // Sign In Sub-Method: Email & Password vs WhatsApp Phone Number
  const [signInMethod, setSignInMethod] = useState<"email" | "whatsapp">("email");

  // Sign In Form States — empty values so hint copy is placeholder-only (not a prefilled value).
  const [email, setEmail] = useState(rememberedEmail || publicLoginDefaults.email);
  const [password, setPassword] = useState(publicLoginDefaults.password);
  const [whatsappPhone, setWhatsappPhone] = useState(publicLoginDefaults.whatsappPhone);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(Boolean(rememberedEmail));

  // SSO States
  const [oauthPrompt, setOauthPrompt] = useState<null | { provider: "google" | "facebook" }>(null);
  const [oauthEmail, setOauthEmail] = useState(publicLoginDefaults.oauthEmail);
  const [oauthName, setOauthName] = useState(publicLoginDefaults.oauthName);
  const [verifiedSsoNotice, setVerifiedSsoNotice] = useState<string | null>(null);
  const [oauthConfig, setOauthConfig] = useState<{
    facebookConfigured: boolean;
    sandboxClientOAuthAllowed: boolean;
    notice?: string;
  } | null>(null);

  // Register Form States (Multi-Tenant Practice Creation)
  const [clinicName, setClinicName] = useState("");
  const [specialty, setSpecialty] = useState<PolyclinicSpecialty>("General Medicine");
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminPassword, setAdminPassword] = useState(publicLoginDefaults.adminPassword);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  // General Status & Loading
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // WhatsApp OTP Verification Flow States
  const [showOtpView, setShowOtpView] = useState(false);
  const [otpVerificationId, setOtpVerificationId] = useState("");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpPurpose, setOtpPurpose] = useState<"login" | "register">("login");
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [demoOtpCode, setDemoOtpCode] = useState("");
  const [otpCountdown, setOtpCountdown] = useState(60);
  const [canResendOtp, setCanResendOtp] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpSuccess, setOtpSuccess] = useState("");
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // Forgot Password Flow
  const [showForgot, setShowForgot] = useState(false);
  const [forgotStep, setForgotStep] = useState<"request" | "reset">("request");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotVerificationId, setForgotVerificationId] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotDemoOtp, setForgotDemoOtp] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const facebookOauthSuccessHandled = useRef(false);

  const openRegisterForm = () => {
    setMode("register");
    setRegPracticeType(DEFAULT_PRACTICE_TYPE);
    setExplicitPolyclinicChoice(false);
    setError("");
  };

  // Keep mode in sync if changed via navigation. Re-entering register always
  // reseeds Individual — URL / last click must not leave Multispecialty selected.
  useEffect(() => {
    if (loginMode) {
      setMode(loginMode);
    }
    if (loginMode === "register") {
      setRegPracticeType(DEFAULT_PRACTICE_TYPE);
      setExplicitPolyclinicChoice(false);
    }
  }, [loginMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRegPracticeType(initialRegisterPracticeType(window.location.search));
    setExplicitPolyclinicChoice(false);
  }, []);

  // Auto-redirect if already authenticated and not verifying OTP / completing Facebook OAuth.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("oauth") === "facebook" && params.get("status") === "ok") return;
    }
    if (!user || busy || showOtpView) return;
    const dest = destinationAfterAuth(user, loginNext);
    go(dest, { replace: true });
  }, [user, busy, showOtpView, loginNext, go]);

  useEffect(() => {
    fetch("/api/auth/oauth-config")
      .then((r) => r.json())
      .then((cfg) => setOauthConfig(cfg))
      .catch(() => setOauthConfig({ facebookConfigured: false, sandboxClientOAuthAllowed: true }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") !== "facebook") return;
    const oauthError = params.get("error");
    if (oauthError) {
      setError(
        oauthError === "not_configured"
          ? "Facebook Login is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET)."
          : decodeURIComponent(oauthError)
      );
    }
    if (params.get("unregistered") === "1") {
      openRegisterForm();
      const fbEmail = params.get("email") || "";
      const fbName = params.get("name") || "";
      if (fbEmail) setAdminEmail(fbEmail);
      if (fbName) setAdminName(fbName);
      setVerifiedSsoNotice(
        `Facebook identity verified (${fbEmail}). Please complete your clinic details below.`
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (authLoading || facebookOauthSuccessHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") !== "facebook" || params.get("status") !== "ok") return;

    facebookOauthSuccessHandled.current = true;
    const stripOauthQuery = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("oauth");
      url.searchParams.delete("status");
      const nextSearch = url.searchParams.toString();
      window.history.replaceState({}, "", `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`);
    };

    let cancelled = false;
    (async () => {
      setBusy(true);
      setSuccessMsg("Completing Facebook sign-in…");
      try {
        const hydrated = user ?? (await refreshSession());
        if (cancelled) return;
        stripOauthQuery();
        if (hydrated) {
          go(destinationAfterAuth(hydrated, loginNext), { replace: true });
        } else {
          setSuccessMsg("");
          setError("Facebook sign-in succeeded but the session could not be restored. Please try again.");
        }
      } catch {
        if (cancelled) return;
        stripOauthQuery();
        setSuccessMsg("");
        setError("Facebook sign-in succeeded but the session could not be restored. Please try again.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      facebookOauthSuccessHandled.current = false;
    };
  }, [authLoading, user, refreshSession, go, loginNext]);

  // OTP Countdown Timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showOtpView && otpCountdown > 0) {
      timer = setInterval(() => {
        setOtpCountdown((prev) => {
          if (prev <= 1) {
            setCanResendOtp(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [showOtpView, otpCountdown]);

  // Handle Email & Password Sign In
  const handleEmailSignIn = async (e?: React.FormEvent, skipOtp = false) => {
    if (e) e.preventDefault();
    setBusy(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await login(email.trim().toLowerCase(), password, skipOtp);
      persistRememberedLoginEmail(email, rememberMe);

      if (res.requiresOtp && res.verificationId) {
        setOtpVerificationId(res.verificationId);
        setOtpPhone(res.phone || "+91 98234 55667");
        setOtpEmail(res.email || email);
        setDemoOtpCode(res.demoOtp || "");
        setOtpPurpose("login");
        setOtpCountdown(60);
        setCanResendOtp(false);
        setOtpDigits(["", "", "", "", "", ""]);
        setOtpError("");
        setShowOtpView(true);
      } else if (res.user) {
        const dest = destinationAfterAuth(res.user, loginNext);
        go(dest, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed. Please check your credentials.");
    } finally {
      setBusy(false);
    }
  };

  // Handle WhatsApp Phone Sign In
  const handleWhatsAppSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sanitizePhoneDigits(whatsappPhone).replace(/\D/g, "")) {
      setError("Please enter your registered WhatsApp phone number.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await sendWhatsAppOtp(whatsappPhone.trim(), "", "login", "Clinician");
      if (res.ok && res.verificationId) {
        setOtpVerificationId(res.verificationId);
        setOtpPhone(res.phone || whatsappPhone);
        setOtpEmail("");
        setDemoOtpCode(res.demoOtp || "");
        setOtpPurpose("login");
        setOtpCountdown(60);
        setCanResendOtp(false);
        setOtpDigits(["", "", "", "", "", ""]);
        setOtpError("");
        setShowOtpView(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispatch WhatsApp verification code.");
    } finally {
      setBusy(false);
    }
  };

  // Quick 1-Click Demo Clinician Access
  const handleQuickDemoClinician = async () => {
    setEmail("doctor@lumera.me");
    setPassword("Lumera@2026");
    setBusy(true);
    setError("");

    try {
      const res = await login("doctor@lumera.me", "Lumera@2026", true);
      if (res.user) {
        const dest = destinationAfterAuth(res.user, loginNext);
        go(dest, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  // Handle Google & Facebook SSO
  const handleOAuthSignIn = async (
    provider: "google" | "facebook",
    chosenEmail?: string,
    chosenName?: string
  ) => {
    setBusy(true);
    setError("");
    setSuccessMsg("");
    setOauthPrompt(null);

    if (provider === "facebook" && oauthConfig?.facebookConfigured) {
      window.location.href = "/api/auth/facebook";
      return;
    }

    if (provider === "facebook" && !oauthConfig?.sandboxClientOAuthAllowed) {
      setBusy(false);
      setError("Facebook Login is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.");
      return;
    }

    const targetEmail = (chosenEmail || oauthEmail || "rdp9999973271@gmail.com").trim().toLowerCase();
    const targetName = (
      chosenName ||
      oauthName ||
      (provider === "google" ? "Dr. Rajiv Saxena" : "Dr. Clinician")
    ).trim();

    try {
      const res = await oauthLogin(
        provider,
        {
          email: targetEmail,
          name: targetName,
          avatarUrl: "",
        },
        true
      );

      if (res.unregistered) {
        openRegisterForm();
        setAdminEmail(targetEmail);
        setAdminName(targetName);
        setVerifiedSsoNotice(
          res.sandbox
            ? `SANDBOX / DEV-ONLY ${provider} email (${targetEmail}) — not Graph-verified. Complete clinic details below.`
            : `${provider === "google" ? "Google" : "Facebook"} identity verified (${targetEmail}). Please complete your clinic details below.`
        );
        setSuccessMsg(
          res.sandbox
            ? `SANDBOX / DEV-ONLY: client-supplied ${provider} email accepted because NODE_ENV is not production.`
            : `Identity verified via ${provider === "google" ? "Google" : "Facebook"} SSO. Finish setting up your clinic account below.`
        );
      } else if (res.requiresOtp && res.verificationId) {
        setOtpVerificationId(res.verificationId);
        setOtpPhone(res.phone || "+91 98234 55667");
        setOtpEmail(res.email || targetEmail);
        setDemoOtpCode(res.demoOtp || "");
        setOtpPurpose("login");
        setOtpCountdown(60);
        setCanResendOtp(false);
        setOtpDigits(["", "", "", "", "", ""]);
        setOtpError("");
        setShowOtpView(true);
      } else if (res.user) {
        const dest = destinationAfterAuth(res.user, loginNext);
        go(dest, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO Authorization failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Handle Practice Registration Submit
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccessMsg("");

    const fullPhone = adminPhone.startsWith("+")
      ? adminPhone
      : `${selectedCountry.code} ${adminPhone.trim()}`;

    try {
      const res = await registerClinic({
        clinicName: clinicName.trim(),
        specialty,
        country: selectedCountry.name,
        timezone: selectedCountry.timezone,
        phone: fullPhone,
        name: adminName.trim(),
        email: adminEmail.trim().toLowerCase(),
        password: adminPassword,
        practiceType: registerPracticeTypePayload(regPracticeType, explicitPolyclinicChoice),
      });

      if (res.requiresOtp && res.verificationId) {
        setOtpVerificationId(res.verificationId);
        setOtpPhone(res.phone || fullPhone);
        setOtpEmail(res.email || adminEmail);
        setDemoOtpCode(res.demoOtp || "");
        setOtpPurpose("register");
        setOtpCountdown(60);
        setCanResendOtp(false);
        setOtpDigits(["", "", "", "", "", ""]);
        setOtpError("");
        setShowOtpView(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register practice.");
    } finally {
      setBusy(false);
    }
  };

  // Handle OTP Digit Change
  const handleOtpDigitChange = (index: number, val: string) => {
    const sanitized = val.replace(/\D/g, "");
    const newDigits = [...otpDigits];

    if (sanitized.length > 1) {
      const pasted = sanitized.slice(0, 6).split("");
      pasted.forEach((d, idx) => {
        newDigits[idx] = d;
      });
      setOtpDigits(newDigits);
      otpInputRefs.current[Math.min(pasted.length, 5)]?.focus();
      return;
    }

    newDigits[index] = sanitized;
    setOtpDigits(newDigits);

    if (sanitized && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    const fullOtp = otpDigits.join("").trim();
    if (fullOtp.length !== 6) {
      setOtpError("Please enter the complete 6-digit verification code.");
      return;
    }

    setIsVerifyingOtp(true);
    setOtpError("");

    try {
      const res = await verifyWhatsAppOtp(otpVerificationId, fullOtp);

      if (res.ok && res.user) {
        setOtpSuccess(
          otpPurpose === "register"
            ? "WhatsApp verified. Opening your practice onboarding wizard..."
            : "WhatsApp verified. Opening your workspace..."
        );
        setTimeout(() => {
          setShowOtpView(false);
          const dest = destinationAfterAuth(res.user!, loginNext);
          go(dest, { replace: true });
        }, 500);
      } else {
        setOtpError(res.message || "Verification failed. Please check your code.");
      }
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Verification code rejected.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (!canResendOtp) return;
    setCanResendOtp(false);
    setOtpCountdown(60);
    setOtpError("");

    try {
      const res = await sendWhatsAppOtp(
        otpPhone,
        otpEmail,
        otpPurpose,
        mode === "register" ? adminName : "Clinician"
      );
      setOtpVerificationId(res.verificationId);
      setDemoOtpCode(res.demoOtp || "");
      setOtpSuccess("Fresh 6-digit OTP code sent to your WhatsApp.");
      setTimeout(() => setOtpSuccess(""), 4000);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Failed to resend code.");
      setCanResendOtp(true);
    }
  };

  // Auto-fill OTP (for quick evaluation / testing)
  const handleAutoFillOtp = () => {
    if (!demoOtpCode) return;
    setOtpDigits(demoOtpCode.slice(0, 6).split(""));
    setOtpError("");
    otpInputRefs.current[5]?.focus();
  };

  // Forgot Password Request
  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotError("");
    setForgotSuccess("");

    try {
      const res = await requestPasswordReset(forgotEmail.trim().toLowerCase());
      setForgotVerificationId(res.verificationId);
      setForgotDemoOtp(res.demoOtp || "");
      setForgotStep("reset");
      setForgotSuccess("Verification OTP dispatched to your registered WhatsApp.");
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Failed to initiate password recovery.");
    } finally {
      setForgotBusy(false);
    }
  };

  // Forgot Password Reset
  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotError("");
    setForgotSuccess("");

    try {
      const res = await resetPassword(forgotVerificationId, forgotOtp.trim(), forgotNewPassword);
      setForgotSuccess(res.message || "Password successfully reset!");
      setTimeout(() => {
        setShowForgot(false);
        setForgotStep("request");
        setEmail(forgotEmail);
        setPassword(forgotNewPassword);
        setSuccessMsg("Password reset successfully. Please sign in.");
      }, 1000);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div
      data-testid="public-login"
      className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-y-contain bg-slate-950 text-slate-100 relative font-sans"
    >
      {/* Background Glow Accents — clipped so they never create horizontal scroll */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-32 -left-32 w-80 h-80 bg-purple-600/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-indigo-600/15 rounded-full blur-3xl" />
      </div>

      <div
        className={`min-h-full w-full flex justify-center px-3 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8 ${
          mode === "register" || showOtpView || showForgot ? "items-start" : "items-center"
        }`}
      >
      {/* Main Single-Card Container */}
      <div
        data-testid="auth-card"
        data-mode={mode}
        className={`w-full min-w-0 rounded-2xl border border-slate-800/90 bg-slate-900/90 shadow-2xl shadow-purple-950/40 backdrop-blur-xl p-4 sm:p-6 md:p-8 relative z-10 ${
          mode === "register" ? "max-w-lg md:max-w-xl xl:max-w-2xl" : "max-w-lg"
        }`}
      >
        
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-5 sm:mb-6">
          <button
            type="button"
            onClick={() => go("landing", { explicitPublic: true })}
            className="flex items-center gap-2.5 sm:gap-3 group focus:outline-none mb-2 min-w-0 max-w-full"
          >
            <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-purple-500 via-indigo-600 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:scale-105 transition-transform p-1.5">
              <img src="/lumera-logo.svg" alt="Lumera Logo" className="h-full w-full object-contain" />
            </div>
            <div className="text-left min-w-0">
              <span className="font-extrabold text-lg sm:text-xl tracking-tight text-white block">Lumera Health</span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-purple-400 block -mt-0.5 leading-tight">
                Enterprise Clinical & Practice Suite
              </span>
            </div>
          </button>
        </div>

        {/* Global Notifications */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* CASE A: OTP Verification View (Integrated within same card)    */}
        {/* ------------------------------------------------------------- */}
        {showOtpView ? (
          <div className="space-y-5">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-green-500/20 text-green-400 border border-green-500/30 mb-3">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-white">WhatsApp Verification Code</h2>
              <p className="text-xs text-slate-400 mt-1">
                Enter the 6-digit code sent to <span className="font-semibold text-slate-200">{otpPhone}</span>
              </p>
            </div>

            {/* Test Helper Chip (Shows live OTP for fast testing) */}
            {demoOtpCode && (
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-between text-xs">
                <span className="text-purple-300 flex items-center gap-1.5 font-medium">
                  <KeyRound className="w-3.5 h-3.5 text-purple-400" />
                  Test OTP: <strong className="font-mono text-white tracking-widest">{demoOtpCode}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleAutoFillOtp}
                  className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold transition-colors"
                >
                  Auto-fill
                </button>
              </div>
            )}

            {otpError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{otpError}</span>
              </div>
            )}

            {otpSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{otpSuccess}</span>
              </div>
            )}

            {/* 6 Digit Input Boxes */}
            <div className="flex justify-center gap-1.5 sm:gap-2.5 py-1 max-w-full">
              {otpDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (otpInputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  autoFocus={index === 0}
                  className="h-12 w-9 min-w-0 max-w-12 flex-1 sm:w-12 sm:h-14 sm:flex-none text-center text-lg sm:text-xl font-mono font-bold bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
                />
              ))}
            </div>

            {/* Verification Button */}
            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={isVerifyingOtp || otpDigits.join("").length !== 6}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-sm transition-all shadow-lg shadow-purple-600/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isVerifyingOtp ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" /> Verify & Access Workspace
                </>
              )}
            </button>

            {/* Resend & Return to Login Controls */}
            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowOtpView(false);
                  setOtpDigits(["", "", "", "", "", ""]);
                }}
                className="hover:text-white flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
              </button>

              <div>
                {canResendOtp ? (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    className="text-purple-400 hover:text-purple-300 font-semibold"
                  >
                    Resend Code
                  </button>
                ) : (
                  <span>Resend in {otpCountdown}s</span>
                )}
              </div>
            </div>
          </div>
        ) : showForgot ? (
          /* ------------------------------------------------------------- */
          /* CASE B: Inline Forgot Password Form                           */
          /* ------------------------------------------------------------- */
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => {
                  setShowForgot(false);
                  setForgotStep("request");
                }}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-base font-bold text-white">Reset Account Password</h2>
            </div>

            {forgotError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {forgotError}
              </div>
            )}
            {forgotSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                {forgotSuccess}
              </div>
            )}

            {forgotStep === "request" ? (
              <form onSubmit={handleForgotRequest} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Registered Work Email
                  </label>
                  <input
                    id="forgot-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder={REGISTER_EMAIL_PLACEHOLDER}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotBusy}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-colors"
                >
                  {forgotBusy ? "Sending..." : "Dispatch Recovery Code"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleForgotReset} className="space-y-3">
                {forgotDemoOtp && (
                  <div className="p-2 rounded bg-purple-500/10 border border-purple-500/30 text-xs text-purple-300">
                    OTP Code: <strong>{forgotDemoOtp}</strong>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">6-Digit Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">New Password</label>
                  <input
                    id="forgot-new-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={forgotNewPassword}
                    onChange={(e) => setForgotNewPassword(e.target.value)}
                    placeholder={REGISTER_PASSWORD_PLACEHOLDER}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotBusy}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-colors"
                >
                  {forgotBusy ? "Updating..." : "Update Password & Return"}
                </button>
              </form>
            )}
          </div>
        ) : (
          /* ------------------------------------------------------------- */
          /* CASE C: Consolidated Two-Choice Interface                     */
          /* ------------------------------------------------------------- */
          <div>
            {/* 1. SIGN IN FORM */}
            {mode === "signin" ? (
              <div className="space-y-4">
                {/* Switch Sign-in input: Email vs WhatsApp Phone */}
                <div className="flex items-center justify-between text-xs pb-1">
                  <span className="text-slate-400">Sign in with:</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSignInMethod("email")}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        signInMethod === "email"
                          ? "bg-purple-600/30 text-purple-300 border border-purple-500/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Email & Password
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignInMethod("whatsapp")}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        signInMethod === "whatsapp"
                          ? "bg-green-600/30 text-green-300 border border-green-500/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      WhatsApp Number
                    </button>
                  </div>
                </div>

                {signInMethod === "email" ? (
                  <form onSubmit={(e) => handleEmailSignIn(e)} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Work Email
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <input
                          id="login-email"
                          name="email"
                          type="email"
                          autoComplete="username"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={LOGIN_EMAIL_PLACEHOLDER}
                          className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-300">
                          Password
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setShowForgot(true);
                            setForgotEmail(email);
                          }}
                          className="text-[11px] text-purple-400 hover:text-purple-300"
                        >
                          Forgot?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <input
                          id="login-password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={LOGIN_PASSWORD_PLACEHOLDER}
                          className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setRememberMe(next);
                            if (!next) persistRememberedLoginEmail("", false);
                          }}
                          className="rounded bg-slate-950 border-slate-700 text-purple-600 focus:ring-purple-500"
                        />
                        <span>Remember email</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-md shadow-purple-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> Signing In...
                        </>
                      ) : (
                        <>
                          Sign In to Clinic Workspace <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleWhatsAppSignIn} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Registered WhatsApp Phone Number
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <input
                          id="login-whatsapp"
                          name="tel"
                          type="tel"
                          autoComplete="tel"
                          required
                          inputMode="numeric"
                          pattern="[0-9+]*"
                          value={whatsappPhone}
                          onChange={(e) => setWhatsappPhone(sanitizePhoneDigits(e.target.value))}
                          placeholder={LOGIN_WHATSAPP_PLACEHOLDER}
                          className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        A 6-digit OTP code will be dispatched to your WhatsApp.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-md shadow-green-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> Dispatching OTP...
                        </>
                      ) : (
                        <>
                          <MessageSquare className="w-4 h-4" /> Send WhatsApp Verification Code
                        </>
                      )}
                    </button>
                  </form>
                )}

                {/* Google & Facebook SSO Section */}
                <div className="pt-3 border-t border-slate-800/80">
                  <div className="relative my-2.5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-800" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-slate-900 px-2 text-slate-400 font-medium">Or continue with</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 mb-3">
                    <button
                      type="button"
                      onClick={() => handleOAuthSignIn("google")}
                      disabled={busy}
                      className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800/90 border border-slate-700/80 hover:border-slate-600 text-xs font-semibold text-slate-200 transition-all hover:shadow-sm"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                      <span>Google</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOAuthSignIn("facebook")}
                      disabled={busy}
                      className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800/90 border border-slate-700/80 hover:border-slate-600 text-xs font-semibold text-slate-200 transition-all hover:shadow-sm"
                    >
                      <svg className="w-4 h-4 fill-[#1877F2]" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                      <span>Facebook</span>
                    </button>
                  </div>
                  {oauthConfig && !oauthConfig.facebookConfigured && oauthConfig.sandboxClientOAuthAllowed && (
                    <p className="text-[11px] text-amber-400/90 mb-2">
                      SANDBOX / DEV-ONLY: Facebook App credentials are unset, so the Facebook button still posts a client email. This path is disabled in production.
                    </p>
                  )}
                </div>

                {/* SANDBOX demo matrix */}
                <div className="pt-2 border-t border-slate-800/60 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/90 font-semibold">SANDBOX / DEMO logins · password {DEMO_PASSWORD}</p>
                  <p className="text-[10px] text-slate-500" data-testid="admin-password-login-note">
                    `admin@lumera.me` / super_admin completes on email+password (no WhatsApp OTP). Clinician and patient logins still require OTP on production.
                  </p>
                  <select
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                    onChange={(e) => {
                      const acct = DEMO_LOGIN_MATRIX.find((a) => a.email === e.target.value);
                      if (!acct) return;
                      setEmail(acct.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    data-testid="demo-account-picker"
                  >
                    <option value="">Fill a demo account…</option>
                    {DEMO_LOGIN_MATRIX.map((a) => (
                      <option key={a.email} value={a.email}>
                        {a.email} · {a.role} · {a.practiceLine}{a.displaySpecialty || a.specialty ? ` · ${a.displaySpecialty || a.specialty}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleQuickDemoClinician}
                    disabled={busy}
                    className="w-full py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Quick Demo Clinician Access (Dr. Vikram Malhotra)</span>
                  </button>
                </div>
              </div>
            ) : (
              /* 2. CREATE CLINIC ACCOUNT FORM */
              <form
                id="create-clinic-form"
                data-testid="create-clinic-form"
                onSubmit={handleRegisterSubmit}
                className="space-y-3.5 min-w-0 w-full"
              >
                {verifiedSsoNotice && (
                  <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-600/40 text-purple-300 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shadow-sm">
                    <div className="flex items-start gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                      <span className="break-words">{verifiedSsoNotice}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVerifiedSsoNotice(null)}
                      className="text-slate-400 hover:text-white text-[11px] underline self-start sm:self-auto shrink-0 min-h-11 sm:min-h-0 px-1"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Fast SSO Registration Strip */}
                {!verifiedSsoNotice && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-400 font-medium">Or pre-fill with single sign-on:</span>
                    </div>
                    <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleOAuthSignIn("google")}
                        className="flex items-center justify-center gap-1.5 min-h-11 py-2 px-2 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-700 text-[11px] font-medium text-slate-200"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                        </svg>
                        <span>Google Sign-In</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOAuthSignIn("facebook")}
                        className="flex items-center justify-center gap-1.5 min-h-11 py-2 px-2 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-700 text-[11px] font-medium text-slate-200"
                      >
                        <svg className="w-3.5 h-3.5 fill-[#1877F2]" viewBox="0 0 24 24">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                        </svg>
                        <span>Facebook Sign-In</span>
                      </button>
                    </div>
                  </div>
                )}
                {/* Practice Account Type — Individual is the default; multi-specialty is explicit opt-in */}
                <div
                  className="space-y-1.5 mb-3"
                  data-testid="register-practice-type"
                  data-default="individual"
                  data-selected={regPracticeType}
                >
                  <label className="block text-xs font-semibold text-slate-300">
                    Practice type *
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRegPracticeType("individual");
                        setExplicitPolyclinicChoice(false);
                      }}
                      data-testid="register-practice-individual"
                      data-selected={regPracticeType === "individual" ? "true" : "false"}
                      aria-pressed={regPracticeType === "individual"}
                      className={`p-3 min-h-11 rounded-xl border text-left transition-all cursor-pointer ${
                        regPracticeType === "individual"
                          ? "bg-emerald-950/40 border-emerald-500 text-white shadow-sm"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <Stethoscope className="w-3.5 h-3.5 text-emerald-400" />
                        Individual practice
                      </div>
                      <div className="text-[10px] text-emerald-400/80 mt-0.5 font-medium">Default — solo clinician</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRegPracticeType("polyclinic");
                        setExplicitPolyclinicChoice(true);
                      }}
                      data-testid="register-practice-polyclinic"
                      data-selected={regPracticeType === "polyclinic" ? "true" : "false"}
                      aria-pressed={regPracticeType === "polyclinic"}
                      className={`p-3 min-h-11 rounded-xl border text-left transition-all cursor-pointer ${
                        regPracticeType === "polyclinic"
                          ? "bg-indigo-950/50 border-indigo-400 text-white shadow-sm"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-indigo-300" />
                        Multi-specialty / polyclinic
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Opt-in — admin + roster</div>
                    </button>
                  </div>
                </div>

                {/* Practice Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Practice / Clinic Name *
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={clinicName}
                      onChange={(e) => setClinicName(e.target.value)}
                      placeholder={
                        regPracticeType === "polyclinic"
                          ? "e.g. City Care Multispecialty Hospital"
                          : "e.g. Dr. Mehta Clinic"
                      }
                      className="w-full min-h-11 pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                {/* Primary Specialty & Country */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {regPracticeType === "polyclinic" ? "Primary department" : "Your specialty"}
                    </label>
                    <select
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value as PolyclinicSpecialty)}
                      className="w-full min-h-11 min-w-0 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      {SPECIALTIES.map((s) => (
                        <option key={s} value={s} className="bg-slate-900 text-white">
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Country & Timezone
                    </label>
                    <select
                      value={selectedCountry.name}
                      onChange={(e) => {
                        const found = COUNTRIES.find((c) => c.name === e.target.value);
                        if (found) setSelectedCountry(found);
                      }}
                      className="w-full min-h-11 min-w-0 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.name} value={c.name} className="bg-slate-900 text-white">
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Director Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {regPracticeType === "polyclinic"
                      ? "Practice director / clinic admin *"
                      : "Your name (as on medical registration) *"}
                  </label>
                  <div className="relative">
                    <Stethoscope className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      id="register-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="Dr. Vikram Malhotra"
                      className="w-full min-h-11 pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                {/* Email & Phone */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Work Email *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        id="register-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder={REGISTER_EMAIL_PLACEHOLDER}
                        className="w-full min-h-11 min-w-0 pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      WhatsApp Phone *
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        id="register-phone"
                        name="tel"
                        type="tel"
                        autoComplete="tel"
                        required
                        inputMode="numeric"
                        pattern="[0-9+]*"
                        value={adminPhone}
                        onChange={(e) => setAdminPhone(sanitizePhoneDigits(e.target.value))}
                        placeholder={`${selectedCountry.code} 98234 55667`}
                        className="w-full min-h-11 min-w-0 pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Secure Master Password *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      id="register-password"
                      name="new-password"
                      type={showRegisterPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder={REGISTER_PASSWORD_PLACEHOLDER}
                      className="w-full min-h-11 pl-9 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-slate-400 hover:text-white"
                    >
                      {showRegisterPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Quota Highlights Card */}
                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                  <span className="flex items-start sm:items-center gap-1.5 font-medium min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5 sm:mt-0" />
                    <span className="leading-snug">Starter Enterprise Tier • 30-Day Free Trial • 500 AI Scribe Mins</span>
                  </span>
                  <span className="font-mono text-xs text-emerald-400 font-bold shrink-0">NHA sandbox</span>
                </div>

                {/* Desktop submit — phone uses the sticky action bar so the CTA is never clipped */}
                <button
                  type="submit"
                  disabled={busy}
                  className="hidden md:flex w-full min-h-11 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-md shadow-purple-600/30 items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Provisioning Practice...
                    </>
                  ) : (
                    <>
                      {regPracticeType === "polyclinic"
                        ? "Create multi-specialty clinic"
                        : "Create individual practice"}{" "}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Sign-in: create-account CTA. Register: sticky on phone so submit stays in view. */}
        {mode === "signin" && !showOtpView && !showForgot ? (
        <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                openRegisterForm();
                go("login", { loginMode: "register" });
              }}
              className="w-full min-h-11 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-600/30 group"
            >
              <Sparkles className="w-4 h-4 text-emerald-200 group-hover:text-white" />
              <span>Create new practice account</span>
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              New accounts start as an <span className="text-slate-300">individual practice</span>. Multi-specialty is an explicit opt-in.
            </p>
        </div>
        ) : mode === "register" && !showOtpView && !showForgot ? (
        <div
          data-testid="register-sticky-actions"
          className="sticky bottom-0 z-20 -mx-4 mt-4 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-slate-900 via-slate-900/95 to-slate-900/70 border-t border-slate-800/80 md:static md:mx-0 md:mt-6 md:px-0 md:pt-0 md:pb-0 md:bg-none md:border-0"
        >
            <button
              type="submit"
              form="create-clinic-form"
              disabled={busy}
              className="md:hidden w-full min-h-11 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-md shadow-purple-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Provisioning Practice...
                </>
              ) : (
                <>
                  {regPracticeType === "polyclinic"
                    ? "Create multi-specialty clinic"
                    : "Create individual practice"}{" "}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError("");
                go("login", { loginMode: "signin" });
              }}
              className="w-full min-h-11 mt-2 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-white text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm group"
            >
              <span>Already have an account?</span>
              <span className="text-emerald-400 group-hover:text-emerald-300">Sign In</span>
            </button>
        </div>
        ) : null}

        <div className={`mt-6 pt-4 border-t border-slate-800/80 text-center text-[11px] sm:text-xs text-slate-500 items-center justify-center gap-2 px-1 ${mode === "register" ? "hidden md:flex" : "flex"}`}>
          <span className="leading-relaxed">Protected by AES-256 GCM · Designed for ABDM (NHA sandbox path)</span>
        </div>
      </div>
      </div>
    </div>
  );
}
