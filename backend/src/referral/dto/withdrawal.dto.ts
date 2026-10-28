import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Admin records the UTR / bank reference of a payment sent by hand. */
export class MarkPaidDto {
  @IsString({ message: 'Enter the UTR / transaction reference.' })
  @MinLength(6, { message: 'Enter the UTR / transaction reference (at least 6 characters).' })
  @MaxLength(40, { message: 'The reference is too long (max 40 characters).' })
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Reject / mark failed: the admin must say why (the student sees a rejection reason). */
export class ReasonDto {
  @IsString({ message: 'Write a reason (at least 3 characters).' })
  @MinLength(3, { message: 'Write a reason (at least 3 characters).' })
  @MaxLength(300, { message: 'The reason is too long (max 300 characters).' })
  reason!: string;
}
