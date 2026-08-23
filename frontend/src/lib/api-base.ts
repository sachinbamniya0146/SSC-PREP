// API base URL resolution - single source of truth
// 1. explicit env (NEXT_PUBLIC_API_BASE_URL, baked at build) wins;
// 2. otherwise, when served from a non-localhost host (phone via LAN IP),
//    derive the API from the SAME host on :4000 — works for any LAN IP
//    without a rebuild;
// 3. localhost fallback for local dev.

export function getApiBase(): string {
  // Use the correct env variable name
  const explicit = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicit) return explicit;

  if (typeof window !== "undefined" && window.location.hostname && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:4000/api/v1`;
  }
  return "http://localhost:4000/api/v1";
}

// Export as const for build-time optimization
export const API_BASE = getApiBase();