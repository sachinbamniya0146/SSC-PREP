import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class SignupDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;

  @IsString()
  @MinLength(20, { message: 'Password must be exactly 20 characters' })
  @MaxLength(20, { message: 'Password must be exactly 20 characters' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Mobile number must be at least 10 digits' })
  @MaxLength(15, { message: 'Mobile number cannot exceed 15 digits' })
  phone!: string;

  @IsOptional()
  @IsIn(['WEB', 'APP'], { message: 'platform must be WEB or APP' })
  platform?: 'WEB' | 'APP';
}

export class LoginDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: 'Password must be exactly 20 characters' })
  @MaxLength(20, { message: 'Password must be exactly 20 characters' })
  password!: string;

  @IsOptional()
  @IsIn(['WEB', 'APP'], { message: 'platform must be WEB or APP' })
  platform?: 'WEB' | 'APP';

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class RequestOtpDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;
}

export class VerifyOtpDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;
}

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(32, { message: 'Reset token must be at least 32 characters' })
  @MaxLength(64, { message: 'Reset token cannot exceed 64 characters' })
  @Matches(/^[0-9a-f]+$/, { message: 'Reset token must be a hexadecimal string' })
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: 'Password must be exactly 20 characters' })
  @MaxLength(20, { message: 'Password must be exactly 20 characters' })
  newPassword!: string;
}

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @IsOptional()
  @IsIn(['WEB', 'APP'], { message: 'platform must be WEB or APP' })
  platform?: 'WEB' | 'APP';
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Current password must be at least 6 characters' })
  @MaxLength(100, { message: 'Current password cannot exceed 100 characters' })
  currentPassword!: string;

  @IsString()
  @MinLength(6, { message: 'New password must be at least 6 characters' })
  @MaxLength(100, { message: 'New password cannot exceed 100 characters' })
  newPassword!: string;
}
