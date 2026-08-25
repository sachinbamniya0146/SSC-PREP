import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto.email, dto.password, dto.fullName, dto.phone, dto.platform, dto.referralCode);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(
      dto.email,
      dto.password,
      dto.platform || 'WEB',
      dto.deviceId,
      dto.userAgent,
    );
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword, dto.confirmPassword);
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(@Body() dto: GoogleAuthDto) {
    return this.authService.googleLogin(dto.idToken, dto.platform || 'WEB');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(
    @Body() dto: LogoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.logout(dto.refreshToken, user.sessionId);
  }

  @Put('password/change')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto.currentPassword, dto.newPassword, dto.confirmPassword);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    // v2 §16 — entitlement summary for upsell + client gating hints
    const entitlements = await this.authService.entitlements(user.userId);
    return { user, entitlements };
  }
}