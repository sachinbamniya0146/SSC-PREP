import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  DEPARTMENT_KEY,
  StaffPermissionKey,
} from '../decorators/department.decorator';
import { PrismaService } from '../../prisma/prisma.service';

type LiveAccess = { role: string; permissions: string[] };

// Short-lived cache so a busy admin screen doesn't add a DB hit per request,
// while a role/permission change still takes effect within seconds (and
// instantly on this instance via invalidateStaffAccess()).
const CACHE_TTL_MS = 10_000;
const accessCache = new Map<string, { at: number; value: LiveAccess | null }>();

/** Call after changing a user's role/permissions so it applies immediately. */
export function invalidateStaffAccess(userId?: string) {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
}

/**
 * RolesGuard — enforces @Roles(...) and @Department(...) metadata. Must run
 * AFTER JwtAuthGuard so request.user is populated.
 *
 * SECURITY FIX: role/permissions are now read LIVE from the database (with a
 * 10s cache) instead of trusting the role baked into the JWT. Before, a user
 * demoted/revoked by an admin kept full access until their access token
 * expired, and a newly promoted staff member was rejected until re-login.
 *
 * Rules:
 *  - ADMIN always passes.
 *  - MODERATOR passes a @Roles(..., 'MODERATOR') route only if the route has
 *    no @Department, or the moderator holds one of the listed permissions.
 *  - The live role + permissions are copied onto request.user so handlers
 *    can make finer decisions (e.g. PYQ vs Practice upload).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private async loadAccess(userId: string): Promise<LiveAccess | null> {
    const hit = accessCache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, permissions: true },
    });
    const value: LiveAccess | null = u
      ? { role: u.role as string, permissions: (u.permissions ?? []) as string[] }
      : null;
    accessCache.set(userId, { at: Date.now(), value });
    return value;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<
      Array<'STUDENT' | 'ADMIN' | 'MODERATOR'>
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | { userId?: string; role?: string; permissions?: string[] }
      | undefined;
    if (!user?.userId) {
      throw new ForbiddenException('Access denied');
    }

    const live = await this.loadAccess(user.userId);
    if (!live) throw new ForbiddenException('Access denied');
    user.role = live.role;
    user.permissions = live.permissions;

    if (live.role === 'ADMIN') return true;

    if (live.role === 'MODERATOR' && requiredRoles.includes('MODERATOR')) {
      const departments = this.reflector.getAllAndOverride<StaffPermissionKey[]>(
        DEPARTMENT_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!departments || departments.length === 0) return true;
      if (departments.some((d) => live.permissions.includes(d))) return true;
      throw new ForbiddenException(
        'Aapke account ko is department ka access nahi diya gaya hai. Admin se contact karein.',
      );
    }

    if (requiredRoles.includes(live.role as never)) return true;
    throw new ForbiddenException('Insufficient role for this action');
  }
}
