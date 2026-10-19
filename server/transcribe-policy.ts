/** Decoded audio cap for one ambient consult clip. */
export const MAX_TRANSCRIBE_DURATION_MS = 90_000;

/**
 * Ceiling used only to derive a duration when the client omits one.
 * 512 kbit/s. A larger clip cannot be a 90 second consult at this rate.
 */
export const TRANSCRIBE_DURATION_BYTES_PER_SECOND = 64 * 1024;

export const TRANSCRIBE_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/aac", "audio/mpeg", "audio/wav"] as const;

export function canonicalTranscribeMime(mime: unknown): string | null {
  const raw = String(mime ?? "").trim();
  const base = (raw || "audio/webm").split(";")[0].trim().toLowerCase();
  return (TRANSCRIBE_MIME_TYPES as readonly string[]).includes(base) ? base : null;
}

export function base64DecodedBytes(cleanBase64: string): number {
  const trimmed = String(cleanBase64 || "").replace(/\s/g, "");
  if (!trimmed) return 0;
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

export function derivedTranscribeDurationMs(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  return Math.ceil((byteLength / TRANSCRIBE_DURATION_BYTES_PER_SECOND) * 1000);
}

/** Client duration is trusted only upward. A missing duration is derived from size. */
export function resolveTranscribeDurationMs(byteLength: number, claimed: unknown): number {
  const derived = derivedTranscribeDurationMs(byteLength);
  const explicit = Number(claimed);
  if (!Number.isFinite(explicit) || explicit <= 0) return derived;
  return Math.max(Math.round(explicit), derived);
}

export function transcribeDurationTooLong(byteLength: number, claimed: unknown): boolean {
  return resolveTranscribeDurationMs(byteLength, claimed) > MAX_TRANSCRIBE_DURATION_MS;
}
