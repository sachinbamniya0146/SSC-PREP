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
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shape of the JWT payload issued by AuthService.issueTokens(). Kept in
 * sync with the `base` object built in backend/src/auth/auth.service.ts.
 */
interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  sid: string;
  platform?: string;
  type: string;
  iat?: number;
  exp?: number;
}

/**
 * JwtAuthGuard — verifies the access token (type: "access") and attaches
 * the user to the request. Skips routes marked @Public().
 *
 * FIX for Error #4 (CRITICAL - single active session bypass):
 * Previously this guard only verified the JWT's signature/type and never
 * checked whether the DeviceSession referenced by the token's `sid` claim
 * was still active. That meant when a user logged in on a new device, the
 * OLD device's still-valid access token kept working until it naturally
 * expired (up to 15 min, or longer if it could keep refreshing) even
 * though DeviceSession.isActive had been flipped to false in the DB.
 *
 * Now, after verifying the JWT itself, we also look up the DeviceSession
 * by payload.sid and reject the request if it's missing or inactive.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice(7).trim();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      if (payload.type !== 'access' || !payload.sub) {
        throw new UnauthorizedException('Invalid token type');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // FIX Error #4: enforce single active session by checking DeviceSession.
    if (!payload.sid) {
      throw new UnauthorizedException('Invalid session token');
    }
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || !session.isActive) {
      throw new UnauthorizedException(
        'Session has been logged out from another device',
      );
    }

    request.user = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sid,
      platform: payload.platform,
    } as AuthenticatedUser;
    return true;
  }
}
