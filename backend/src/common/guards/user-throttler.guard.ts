import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { throttleLimit, throttleTracker, userLimitFromEnv } from '../throttle-key';

/**
 * S47 — per-student rate limit instead of per-IP (the rules and the reason are in common/throttle-key.ts).
 * JwtAuthGuard is registered before this guard in app.module.ts, so request.user is already set for logged-in requests.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return throttleTracker(req);
  }
}

/** Used by ThrottlerModule: `limit` can be a function of the request context. */
export function limitResolver(context: ExecutionContext): number {
  const req = context.switchToHttp().getRequest();
  return throttleLimit(req, userLimitFromEnv());
}
