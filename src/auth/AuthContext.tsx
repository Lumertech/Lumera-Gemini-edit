import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setStoredToken } from "../api/http";
import { AppUser, UserRole } from "../types";
import { Surface } from "../nav/NavigationContext";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AppUser>;
  logout: () => Promise<void>;
  homeSurface: Surface;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function homeSurfaceForRole(role?: UserRole): Surface {
  if (role === "patient") return "portal";
  if (role === "super_admin") return "admin";
  if (role === "doctor" || role === "receptionist" || role === "polyclinic_admin") return "app";
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

  const login = useCallback(async (email: string, password: string) => {
    const d = await apiFetch<{ user: AppUser; token?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (d.token) {
      setStoredToken(d.token);
    }
    setUser(d.user);
    return d.user;
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

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      homeSurface: homeSurfaceForRole(user?.role),
    }),
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
