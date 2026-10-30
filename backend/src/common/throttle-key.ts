/**
 * 30 Oct 2026 (S47) — rate limit per LOGGED-IN STUDENT, not per IP.
 *
 * Why: the global limit was 60 requests / minute / IP. Many students share one IP (mobile-carrier NAT, hostel / coaching wifi),
 * and a single 100-question practice submit used to fire 100 requests at once. The surplus got HTTP 429, and the old page
 * counted a failed scoring call as a WRONG answer — "sahi answer bhi wrong dikha raha hai".
 *
 * JwtAuthGuard is registered before ThrottlerGuard (app.module.ts), so request.user is already set for every logged-in request.
 * Anonymous requests (login, signup, public pages) keep the strict per-IP limit, and the stricter @Throttle on auth routes still applies.
 */
export const ANON_LIMIT_PER_MIN = 60;
export const USER_LIMIT_PER_MIN = 300;

export function userIdOf(req: any): string | null {
  const id = req?.user?.userId ?? req?.user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** The key a request is counted under: the student id when logged in, else the IP. */
export function throttleTracker(req: any): string {
  const uid = userIdOf(req);
  if (uid) return `u:${uid}`;
  return String(req?.ip ?? req?.ips?.[0] ?? req?.socket?.remoteAddress ?? 'unknown');
}

/** The per-minute budget of a request: a logged-in student gets more room than an anonymous caller. */
export function throttleLimit(req: any, userLimit = USER_LIMIT_PER_MIN, anonLimit = ANON_LIMIT_PER_MIN): number {
  return userIdOf(req) ? userLimit : anonLimit;
}

export function userLimitFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.THROTTLE_USER_LIMIT);
  return Number.isFinite(n) && n >= ANON_LIMIT_PER_MIN && n <= 5000 ? Math.floor(n) : USER_LIMIT_PER_MIN;
}
