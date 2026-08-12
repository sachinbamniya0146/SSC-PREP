import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PdfIngestionService } from './pdf-ingestion.service';
import { ExplanationGenerationService } from './explanation-generation.service';
import {
  UploadPdfDto,
  AdminApproveQuestionDto,
  BulkApproveQuestionsDto,
  RejectQuestionDto,
  ImportBatchQueryDto,
  ChunkRetryDto,
} from './dto/pdf-ingestion.dto';

@ApiTags('pdf-ingestion')
@ApiBearerAuth()
@Controller('admin/pdf-ingestion')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
export class PdfIngestionController {
  constructor(
    private readonly service: PdfIngestionService,
    private readonly explanationService: ExplanationGenerationService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditLogService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Register a PDF already stored in S3 (presigned upload path)' })
  async upload(@Body() dto: UploadPdfDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.createUpload(dto, userId);
  }

  // v1 §7.1 — direct multipart upload (works with local-disk fallback when S3
  // is not configured — zero-cost pipeline). Stores bytes, then runs the same
  // batch/chunk/review flow as the S3 path.
  @Post('upload-file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload PDF file directly (multipart) — stores to S3/R2 or local disk' })
  async uploadFile(@UploadedFile() file: any, @Body() dto: any, @Req() req: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (PDF) is required');
    if (!dto.subjectId) throw new BadRequestException('subjectId is required (which subject do these questions belong to?)');
    const key = `uploads/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await this.service.storePdf(key, file.buffer);
    const userId = req.user?.userId ?? req.user?.id;
    // multipart fields arrive as strings — coerce numeric/metadata types
    const meta = {
      ...dto,
      year: dto.year ? Number(dto.year) || undefined : undefined,
      fileSize: Number(dto.fileSize) || file.size,
    };
    return this.service.createUpload(
      {
        ...meta,
        filename: file.originalname,
        s3Key: key,
      },
      userId,
    );
  }

  @Get('batches')
  @ApiOperation({ summary: 'List import batches with progress' })
  async listBatches(@Query() query: ImportBatchQueryDto) {
    return this.service.listBatches(query);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get batch details with chunk progress' })
  async getBatch(@Param('id') id: string) {
    return this.service.getBatch(id);
  }

  @Get('batches/:id/questions')
  @ApiOperation({ summary: 'Get extracted questions from a batch (for review queue)' })
  async getBatchQuestions(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('status') status?: 'AI_DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED',
  ) {
    return this.service.getBatchQuestions(id, page, limit, status);
  }

  @Post('questions/approve')
  @ApiOperation({ summary: 'Approve single question (with optional edits) - instant publish' })
  async approveQuestion(@Body() dto: AdminApproveQuestionDto, @Req() req: any) {
    return this.service.approveQuestion(dto, req.user.id);
  }

  @Post('questions/bulk-approve')
  @ApiOperation({ summary: 'Bulk approve high-confidence questions' })
  async bulkApprove(@Body() dto: BulkApproveQuestionsDto, @Req() req: any) {
    return this.service.bulkApproveQuestions(dto.questionIds, req.user.id);
  }

  @Post('questions/reject')
  @ApiOperation({ summary: 'Reject a question with reason' })
  async rejectQuestion(@Body() dto: RejectQuestionDto, @Req() req: any) {
    return this.service.rejectQuestion(dto, req.user.id);
  }

  @Post('chunks/:id/retry')
  @ApiOperation({ summary: 'Retry a failed chunk' })
  async retryChunk(@Param('id') id: string, @Body() dto: ChunkRetryDto, @Req() req: any) {
    return this.service.retryChunk(id, req.user.id);
  }

  @Post('batches/:id/rollback')
  @ApiOperation({ summary: 'Rollback a completed batch (soft-delete its questions)' })
  async rollbackBatch(@Param('id') id: string, @Req() req: any) {
    return this.service.rollbackBatch(id, req.user.id);
  }

  @Get('translation-queue')
  translationQueue(@Query('examId') examId?: string, @Query('subjectId') subjectId?: string, @Query('chapterId') chapterId?: string, @Query('take') take?: string) {
    return this.service.translationQueue({ examId, subjectId, chapterId, take: take ? Number(take) : undefined });
  }

  @Get('translation-stats')
  translationStats() {
    return this.service.translationStats();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get ingestion pipeline stats' })
  async getStats() {
    return this.service.getPipelineStats();
  }

  @Post('questions/:id/explain')
  @ApiOperation({ summary: 'Generate AI explanation for a question (English + Hindi)' })
  async explainQuestion(@Param('id') id: string) {
    await this.explanationService.generateExplanationForQuestion(id);
    return { success: true, message: 'AI explanation generated and saved' };
  }

  // v1 §7.4 — human review-gate control: move a question through
  // AI_DRAFT → APPROVED / REJECTED and optionally record extraction confidence.
  @Put('questions/:id/review-status')
  @ApiOperation({ summary: 'Set reviewStatus (+aiConfidenceScore) — human review gate' })
  async setReviewStatus(
    @Param('id') id: string,
    @Body() body: { reviewStatus?: string; aiConfidenceScore?: number },
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const allowed = ['AI_DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'];
    let reviewStatus: string;
    if (body.reviewStatus) {
      if (!allowed.includes(body.reviewStatus)) throw new BadRequestException(`reviewStatus must be one of ${allowed.join(', ')}`);
      reviewStatus = body.reviewStatus;
    } else {
      reviewStatus = 'APPROVED'; // default action: approve
    }

    const score =
      body.aiConfidenceScore != null && isFinite(body.aiConfidenceScore)
        ? Math.min(Math.max(body.aiConfidenceScore, 0), 1)
        : undefined;

    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new NotFoundException('Question not found');

    const updated = await this.prisma.question.update({
      where: { id },
      data: {
        reviewStatus,
        isApproved: reviewStatus === 'APPROVED' ? true : question.isApproved && reviewStatus !== 'REJECTED',
        ...(score !== undefined ? { aiConfidenceScore: score } : {}),
      },
    });

    await this.auditService.log({
      userId: admin.userId,
      action: 'QUESTION_REVIEW_STATUS',
      targetEntity: 'Question',
      entityId: id,
      metadataJson: { reviewStatus, aiConfidenceScore: score ?? question.aiConfidenceScore },
    });

    return { success: true, id, reviewStatus, aiConfidenceScore: score ?? question.aiConfidenceScore };
  }
}