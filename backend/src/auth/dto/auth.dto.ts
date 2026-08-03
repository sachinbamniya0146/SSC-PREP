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
  @MaxLength(72)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string;

  @IsOptional()
  @IsIn(['WEB', 'APP'], { message: 'platform must be WEB or APP' })
  platform?: 'WEB' | 'APP';
}

export class LoginDto {
  @IsEmail({}, { message: 'Valid email required' })
  email!: string;

  @IsString()
  @IsNotEmpty()
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

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @IsOptional()
  @IsIn(['WEB', 'APP'], { message: 'platform must be WEB or APP' })
  platform?: 'WEB' | 'APP';
}
