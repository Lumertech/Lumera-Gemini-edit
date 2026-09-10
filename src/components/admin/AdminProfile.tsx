import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useAuth } from "../../auth/AuthContext";
import { AppUser } from "../../types";

export const AdminProfile: React.FC = () => {
  const { user, setUserDirectly } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setEmail(user?.email || "");
    setPhone(user?.phone || "");
    setAvatarUrl(user?.avatarUrl || "");
  }, [user?.id, user?.name, user?.email, user?.phone, user?.avatarUrl]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("A valid email is required");
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword && !currentPassword) {
      setError("Enter your current password to set a new one");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ user: AppUser }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone,
          avatarUrl,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        }),
      });
      setUserDirectly(res.user);
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Profile saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-extrabold">Admin profile</h1>
        <p className="text-xs text-slate-500 mt-1">
          Your signed-in operator account. Name, phone, avatar, and optional password persist — this is not a static card.
        </p>
      </div>
      <form onSubmit={save} className="bg-white border rounded-xl p-5 space-y-3 text-sm" data-testid="admin-profile-form">
        <label className="block text-xs font-semibold">
          Name
          <input className="mt-1 w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold">
          Email
          <input type="email" className="mt-1 w-full border rounded px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold">
          Phone
          <input className="mt-1 w-full border rounded px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold">
          Avatar URL
          <input className="mt-1 w-full border rounded px-3 py-2" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        </label>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border" referrerPolicy="no-referrer" />
        ) : null}
        <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t">
          <label className="block text-xs font-semibold">
            Current password
            <input type="password" className="mt-1 w-full border rounded px-3 py-2" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="block text-xs font-semibold">
            New password
            <input type="password" className="mt-1 w-full border rounded px-3 py-2" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <p className="text-[11px] text-slate-500">Password change is optional. Leave blank to keep the current hash.</p>
        {error && <p className="text-xs text-red-600" data-testid="admin-profile-error">{error}</p>}
        {notice && <p className="text-xs text-emerald-700" data-testid="admin-profile-notice">{notice}</p>}
        <button type="submit" disabled={saving} className="px-4 py-2 bg-purple-600 text-white text-xs font-semibold rounded-lg disabled:opacity-60">
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
      <p className="text-[11px] text-slate-500">
        Role <span className="font-mono">{user.role}</span> is changed from User management, not this form.
      </p>
    </div>
  );
};
