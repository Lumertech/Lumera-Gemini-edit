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

/**
 * First `lumera_csrf` in `document.cookie`. HttpOnly `__session` is not visible
 * here. localStorage and sessionStorage are never read — a stale token there
 * must not win over the cookie, and the retry path does not call this at all.
 */
function csrfTokenFromDocument(): string {
  if (typeof document === "undefined") return "";
  try {
    const match = document.cookie.match(/(?:^|; )lumera_csrf=([^;]*)/);
    if (!match?.[1]) return "";
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

/**
 * A string or FormData can be sent twice. A ReadableStream cannot: the first
 * fetch locks it, and the retry throws. Tee before the first request so the
 * retry still has a body.
 */
function splitRequestBody(body: BodyInit | null | undefined): {
  send: BodyInit | null | undefined;
  retry: () => BodyInit | null | undefined;
  cancelUnused: () => void;
} {
  if (
    body == null ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return { send: body, retry: () => body, cancelUnused: () => undefined };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    const [first, second] = body.tee();
    let consumed = false;
    return {
      send: first,
      retry: () => {
        consumed = true;
        return second;
      },
      cancelUnused: () => {
        if (!consumed) void second.cancel().catch(() => undefined);
      },
    };
  }
  return { send: body, retry: () => body, cancelUnused: () => undefined };
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
  const split = splitRequestBody(init.body);
  try {
    return await apiFetchOnce<T>(path, init, split, false);
  } finally {
    split.cancelUnused();
  }
}

async function apiFetchOnce<T>(
  path: string,
  init: RequestInit,
  split: ReturnType<typeof splitRequestBody>,
  retried: boolean
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Retry must keep the token from the refresh response. Reading document.cookie
  // again would put the stale lumera_csrf back on the second request.
  if (!retried && !headers.has("X-CSRF-Token")) {
    const token = csrfTokenFromDocument();
    if (token) headers.set("X-CSRF-Token", token);
  }

  const res = await fetch(path, {
    ...init,
    body: retried ? split.retry() : split.send,
    credentials: "include",
    headers,
  });
  const parsed = await res.json().catch(() => ({}));
  const data = (parsed && typeof parsed === "object" ? parsed : {}) as ApiErrorBody;
  if (!res.ok) {
    const refreshed = res.status === 403 && data.code === CSRF_REFRESHED;
    const nextToken = refreshed ? csrfTokenFromRefresh(res, data) : "";
    if (refreshed && nextToken && !retried) {
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("X-CSRF-Token", nextToken);
      return apiFetchOnce<T>(path, { ...init, headers: retryHeaders }, split, true);
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}
