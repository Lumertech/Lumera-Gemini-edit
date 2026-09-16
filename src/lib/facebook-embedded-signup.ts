/**
 * Meta Embedded Signup v4 client handshake.
 * Docs: FB.login({ config_id, response_type: "code", override_default_response_type: true, extras: { setup: {} } })
 * plus WA_EMBEDDED_SIGNUP postMessage (waba_id, phone_number_id).
 * Legacy sessionInfoResponse event name is also accepted.
 *
 * Lumera is not a certified Meta Tech Provider. Contact ravee@lumer.me.
 */

export const EMBEDDED_SIGNUP_SCOPES = [
  "whatsapp_business_management",
  "business_management",
  "whatsapp_business_messaging",
] as const;

export type EmbeddedSignupConfig = {
  appId: string | null;
  configId: string | null;
  graphVersion?: string;
  scopes?: string[];
  configured?: boolean;
  sandbox?: boolean;
  simulatorsEnabled?: boolean;
  notice?: string;
};

export type EmbeddedSignupSession = {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
};

type FbLoginResponse = {
  authResponse?: { code?: string; accessToken?: string };
  status?: string;
};

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }) => void;
      login: (cb: (response: FbLoginResponse) => void, opts: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;

export function loadFacebookSdk(appId: string, graphVersion = "v21.0"): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Facebook SDK requires a browser."));
  if (window.FB) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("facebook-jssdk");
    const finish = () => {
      try {
        window.FB?.init({
          appId,
          autoLogAppEvents: true,
          xfbml: false,
          version: graphVersion.startsWith("v") ? graphVersion : `v${graphVersion}`,
        });
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error("FB.init failed"));
      }
    };

    const prev = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      prev?.();
      finish();
    };

    if (existing) {
      if (window.FB) finish();
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => reject(new Error("Failed to load Facebook JavaScript SDK."));
    document.head.appendChild(script);
  });

  return sdkPromise;
}

function parseMessageData(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSessionAssets(data: Record<string, unknown>): { wabaId?: string; phoneNumberId?: string; businessId?: string } {
  const inner = (data.data && typeof data.data === "object" ? data.data : data) as Record<string, unknown>;
  return {
    wabaId: String(inner.waba_id || inner.wabaId || "").trim() || undefined,
    phoneNumberId: String(inner.phone_number_id || inner.phoneNumberId || "").trim() || undefined,
    businessId: String(inner.business_id || inner.businessId || "").trim() || undefined,
  };
}

function isEmbeddedSignupFinish(data: Record<string, unknown>): boolean {
  const type = String(data.type || "");
  const event = String(data.event || data.type || "");
  if (event === "sessionInfoResponse") return true;
  if (type !== "WA_EMBEDDED_SIGNUP") return false;
  return (
    event === "FINISH" ||
    event === "FINISH_ONLY_WABA" ||
    event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ||
    event === "sessionInfoResponse" ||
    !event
  );
}

/**
 * Launch Embedded Signup v4 and resolve with code + WABA/phone ids.
 * postMessage (session info) and FB.login callback (code) may arrive in either order.
 */
export function launchEmbeddedSignupV4(config: EmbeddedSignupConfig): Promise<EmbeddedSignupSession> {
  const appId = String(config.appId || "").trim();
  const configId = String(config.configId || "").trim();
  if (!appId || !configId) {
    return Promise.reject(
      new Error(
        "Embedded Signup is not configured (FACEBOOK_APP_ID / META_EMBEDDED_SIGNUP_CONFIG_ID). Contact ravee@lumer.me."
      )
    );
  }
  if (!window.FB) {
    return Promise.reject(new Error("Facebook JavaScript SDK is not loaded."));
  }

  const scopes = (config.scopes && config.scopes.length ? config.scopes : [...EMBEDDED_SIGNUP_SCOPES]).join(",");

  return new Promise((resolve, reject) => {
    let code = "";
    let wabaId = "";
    let phoneNumberId = "";
    let businessId = "";
    let settled = false;

    const trySettle = () => {
      if (settled || !code || !wabaId || !phoneNumberId) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve({ code, wabaId, phoneNumberId, businessId: businessId || undefined });
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      reject(new Error(message));
    };

    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin || "").endsWith("facebook.com")) return;
      const data = parseMessageData(event.data);
      if (!data || !isEmbeddedSignupFinish(data)) {
        const eventName = String(data?.event || "");
        if (eventName === "CANCEL") {
          fail("Embedded Signup was cancelled.");
        }
        return;
      }
      const assets = extractSessionAssets(data);
      if (assets.wabaId) wabaId = assets.wabaId;
      if (assets.phoneNumberId) phoneNumberId = assets.phoneNumberId;
      if (assets.businessId) businessId = assets.businessId;
      if (wabaId && !phoneNumberId && String(data.event || "") === "FINISH_ONLY_WABA") {
        fail("Embedded Signup finished without a phone number. Complete phone setup in Meta and retry.");
        return;
      }
      trySettle();
    };

    window.addEventListener("message", onMessage);

    window.FB.login(
      (response) => {
        const nextCode = String(response?.authResponse?.code || "").trim();
        if (!nextCode) {
          fail("Facebook Login did not return an Embedded Signup code. The popup may have been closed.");
          return;
        }
        code = nextCode;
        trySettle();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        // v4 permissions normally come from the Login for Business configuration.
        // Scope is still sent as requested; Meta may ignore it in favor of config_id.
        scope: scopes,
        extras: { setup: {} },
      }
    );
  });
}
