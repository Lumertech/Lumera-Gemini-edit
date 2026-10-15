/**
 * Session lives in the httpOnly `lumera_sid` cookie. Never copy it into
 * localStorage or sessionStorage (security blocker 002).
 */
const LEGACY_TOKEN_KEY = "lumera_session_token";
/** Must match server `CSRF_REFRESHED_CODE`. One automatic retry, then surface the error. */
const CSRF_REFRESHED = "CSRF_REFRESHED";

type ApiErrorBody = { error?: string; code?: string; csrfToken?: string };

function csrfTokenFromRefresh(res: Response, data: ApiErrorBody): string {
  const fromBody = String(data.csrfToken || "").trim();
  if (fromBody) return fromBody;
  return String(res.headers.get("X-CSRF-Token") || "").trim();
}

export function purgeLegacyAuthToken() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
  try {
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetchOnce<T>(path, init, false);
}

async function apiFetchOnce<T>(path: string, init: RequestInit, retried: boolean): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!headers.has("X-CSRF-Token") && typeof document !== "undefined") {
    try {
      const match = document.cookie.match(/(?:^|; )lumera_csrf=([^;]*)/);
      if (match?.[1]) headers.set("X-CSRF-Token", decodeURIComponent(match[1]));
    } catch {
      /* ignore cookie parse errors */
    }
  }

  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    const refreshed = res.status === 403 && data.code === CSRF_REFRESHED;
    const nextToken = refreshed ? csrfTokenFromRefresh(res, data) : "";
    if (refreshed && nextToken && !retried) {
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("X-CSRF-Token", nextToken);
      return apiFetchOnce<T>(path, { ...init, headers: retryHeaders }, true);
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}
