import { Controller, Get, Param, Put, Body } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.userId);
  }

  @Put('me/phone')
  updatePhone(@CurrentUser() user: AuthenticatedUser, @Body() body: { phone: string }) {
    return this.usersService.updatePhone(user.userId, body.phone);
  }

  /**
   * Get comprehensive user dashboard with daily activity tracking
   */
  @Get('me/dashboard')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getDashboard(user.userId);
  }

  /**
   * Get weekly progress report
   */
  @Get('me/dashboard/weekly')
  getWeeklyProgress(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getWeeklyProgress(user.userId);
  }

  /**
   * Get monthly activity summary
   */
  @Get('me/dashboard/monthly')
  getMonthlySummary(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMonthlySummary(user.userId);
  }

  /**
   * Admin-only: device/session history for a user (v1 §10 device monitoring).
   * Protected by JwtAuthGuard + RolesGuard via @Roles('ADMIN', 'MODERATOR').
   */
  @Roles('ADMIN', 'MODERATOR')
  @Get(':userId/sessions')
  listUserSessions(@Param('userId') userId: string) {
    return this.usersService.listActiveSessions(userId);
  }
}