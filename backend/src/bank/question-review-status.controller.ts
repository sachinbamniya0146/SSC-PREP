/* eslint-disable @typescript-eslint/no-explicit-any */
// Human review gate for a single question: AI_DRAFT / IN_REVIEW / APPROVED / REJECTED.
//
// This endpoint used to live in the PDF-ingestion module (PUT admin/pdf-ingestion/questions/:id/review-status).
// The PDF extraction system was removed on 28 Oct 2026, but the /verification screen still needs this
// one action, so it moved here unchanged (new path: PUT admin/questions/:id/review-status).
import { BadRequestException, Body, Controller, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const ALLOWED_REVIEW_STATUSES = ['AI_DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

@Controller('admin/questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS')
export class QuestionReviewStatusController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditLogService,
  ) {}

  @Put(':id/review-status')
  async setReviewStatus(
    @Param('id') id: string,
    @Body() body: { reviewStatus?: string; aiConfidenceScore?: number },
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    let reviewStatus: string;
    if (body?.reviewStatus) {
      if (!ALLOWED_REVIEW_STATUSES.includes(body.reviewStatus)) {
        throw new BadRequestException(`reviewStatus must be one of ${ALLOWED_REVIEW_STATUSES.join(', ')}`);
      }
      reviewStatus = body.reviewStatus;
    } else {
      reviewStatus = 'APPROVED'; // default action: approve
    }

    const score =
      body?.aiConfidenceScore != null && isFinite(body.aiConfidenceScore)
        ? Math.min(Math.max(body.aiConfidenceScore, 0), 1)
        : undefined;

    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new NotFoundException('Question not found');

    await this.prisma.question.update({
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
