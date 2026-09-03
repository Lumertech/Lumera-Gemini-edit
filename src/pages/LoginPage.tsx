import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { homeSurfaceForRole, useAuth } from "../auth/AuthContext";
import { useNav } from "../nav/NavigationContext";

const DEMOS = [
  { label: "Super Admin", email: "admin@lumera.me", hint: "Website, users, billing" },
  { label: "Doctor", email: "doctor@lumera.me", hint: "Clinician suite" },
  { label: "Patient", email: "patient@lumera.me", hint: "Patient portal" },
  { label: "Reception", email: "reception@lumera.me", hint: "Front desk" },
];

export const LoginPage: React.FC = () => {
  const { login, user } = useAuth();
  const { go, loginNext, loginDemo } = useNav();
  const [email, setEmail] = useState(loginDemo ? "doctor@lumera.me" : "admin@lumera.me");
  const [password, setPassword] = useState("Lumera@2026");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || busy) return;
    const dest = allowedNext(loginNext, user.role) ? loginNext : homeSurfaceForRole(user.role);
    go(dest);
  }, [user, busy, loginNext, go]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const signedIn = await login(email, password);
      const dest = allowedNext(loginNext, signedIn.role) ? loginNext : homeSurfaceForRole(signedIn.role);
      go(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
        <button type="button" onClick={() => go("landing")} className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <span className="font-manrope font-extrabold text-lg">Lumera</span>
        </button>
        <h1 className="font-manrope text-2xl font-extrabold">Sign in</h1>
        <p className="text-sm text-slate-300 mt-1 mb-6">Use a demo account or your clinic credentials.</p>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-semibold">
            Email
            <input
              className="mt-1 w-full rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label className="block text-xs font-semibold">
            Password
            <input
              className="mt-1 w-full rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 font-semibold disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Continue"}
          </button>
        </form>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {DEMOS.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => setEmail(d.email)}
              className="text-left rounded-xl border border-white/10 bg-black/20 px-3 py-2 hover:border-purple-400/50"
            >
              <div className="text-xs font-bold">{d.label}</div>
              <div className="text-[10px] text-slate-400">{d.hint}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-violet-200/60 mt-4">
          Demo password for all seeded accounts: <span className="font-mono text-purple-100">Lumera@2026</span>
        </p>
      </div>
    </div>
  );
};

function allowedNext(next: string, role: string) {
  if (next === "admin") return role === "super_admin";
  if (next === "app") return ["doctor", "receptionist", "polyclinic_admin"].includes(role);
  if (next === "portal") return role === "patient";
  return true;
}
