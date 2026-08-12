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
    console.log('[JwtAuthGuard] handler:', context.getHandler()?.name, 'class:', context.getClass()?.name, 'isPublic:', isPublic);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
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
