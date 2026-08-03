import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile() {
    // TODO(phase-2): protect with JwtAuthGuard; read userId from request.
    return { message: 'Profile endpoint — protected by JWT in phase 2' };
  }
}