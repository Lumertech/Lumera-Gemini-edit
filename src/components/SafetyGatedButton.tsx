import type { ButtonHTMLAttributes, ReactNode } from "react";

/** A clinician action that stays disabled while the safety gate is closed. */
export function SafetyGatedButton({
  blocked,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { blocked: boolean; children?: ReactNode }) {
  return (
    <button type="button" {...rest} disabled={Boolean(disabled) || blocked} data-safety-gated={blocked ? "closed" : "open"}>
      {children}
    </button>
  );
}
