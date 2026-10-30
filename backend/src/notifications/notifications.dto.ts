import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class MarkReadDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

export class PrefsDto {
  @IsOptional() @IsBoolean() weakTopic?: boolean;
  @IsOptional() @IsBoolean() streak?: boolean;
  @IsOptional() @IsBoolean() tests?: boolean;
  @IsOptional() @IsBoolean() news?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  remindHourIst?: number;

  /** Pause every reminder for this many days (0 = switch pausing off). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  pauseDays?: number;
}

export class AudienceDto {
  @IsIn(['ALL', 'TARGET_EXAM', 'INACTIVE', 'HAS_WEAK'])
  type!: 'ALL' | 'TARGET_EXAM' | 'INACTIVE' | 'HAS_WEAK';

  @IsOptional() @IsString() @MaxLength(60) examId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class AdminSendDto {
  @IsString() @IsNotEmpty() @MaxLength(65) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(180) body!: string;
  @IsOptional() @IsString() @MaxLength(200) url?: string;
  @IsObject()
  @ValidateNested()
  @Type(() => AudienceDto)
  audience!: AudienceDto;
}
