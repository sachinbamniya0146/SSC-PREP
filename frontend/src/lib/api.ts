// API base resolution (2026-08-12 fix — phone/LAN access):
// 1. explicit env (NEXT_PUBLIC_API_BASE_URL, baked at build) wins;
// 2. otherwise, when served from a non-localhost host (phone via LAN IP),
//    derive the API from the SAME host on :4000 — works for any LAN IP
//    without a rebuild (compose had the wrong env name NEXT_PUBLIC_API_URL);
// 3. localhost fallback for local dev.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== "undefined" &&
  window.location.hostname &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:4000/api/v1`
    : "http://localhost:4000/api/v1");

// ---------------------------------------------------------------------------
// Session handling (rewritten Oct 3 2026 — "baar baar logout" fix)
//
// What was wrong: when the 15-minute access token expired, EVERY request that
// was in flight got a 401 at the same moment and each one called /auth/refresh
// with the SAME refresh token. The server rotates the token on the first call
// (the old one is revoked), so the other calls failed -> the page looked
// logged-out. Two tabs did the same thing to each other.
//
// Now:
//  * ONE refresh at a time for the whole tab (single-flight promise);
//  * if another tab already refreshed (the stored token changed) we just
//    reuse its token — no second refresh;
//  * the access token is renewed a little BEFORE it expires;
//  * we only log the user out when the server clearly says the session is
//    invalid (401/403 from /auth/refresh). A slow network or a 5xx never
//    logs anybody out.
// ---------------------------------------------------------------------------

const ACCESS_KEY = "ssc_access_token";
const REFRESH_KEY = "ssc_refresh_token";

let refreshInFlight: Promise<"ok" | "invalid" | "error"> | null = null;

function jwtExpiryMs(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearSessionAndGoToLogin() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem("ssc_user");
  } catch {
    /* ignore */
  }
  const p = window.location.pathname;
  const publicPath = p === "/" || p.startsWith("/login") || p.startsWith("/signup") || p.startsWith("/forgot") || p.startsWith("/reset");
  if (!publicPath) window.location.href = "/login?expired=1";
}

async function doRefresh(): Promise<"ok" | "invalid" | "error"> {
  const rt = localStorage.getItem(REFRESH_KEY);
  if (!rt) return "invalid";
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (res.status === 401 || res.status === 403) {
      // another tab may have rotated the token while we were waiting
      const now = localStorage.getItem(REFRESH_KEY);
      if (now && now !== rt) return "ok";
      return "invalid";
    }
    if (!res.ok) return "error";
    const d = await res.json();
    if (d.accessToken) {
      localStorage.setItem(ACCESS_KEY, d.accessToken);
      if (d.refreshToken) localStorage.setItem(REFRESH_KEY, d.refreshToken);
      return "ok";
    }
    return "error";
  } catch {
    return "error";
  }
}

/** Refreshes the session once (shared by all callers). Returns true when a usable token is stored. */
export async function refreshSession(staleToken?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // another tab / another request already replaced the token we failed with
  const current = localStorage.getItem(ACCESS_KEY) || "";
  if (staleToken && current && current !== staleToken) return true;

  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    });
  }
  const r = await refreshInFlight;
  if (r === "invalid") {
    clearSessionAndGoToLogin();
    return false;
  }
  return r === "ok";
}

/** Renews the access token when it has < 2 minutes left (call before requests / on focus). */
export async function ensureFreshToken(): Promise<void> {
  if (typeof window === "undefined") return;
  const token = localStorage.getItem(ACCESS_KEY);
  if (!token) return;
  const exp = jwtExpiryMs(token);
  if (exp && exp - Date.now() < 2 * 60 * 1000) await refreshSession(token);
}

/**
 * API helper with automatic token refresh on 401.
 * Stores tokens as ssc_access_token / ssc_refresh_token.
 */
export async function api<T>(
  path: string,
  options: RequestInit = {},
  _retried = false,
): Promise<T> {
  const isAuthPath = path.includes("/auth/");
  if (!isAuthPath && !_retried) await ensureFreshToken();

  let token = "";
  if (typeof window !== "undefined") {
    token = localStorage.getItem(ACCESS_KEY) || "";
  }

  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((extraHeaders as Record<string, string> | undefined) || {}),
    },
  });

  // Auto-refresh on 401 (except for auth endpoints themselves)
  if (res.status === 401 && !_retried && !isAuthPath) {
    const refreshed = await refreshSession(token);
    if (refreshed) {
      return api<T>(path, options, true);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { message?: string } | null)?.message || `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

/** Convenience: auth headers for raw fetch calls (e.g. bank pages). */
export function authHeaders(): { [k: string]: string } {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(ACCESS_KEY) || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** v7 §1.1 fix — raw-fetch equivalent of api() with automatic token refresh:
 *  attaches Bearer, and on 401 tries the refresh token once before giving up.
 *  Pages using raw fetch (test/question-bank/results/admin/...) must call this
 *  instead of plain fetch so an expired access token can't wedge the UI. */
export async function fetchAuth(path: string, init: RequestInit = {}, _retried = false): Promise<Response> {
  if (typeof window !== "undefined" && !_retried) await ensureFreshToken();
  const headers = new Headers(init.headers || {});
  let used = "";
  if (typeof window !== "undefined") {
    used = localStorage.getItem(ACCESS_KEY) || "";
    // a Bearer header the caller copied earlier may already be stale -> always use the newest token
    if (used && (!headers.has("Authorization") || _retried || headers.get("Authorization") !== `Bearer ${used}`)) {
      headers.set("Authorization", `Bearer ${used}`);
    }
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && !_retried && typeof window !== "undefined") {
    const refreshed = await refreshSession(used);
    if (refreshed) return fetchAuth(path, init, true);
  }
  return res;
}
