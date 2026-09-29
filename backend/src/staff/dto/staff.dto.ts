import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Every field is decorated: the global ValidationPipe uses
// whitelist + forbidNonWhitelisted, so an undecorated property 400s the request.

export const STAFF_PERMISSION_VALUES = ['QUESTIONS', 'PRACTICE', 'VOCABULARY', 'SUPPORT'] as const;
export type StaffPermissionValue = (typeof STAFF_PERMISSION_VALUES)[number];

export class GrantStaffDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STAFF_PERMISSION_VALUES.length)
  @ArrayUnique()
  @IsIn(STAFF_PERMISSION_VALUES as unknown as string[], { each: true })
  permissions!: StaffPermissionValue[];
}

export class UpdateStaffDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STAFF_PERMISSION_VALUES.length)
  @ArrayUnique()
  @IsIn(STAFF_PERMISSION_VALUES as unknown as string[], { each: true })
  permissions!: StaffPermissionValue[];

  // optional free-text note for the audit trail
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
