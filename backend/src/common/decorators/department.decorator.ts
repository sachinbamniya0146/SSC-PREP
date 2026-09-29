import { SetMetadata } from '@nestjs/common';

export const DEPARTMENT_KEY = 'staff_departments';

/** Department permissions a MODERATOR can be granted (ADMIN always has all). */
export type StaffPermissionKey = 'QUESTIONS' | 'PRACTICE' | 'VOCABULARY' | 'SUPPORT';

export const ALL_STAFF_PERMISSIONS: StaffPermissionKey[] = [
  'QUESTIONS',
  'PRACTICE',
  'VOCABULARY',
  'SUPPORT',
];

/**
 * Restrict a staff route to moderators who hold AT LEAST ONE of the given
 * department permissions. Pair with @Roles('ADMIN', 'MODERATOR') + RolesGuard.
 * ADMIN always passes. A route with @Roles('ADMIN','MODERATOR') and NO
 * @Department stays open to every moderator (legacy behaviour).
 *
 *   @Department('VOCABULARY')              -> vocab editors only
 *   @Department('QUESTIONS', 'PRACTICE')   -> either question department
 */
export const Department = (...perms: StaffPermissionKey[]) =>
  SetMetadata(DEPARTMENT_KEY, perms);
