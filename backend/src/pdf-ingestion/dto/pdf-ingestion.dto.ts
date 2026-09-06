import { IsOptional, IsString, IsNumber, IsEnum, IsUUID, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum UploadSourceType {
  MANUAL = 'MANUAL',
  AUTO_FETCH = 'AUTO_FETCH',
}

export class UploadPdfDto {
  @IsString()
  filename: string;

  @IsString()
  s3Key: string;

  @IsNumber()
  fileSize: number;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  examId?: string;

  @IsOptional()
  @IsString()
  bookName?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  language?: string = 'Hindi/English';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2000)
  @Max(2030)
  year?: number;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsString()
  paperCode?: string;

  @IsOptional()
  @IsEnum(UploadSourceType)
  sourceType?: UploadSourceType = UploadSourceType.MANUAL;

  // NEW — a single PDF file (e.g. a full SSC CGL paper with English,
  // Reasoning, Quant, GA all in one file) previously had to be uploaded
  // whole, tagging EVERY extracted question with one subjectId — wrong for
  // 3 of the 4 sections. Optional page-range lets an admin upload the SAME
  // file 4 times, once per section, each with its own subjectId + the page
  // range that section actually occupies. Omit both to process the whole
  // PDF as before (fully backward-compatible).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  startPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  endPage?: number;
}

export class AdminApproveQuestionDto {
  @IsUUID()
  questionId: string;

  @IsOptional()
  @IsString()
  questionText?: string;

  @IsOptional()
  @IsString()
  questionTextHindi?: string;

  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  explanationHindi?: string;

  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsString()
  subTopicId?: string;

  @IsOptional()
  @IsString()
  examId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsString()
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  negativeMarks?: number;

  @IsOptional()
  @IsEnum(['PDF', 'AI_GENERATED', 'HUMAN_VERIFIED'])
  explanationSource?: 'PDF' | 'AI_GENERATED' | 'HUMAN_VERIFIED';

  @IsOptional()
  @IsEnum(['HUMAN_VERIFIED', 'AUTO_UNVERIFIED'])
  translationStatus?: 'HUMAN_VERIFIED' | 'AUTO_UNVERIFIED';

  @IsOptional()
  @IsEnum(['VERIFIED_OFFICIAL', 'VERIFIED_MULTI_SOURCE', 'VERIFIED_COMPUTED', 'UNVERIFIED_SINGLE_SOURCE', 'DISPUTED'])
  answerVerificationStatus?: 'VERIFIED_OFFICIAL' | 'VERIFIED_MULTI_SOURCE' | 'VERIFIED_COMPUTED' | 'UNVERIFIED_SINGLE_SOURCE' | 'DISPUTED';
}

export class BulkApproveQuestionsDto {
  @IsUUID(undefined, { each: true })
  questionIds: string[];
}

export class RejectQuestionDto {
  @IsUUID()
  questionId: string;

  @IsString()
  reason: string;
}

export class ImportBatchQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;

  @IsOptional()
  @IsEnum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL'])
  status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

  @IsOptional()
  @IsUUID()
  sourcePdfId?: string;
}

export class ChunkRetryDto {
  @IsUUID()
  chunkId: string;
}
