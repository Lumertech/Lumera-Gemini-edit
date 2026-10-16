/** What the upload UI does when the server answers a document write. */

export type ConsentDialogStep = "open" | "fetch" | "stay";

export function consentDialogStep(status: number, code: string, consentLoaded: boolean): ConsentDialogStep {
  const consentCode = code === "CONSENT_REQUIRED" || code === "GUARDIAN_REQUIRED";
  const gated = status === 409 || (status === 403 && consentCode);
  if (!gated) return "stay";
  return consentLoaded ? "open" : "fetch";
}
