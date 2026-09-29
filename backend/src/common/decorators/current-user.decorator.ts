import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: 'STUDENT' | 'ADMIN' | 'MODERATOR';
  sessionId: string;
  platform: 'WEB' | 'APP';
  /** Filled live by RolesGuard on @Roles routes (department access for MODERATOR). */
  permissions?: string[];
}

/** Extract the authenticated user (attached by JwtAuthGuard) from the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthenticatedUser;
  },
);
