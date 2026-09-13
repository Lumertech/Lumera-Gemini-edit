import { generateTemporaryPassword, hashPassword } from "./password.ts";

/**
 * Live clinic registration fallback. Never a hardcoded shared password.
 * Admin UM create/reset already uses generateTemporaryPassword() the same way.
 */
export function liveRegistrationPasswordHash(
  providedPassword?: string | null,
  existingHash?: string | null
): { passwordHash: string; generatedPassword: string } {
  if (existingHash) return { passwordHash: existingHash, generatedPassword: "" };
  const trimmed = String(providedPassword || "").trim();
  if (trimmed) return { passwordHash: hashPassword(trimmed), generatedPassword: "" };
  const generatedPassword = generateTemporaryPassword();
  return { passwordHash: hashPassword(generatedPassword), generatedPassword };
}
