import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setStoredToken } from "../api/http";
import { AppUser, UserRole } from "../types";
import { Surface } from "../nav/NavigationContext";
import { needsOnboarding } from "../lib/sessionWorkspace";

export interface LoginResult {
  requiresOtp?: boolean;
  unregistered?: boolean;
  verificationId?: string;
  phone?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  demoOtp?: string;
  user?: AppUser;
  provider?: string;
  message?: string;
  sandbox?: boolean;
  notice?: string;
}

export interface RegisterClinicData {
  practiceName?: string;
  clinicName: string;
  specialty: string;
  country: string;
  timezone: string;
  phone: string;
  name: string;
  email: string;
  password?: string;
  avatarUrl?: string;
  practiceType?: "individual" | "multispecialty" | "polyclinic";
}

export interface OnboardingPayload {
  doctorName?: string;
  clinicName?: string;
  specialty?: string;
  regNumber?: string;
  qualification?: string;
  consultationFee?: number;
  opdRoom?: string;
  opdTiming?: string;
  practiceType?: "individual" | "polyclinic" | "multispecialty";
  signatureUrl?: string;
  slotDurationMinutes?: number;
  rxTemplate?: "classic" | "compact" | "detailed";
  facilityAddress?: string;
  facilityCity?: string;
  departments?: string[];
  rosterDoctors?: Array<{
    name: string;
    specialty: string;
    qualification?: string;
    regNumber?: string;
    consultationFee?: number;
    opdTiming?: string;
  }>;
  frontDesk?: {
    walkInEnabled?: boolean;
    sharedQueue?: boolean;
    tokenPrefix?: string;
  };
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string, skipOtp?: boolean) => Promise<LoginResult>;
  oauthLogin: (
    provider: "google" | "facebook",
    profile: { email?: string; name?: string; avatarUrl?: string; code?: string; accessToken?: string; redirectUri?: string },
    skipOtp?: boolean
  ) => Promise<LoginResult>;
  sendWhatsAppOtp: (phone: string, email?: string, purpose?: string, name?: string) => Promise<{ ok: boolean; verificationId: string; phone: string; demoOtp?: string; expiresAt: string; message?: string }>;
  verifyWhatsAppOtp: (verificationId: string, otp: string, updatedPhone?: string) => Promise<{ ok: boolean; user?: AppUser; token?: string; tenantId?: string; message?: string }>;
  registerClinic: (data: RegisterClinicData) => Promise<{ requiresOtp: boolean; verificationId: string; phone: string; email: string; demoOtp?: string; tenantId?: string; userId?: string; hfrId?: string; hprId?: string; message: string }>;
  completeOnboarding: (data: OnboardingPayload) => Promise<{ ok: boolean; user?: AppUser; token?: string; homeView?: string; message?: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; verificationId: string; phone: string; demoOtp?: string; message: string }>;
  resetPassword: (verificationId: string, otp: string, newPassword: string) => Promise<{ ok: boolean; message: string }>;
  logout: () => Promise<void>;
  setUserDirectly: (u: AppUser | null) => void;
  refreshSession: () => Promise<AppUser | null>;
  homeSurface: Surface;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function homeSurfaceForRole(role?: UserRole, onboardingCompleted?: boolean, isDemoWorkspace?: boolean): Surface {
  if (role === "patient") return "portal";
  if (role === "super_admin") return "admin";
  if (role === "doctor" || role === "receptionist" || role === "polyclinic_admin" || role === "CLINIC_ADMIN") {
    if (onboardingCompleted === false && !isDemoWorkspace) return "onboarding";
    return "app";
  }
  return "login";
}

export function allowedAuthNext(next: string | undefined, role: string): boolean {
  if (!next) return false;
  if (next === "admin") return role === "super_admin";
  if (next === "onboarding") {
    return ["doctor", "receptionist", "polyclinic_admin", "CLINIC_ADMIN"].includes(role);
  }
  if (next === "app") return ["doctor", "receptionist", "polyclinic_admin", "CLINIC_ADMIN"].includes(role);
  if (next === "portal") return role === "patient";
  return true;
}

