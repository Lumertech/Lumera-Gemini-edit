/** Pilot switch. Unset means a missing WhatsApp line does not fall back to the demo clinic. */
export function mayaDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(env.MAYA_DEMO_MODE || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}
