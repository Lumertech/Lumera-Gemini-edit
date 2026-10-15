import React from "react";

/**
 * User-controlled text (patient names, clinical notes, WhatsApp bodies) as a
 * React text node so markup in the value cannot run. Keep this as text.
 */
export function InertText({ value }: { value: unknown }) {
  if (value == null || value === false) return null;
  return <>{String(value)}</>;
}
