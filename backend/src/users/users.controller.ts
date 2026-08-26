import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UserService) {}

  @Get('me')
  async getMe() {
    return this.usersService.findById('dummy');
  }

  @Get('me/stats')
  async getMeStats(@Query('limit') _limit?: string) {
    return this.usersService.getStats('dummy');
  }

  @Get('me/activity')
  async getMeActivity(@Query('limit') limit?: string) {
    return this.usersService.getRecentActivity('dummy', limit ? parseInt(limit, 10) : 10);
  }

  @Post('me/preferences')
  async updatePreferences(@Body() body: { darkMode?: boolean; preferredLanguage?: string }) {
    return this.usersService.updatePreferences('dummy', body);
  }

  @Post('me/openrouter-key')
  async updateOpenrouterApiKey(@Body() body: { apiKey: string }) {
    return this.usersService.updateOpenrouterApiKey('dummy', body.apiKey);
  }
}
