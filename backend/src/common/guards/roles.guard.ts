import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard — enforces @Roles(...) metadata. Must run AFTER JwtAuthGuard
 * so request.user is populated. Admin and MODERATOR always pass (admin
 * implies moderator-level access).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      Array<'STUDENT' | 'ADMIN' | 'MODERATOR'>
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;
    if (!user?.role) {
      throw new ForbiddenException('Access denied');
    }
    if (user.role === 'ADMIN') return true;
    if (requiredRoles.includes(user.role as never)) return true;
    throw new ForbiddenException('Insufficient role for this action');
  }
}
