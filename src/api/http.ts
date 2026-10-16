/**
 * Session lives in the httpOnly `__session` / `lumera_sid` cookie.
 * Never copy it into localStorage or sessionStorage, and never send
 * Authorization or X-Session-Token. The server omits `token` on browser
 * login (`clientMayUseSessionToken`). This web client also drops a top-level
 * `token` from every JSON body. Native clients that need a bearer read it
 * from the login JSON; they do not use this module.
 */
const LEGACY_TOKEN_KEY = "lumera_session_token";
/** Must match server `CSRF_REFRESHED_CODE`. One automatic retry, then surface the error. */
const CSRF_REFRESHED = "CSRF_REFRESHED";

type ApiErrorBody = { error?: string; code?: string; csrfToken?: string };

/**
 * Secret from the newest API response (`csrfToken` or `X-CSRF-Token`).
 * Firebase Hosting never forwards `lumera_csrf`, so a value read from that
 * cookie does not match anything the server can see. The response token does.
 * Login rotates the secret (#134). A response that started earlier — typically
 * `/api/auth/me` still in flight — must not overwrite that rotated secret.
 */
let csrfFromServer = "";
let csrfAppliedSeq = 0;
let csrfSeq = 0;

export function clearRememberedCsrfToken(): void {
  csrfFromServer = "";
  csrfAppliedSeq = 0;
  csrfSeq = 0;
}

function takeCsrfSeq(): number {
  csrfSeq += 1;
  return csrfSeq;
}

/** `seq` is the request's start order. An older in-flight response cannot replace a newer secret. */
function rememberCsrfToken(token: string, seq: number): void {
  const next = token.trim();
  if (!next || seq < csrfAppliedSeq) return;
  csrfFromServer = next;
  csrfAppliedSeq = seq;
}

function csrfTokenFromRefresh(res: Response, data: ApiErrorBody): string {
  const fromBody = String(data.csrfToken || "").trim();
  if (fromBody) return fromBody;
  return String(res.headers.get("X-CSRF-Token") || "").trim();
}

function rememberCsrf(res: Response, data: ApiErrorBody, seq: number): void {
  rememberCsrfToken(csrfTokenFromRefresh(res, data), seq);
}

function csrfBody(res: Response): Promise<ApiErrorBody> {
  const type = (res.headers.get("content-type") || "").toLowerCase();
  const json = type.includes("json");
  const csrfError = res.status === 403 && !type.startsWith("image/") && !type.includes("pdf") && !type.includes("octet-stream");
  if (!json && !csrfError) return Promise.resolve({});
  return res
    .clone()
    .json()
    .then((parsed) => (parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : {}))
    .catch(() => ({}));
}

/** Drop the session JWT if a response still includes it. The browser does not use it. */
function withoutSessionCredential<T>(data: T): T {
  if (!data || typeof data !== "object" || !("token" in data)) return data;
  const rest = { ...(data as Record<string, unknown>) };
  delete rest.token;
  return rest as T;
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

/**
 * Same cookie and CSRF rules as `apiFetch`, but returns the raw response.
 * Use this for blobs and callers that already branch on `res.ok`. FormData
 * uploads must come through here so they send the login-rotated secret.
 */
export async function apiFetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const split = splitRequestBody(init.body);
  try {
    return await apiFetchResponseOnce(path, init, split, false);
  } finally {
    split.cancelUnused();
  }
}

async function apiFetchResponseOnce(
  path: string,
  init: RequestInit,
  split: ReturnType<typeof splitRequestBody>,
  retried: boolean
): Promise<Response> {
  const headers = new Headers(init.headers);
  const outbound = retried ? split.retry() : split.send;
  if (outbound && !(outbound instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Prefer the token the server just issued. document.cookie is only a fallback
  // before the first response; a retry must not read it again.
  if (!retried && !headers.has("X-CSRF-Token")) {
    const token = csrfFromServer || csrfTokenFromDocument();
    if (token) headers.set("X-CSRF-Token", token);
  }

  // Sequence is taken before the await so a request that started earlier cannot
  // adopt its secret after this one has already completed.
  const seq = takeCsrfSeq();
  const res = await fetch(path, {
    ...init,
    body: outbound,
    credentials: "include",
    headers,
  });
  const peeked = await csrfBody(res);
  rememberCsrf(res, peeked, seq);
  const refreshed = res.status === 403 && peeked.code === CSRF_REFRESHED;
  const nextToken = refreshed ? csrfTokenFromRefresh(res, peeked) : "";
  if (refreshed && nextToken && !retried) {
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("X-CSRF-Token", nextToken);
    return apiFetchResponseOnce(path, { ...init, headers: retryHeaders }, split, true);
  }
  return res;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetchResponse(path, init);
  const parsed = await res.json().catch(() => ({}));
  const data = withoutSessionCredential((parsed && typeof parsed === "object" ? parsed : {}) as ApiErrorBody);
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & { code?: string };
    if (data.code) err.code = data.code;
    throw err;
  }
  return data as T;
}