export function destinationAfterAuth(user: AppUser, requested?: Surface): Surface {
  if (needsOnboarding(user)) return "onboarding";
  if (requested && allowedAuthNext(requested, user.role) && requested !== "onboarding") return requested;
  return homeSurfaceForRole(user.role, user.onboardingCompleted, user.isDemoWorkspace);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ user: AppUser | null; token?: string }>("/api/auth/me")
      .then((d) => {
        if (d.token) {
          setStoredToken(d.token);
        }
        if (d?.user) {
          setUser(d.user);
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string, skipOtp = false): Promise<LoginResult> => {
    const d = await apiFetch<LoginResult & { token?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, skipOtp }),
    });
    if (d.token) {
      setStoredToken(d.token);
    }
    if (d.user && !d.requiresOtp) {
      setUser(d.user);
    }
    return d;
  }, []);

  const oauthLogin = useCallback(async (
    provider: "google" | "facebook",
    profile: { email?: string; name?: string; avatarUrl?: string; code?: string; accessToken?: string; redirectUri?: string },
    skipOtp = true
  ): Promise<LoginResult> => {
    const d = await apiFetch<LoginResult & { token?: string }>("/api/auth/oauth", {
      method: "POST",
      body: JSON.stringify({
        provider,
        profile: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
        code: profile.code,
        accessToken: profile.accessToken,
        redirectUri: profile.redirectUri,
        skipOtp,
      }),
    });
    if (d.token) {
      setStoredToken(d.token);
    }
    if (d.user && !d.requiresOtp) {
      setUser(d.user);
    }
    return d;
  }, []);

  const completeOnboarding = useCallback(async (data: OnboardingPayload) => {
    const res = await apiFetch<{ ok: boolean; user?: AppUser; token?: string; homeView?: string; message?: string }>(
      "/api/auth/complete-onboarding",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    if (res.token) {
      setStoredToken(res.token);
    }
    if (res.user) {
      setUser(res.user);
    }
    return res;
  }, []);

  const sendWhatsAppOtp = useCallback(async (phone: string, email?: string, purpose = "login", name = "Clinician") => {
    return await apiFetch<{ ok: boolean; verificationId: string; phone: string; demoOtp?: string; expiresAt: string; message?: string }>("/api/auth/whatsapp/send-otp", {
      method: "POST",
      body: JSON.stringify({ phone, email, purpose, name }),
    });
  }, []);

  const verifyWhatsAppOtp = useCallback(async (verificationId: string, otp: string, updatedPhone?: string) => {
    const res = await apiFetch<{ ok: boolean; user?: AppUser; token?: string; message?: string }>("/api/auth/whatsapp/verify-otp", {
      method: "POST",
      body: JSON.stringify({ verificationId, otp, updatedPhone }),
    });
    if (res.token) {
      setStoredToken(res.token);
    }
    if (res.user) {
      setUser(res.user);
    }
    return res;
  }, []);

  const registerClinic = useCallback(async (data: RegisterClinicData) => {
    return await apiFetch<{
      requiresOtp: boolean;
      verificationId: string;
      phone: string;
      email: string;
      demoOtp?: string;
      tenantId?: string;
      userId?: string;
      hfrId?: string;
      hprId?: string;
      message: string;
    }>("/api/auth/register-practice", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        practiceName: data.practiceName || data.clinicName,
      }),
    });
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    return await apiFetch<{ ok: boolean; verificationId: string; phone: string; demoOtp?: string; message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }, []);

  const resetPassword = useCallback(async (verificationId: string, otp: string, newPassword: string) => {
    return await apiFetch<{ ok: boolean; message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ verificationId, otp, newPassword }),
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setStoredToken(null);
    setUser(null);
  }, []);

  const setUserDirectly = useCallback((u: AppUser | null) => {
    setUser(u);
  }, []);

  const refreshSession = useCallback(async (): Promise<AppUser | null> => {
    const d = await apiFetch<{ user: AppUser | null; token?: string }>("/api/auth/me");
    if (d.token) {
      setStoredToken(d.token);
    }
    if (d?.user) {
      setUser(d.user);
      return d.user;
    }
    setUser(null);
    return null;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      oauthLogin,
      sendWhatsAppOtp,
      verifyWhatsAppOtp,
      registerClinic,
      completeOnboarding,
      requestPasswordReset,
      resetPassword,
      logout,
      setUserDirectly,
      refreshSession,
      homeSurface: homeSurfaceForRole(user?.role, user?.onboardingCompleted, user?.isDemoWorkspace),
    }),
    [user, loading, login, oauthLogin, sendWhatsAppOtp, verifyWhatsAppOtp, registerClinic, completeOnboarding, requestPasswordReset, resetPassword, logout, setUserDirectly, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
