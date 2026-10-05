import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** PUT /users/me/profile — everything a student may edit about their own registration details. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Enter a valid mobile number (10-15 digits)' })
  phone?: string;

  // "en" = English UI (default). "hinglish" = Hinglish UI copy, chosen by the student in Profile.
  @IsOptional()
  @IsIn(['en', 'hinglish'], { message: "preferredLanguage must be 'en' or 'hinglish'" })
  preferredLanguage?: 'en' | 'hinglish';
}
