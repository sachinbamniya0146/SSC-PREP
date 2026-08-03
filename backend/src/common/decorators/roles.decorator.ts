import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
/** Restrict a route to specific roles. Pair with RolesGuard. */
export const Roles = (...roles: Array<'STUDENT' | 'ADMIN' | 'MODERATOR'>) =>
  SetMetadata(ROLES_KEY, roles);
