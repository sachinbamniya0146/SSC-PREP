import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Same constraints as SignupDto.phone (auth/dto/auth.dto.ts) for consistency
 * — mirrors what's enforced at signup so a profile-page phone update can't
 * silently save something signup would have rejected.
 */
export class UpdatePhoneDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Mobile number must be at least 10 digits' })
  @MaxLength(15, { message: 'Mobile number cannot exceed 15 digits' })
  phone!: string;
}
