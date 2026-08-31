import { Controller, Get, Post, Delete, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UserService) {}

  // BUGFIX: every method below used the literal string 'dummy' instead of
  // the authenticated caller's id (available via @CurrentUser(), attached
  // by JwtAuthGuard). That meant GET /me, /me/stats, /me/activity,
  // POST /me/preferences and POST /me/openrouter-key ALL silently read from
  // or wrote to a user row that doesn't exist, for every real user, every
  // time — the personal-OpenRouter-key save in particular looked like it
  // succeeded (200 OK) but never touched the caller's actual account, so
  // their key was never actually stored or used anywhere.
  @Get('me')
  async getMe(@CurrentUser() user: { userId: string }) {
    return this.usersService.findById(user.userId);
  }

  @Get('me/stats')
  async getMeStats(@CurrentUser() user: { userId: string }, @Query('limit') _limit?: string) {
    return this.usersService.getStats(user.userId);
  }

  @Get('me/activity')
  async getMeActivity(@CurrentUser() user: { userId: string }, @Query('limit') limit?: string) {
    return this.usersService.getRecentActivity(user.userId, limit ? parseInt(limit, 10) : 10);
  }

  @Post('me/preferences')
  async updatePreferences(
    @CurrentUser() user: { userId: string },
    @Body() body: { darkMode?: boolean; preferredLanguage?: string },
  ) {
    return this.usersService.updatePreferences(user.userId, body);
  }

  /** Save/replace the user's personal OpenRouter API key (used for free-model AI explanations). */
  @Post('me/openrouter-key')
  async updateOpenrouterApiKey(@CurrentUser() user: { userId: string }, @Body() body: { apiKey: string }) {
    return this.usersService.updateOpenrouterApiKey(user.userId, body.apiKey);
  }

  /** Whether a personal key is saved — masked, never the raw key. */
  @Get('me/openrouter-key')
  async getOpenrouterApiKeyStatus(@CurrentUser() user: { userId: string }) {
    return this.usersService.getOpenrouterApiKeyStatus(user.userId);
  }

  @Delete('me/openrouter-key')
  async deleteOpenrouterApiKey(@CurrentUser() user: { userId: string }) {
    return this.usersService.updateOpenrouterApiKey(user.userId, null);
  }
}
