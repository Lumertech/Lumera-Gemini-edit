import type { Patient } from "../types";

export function phoneKey10(phone?: string | null): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function samePhone10(a?: string | null, b?: string | null): boolean {
  const ka = phoneKey10(a);
  const kb = phoneKey10(b);
  return ka.length >= 10 && ka === kb;
}

export function matchingPhoneProfiles(patients: Patient[], phone?: string | null): Patient[] {
  const key = phoneKey10(phone);
  if (key.length < 10) return [];
  return patients.filter((p) => p.id && phoneKey10(p.phone) === key);
}

export function inferHouseholdHolderName(peers: Patient[]): string {
  const selfProfile = peers.find(
    (p) => (p.relationshipToHolder || "Self") === "Self" && (!p.species || p.species.toLowerCase() === "human")
  );
  if (selfProfile?.name) return selfProfile.name;
  const withHolder = peers.find((p) => p.primaryContactName || p.ownerName);
  if (withHolder?.primaryContactName) return withHolder.primaryContactName;
  if (withHolder?.ownerName) return withHolder.ownerName;
  const firstEmergency = peers[0]?.emergencyContact || "";
  if (firstEmergency && !/^\+?\d[\d\s()-]{6,}$/.test(firstEmergency.trim())) {
    return firstEmergency;
  }
  return "";
}

export function profileKindBadge(p: Patient): { icon: string; label: string; isPet: boolean } {
  const sp = String(p.species || "").trim().toLowerCase();
  if (sp && sp !== "human") {
    const icon = sp === "cat" ? "🐱" : "🐾";
    const spTitle = sp.charAt(0).toUpperCase() + sp.slice(1);
    const holder = p.primaryContactName || p.ownerName || "";
    const parts = [spTitle, p.breed || "", holder ? `Owner: ${holder}` : ""].filter(Boolean);
    return { icon, label: parts.join(" • "), isPet: true };
  }
  const rel = String(p.relationshipToHolder || "Self").trim() || "Self";
  if (rel !== "Self") {
    const icon = rel === "Child" ? "👶" : "👥";
    const holder = p.primaryContactName || "";
    return {
      icon,
      label: holder ? `${rel} • ${holder}` : rel,
      isPet: false,
    };
  }
  return { icon: "👤", label: "Self", isPet: false };
}
