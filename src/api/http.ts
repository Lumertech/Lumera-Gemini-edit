/**
 * Session lives in the httpOnly `lumera_sid` cookie. Never copy it into
 * localStorage or sessionStorage (security blocker 002).
 */
const LEGACY_TOKEN_KEY = "lumera_session_token";

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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}
