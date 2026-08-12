const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000/api/v1";

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