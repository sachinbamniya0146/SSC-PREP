import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password cannot exceed 128 characters' })
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
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password cannot exceed 128 characters' })
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
  @MinLength(6)
  @MaxLength(6)
  otp!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password cannot exceed 128 characters' })
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
  @MinLength(8, { message: 'Current password must be at least 8 characters' })
  @MaxLength(128, { message: 'Current password cannot exceed 128 characters' })
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @MaxLength(128, { message: 'New password cannot exceed 128 characters' })
  newPassword!: string;
}
