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

/**
 * API helper with automatic token refresh on 401.
 * Stores tokens as ssc_access_token / ssc_refresh_token.
 */
export async function api<T>(
  path: string,
  options: RequestInit = {},
  _retried = false,
): Promise<T> {
  let token = "";
  if (typeof window !== "undefined") {
    token = localStorage.getItem("ssc_access_token") || "";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  // Auto-refresh on 401 (except for auth endpoints themselves)
  if (res.status === 401 && !_retried && !path.includes("/auth/")) {
    const refreshed = await tryRefresh();
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

async function tryRefresh(): Promise<boolean> {
  try {
    const rt = localStorage.getItem("ssc_refresh_token");
    if (!rt) return false;
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const d = await res.json();
    if (d.accessToken) {
      localStorage.setItem("ssc_access_token", d.accessToken);
      if (d.refreshToken) localStorage.setItem("ssc_refresh_token", d.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Convenience: auth headers for raw fetch calls (e.g. bank pages). */
export function authHeaders(): { [k: string]: string } {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("ssc_access_token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** v7 §1.1 fix — raw-fetch equivalent of api() with automatic token refresh:
 *  attaches Bearer, and on 401 tries the refresh token once before giving up.
 *  Pages using raw fetch (test/question-bank/results/admin/...) must call this
 *  instead of plain fetch so an expired access token can't wedge the UI. */
export async function fetchAuth(path: string, init: RequestInit = {}, _retried = false): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("ssc_access_token") || "";
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && !_retried && typeof window !== "undefined") {
    const refreshed = await tryRefresh();
    if (refreshed) return fetchAuth(path, init, true);
  }
  return res;
}

