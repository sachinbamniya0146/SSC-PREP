import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MailService } from './mail.service';
import { OtpService } from './otp.service';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ({
          secret: config.get<string>('JWT_ACCESS_SECRET') as string,
          signOptions: {
            expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m',
          },
        }) as JwtModuleOptions,
    }),
  ],
  providers: [AuthService, MailService, OtpService, PasswordResetService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}