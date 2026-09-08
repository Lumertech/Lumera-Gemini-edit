import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setStoredToken } from "../api/http";
import { AppUser, UserRole } from "../types";
import { Surface } from "../nav/NavigationContext";

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
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string, skipOtp?: boolean) => Promise<LoginResult>;
  oauthLogin: (provider: "google" | "facebook", profile: { email: string; name?: string; avatarUrl?: string }, skipOtp?: boolean) => Promise<LoginResult>;
  sendWhatsAppOtp: (phone: string, email?: string, purpose?: string, name?: string) => Promise<{ ok: boolean; verificationId: string; phone: string; demoOtp: string; expiresAt: string; message?: string }>;
  verifyWhatsAppOtp: (verificationId: string, otp: string, updatedPhone?: string) => Promise<{ ok: boolean; user?: AppUser; token?: string; tenantId?: string; message?: string }>;
  registerClinic: (data: RegisterClinicData) => Promise<{ requiresOtp: boolean; verificationId: string; phone: string; email: string; demoOtp: string; tenantId?: string; userId?: string; hfrId?: string; hprId?: string; message: string }>;
  completeOnboarding: (data: { specialty?: string; regNumber?: string; consultationFee?: number; qualification?: string; opdRoom?: string; opdTiming?: string }) => Promise<{ ok: boolean; user?: AppUser; message?: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; verificationId: string; phone: string; demoOtp: string; message: string }>;
  resetPassword: (verificationId: string, otp: string, newPassword: string) => Promise<{ ok: boolean; message: string }>;
  logout: () => Promise<void>;
  setUserDirectly: (u: AppUser | null) => void;
  homeSurface: Surface;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function homeSurfaceForRole(role?: UserRole, onboardingCompleted?: boolean): Surface {
  if (role === "patient") return "portal";
  if (role === "super_admin") return "admin";
  if (role === "doctor" || role === "receptionist" || role === "polyclinic_admin" || role === "CLINIC_ADMIN") {
    if (onboardingCompleted === false) return "onboarding";
    return "app";
  }
  return "login";
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ user: AppUser | null }>("/api/auth/me")
      .then((d) => {
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

  const oauthLogin = useCallback(async (provider: "google" | "facebook", profile: { email: string; name?: string; avatarUrl?: string }, skipOtp = true): Promise<LoginResult> => {
    const d = await apiFetch<LoginResult & { token?: string }>("/api/auth/oauth", {
      method: "POST",
      body: JSON.stringify({ provider, profile, skipOtp }),
    });
    if (d.token) {
      setStoredToken(d.token);
    }
    if (d.user && !d.requiresOtp) {
      setUser(d.user);
    }
    return d;
  }, []);

  const completeOnboarding = useCallback(async (data: { specialty?: string; regNumber?: string; consultationFee?: number; qualification?: string; opdRoom?: string; opdTiming?: string }) => {
    const res = await apiFetch<{ ok: boolean; user?: AppUser; message?: string }>("/api/auth/complete-onboarding", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (res.user) {
      setUser(res.user);
    }
    return res;
  }, []);

  const sendWhatsAppOtp = useCallback(async (phone: string, email?: string, purpose = "login", name = "Clinician") => {
    return await apiFetch<{ ok: boolean; verificationId: string; phone: string; demoOtp: string; expiresAt: string; message?: string }>("/api/auth/whatsapp/send-otp", {
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
      demoOtp: string;
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
    return await apiFetch<{ ok: boolean; verificationId: string; phone: string; demoOtp: string; message: string }>("/api/auth/forgot-password", {
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
      homeSurface: homeSurfaceForRole(user?.role, user?.onboardingCompleted),
    }),
    [user, loading, login, oauthLogin, sendWhatsAppOtp, verifyWhatsAppOtp, registerClinic, completeOnboarding, requestPasswordReset, resetPassword, logout, setUserDirectly]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
