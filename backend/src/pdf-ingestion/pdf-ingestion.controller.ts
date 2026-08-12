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
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
  @ApiOperation({ summary: 'Upload PDF for ingestion (creates SourcePdf + ImportBatch + chunks)' })
  async uploadPdf(@Body() dto: UploadPdfDto, @Req() req: any) {
    return this.service.createUpload(dto, req.user.id);
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