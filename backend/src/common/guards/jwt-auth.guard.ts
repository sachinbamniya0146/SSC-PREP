import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Public (no-auth) URL prefixes consumed by cron jobs and leaderboard views. */
const PUBLIC_PATHS: readonly string[] = [
  '/api/v1/tests/toppers',
  '/tests/toppers',
  '/api/v1/bank/meta',
  '/api/v1/bank/exam-pattern',
  '/bank/exam-pattern',
  '/api/v1/tests/attempts/remaining',
];

/**
 * JwtAuthGuard — verifies the access token (type: "access") and attaches
 * the user to the request. Skips routes marked @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Debug log (uncomment to inspect public-metadata resolution)
    // console.log('[JwtAuthGuard] handler:', context.getHandler()?.name, 'class:', context.getClass()?.name, 'isPublic:', isPublic);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const url: string = request.url ?? request.originalUrl ?? '';

    // v7 §1 — explicit public path whitelist (authoritative; used by cron/jobs
    // and leaderboard views that must work without a bearer token even if the
    // @Public() decorator metadata is not reflected at runtime).
    if (PUBLIC_PATHS.some((p: string) => url.startsWith(p))) return true;
    // Fallback: match suffix in case global prefix is stripped or path differs
    if (PUBLIC_PATHS.some((p: string) => url.endsWith(p))) return true;

    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice(7).trim();

    try {
      const payload = await this.jwtService.verifyAsync(token);
      if (payload.type !== 'access' || !payload.sub) {
        throw new UnauthorizedException('Invalid token type');
      }
      request.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        sessionId: payload.sid,
        platform: payload.platform,
      } as AuthenticatedUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
