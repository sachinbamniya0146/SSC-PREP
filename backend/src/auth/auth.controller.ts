import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(
    @Body() body: { email: string; password: string; fullName: string },
  ) {
    return this.authService.signup(body.email, body.password, body.fullName);
  }

  @Post('login')
  login(
    @Body() body: { email: string; password: string; platform?: 'WEB' | 'APP' },
  ) {
    return this.authService.login(
      body.email,
      body.password,
      body.platform || 'WEB',
    );
  }
}