import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../s3/s3.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Readable } from 'stream';

@Injectable()
export class PdfIngestionService {
  private readonly logger = new Logger(PdfIngestionService.name);
  
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private audit: AuditLogService,
    @InjectQueue('pdf-extraction') private extractionQueue: Queue,
    @InjectQueue('question-review') private reviewQueue: Queue,
    @InjectQueue('explanation-generation') private explanationQueue: Queue,
    @InjectQueue('meilisearch-index') private indexQueue: Queue,
  ) {}

  async createUpload(dto: any, userId: string) {
    const sourcePdf = await this.prisma.sourcePdf.create({
      data: {
        filename: dto.filename,
        originalUrl: dto.s3Key,
        fileSize: dto.fileSize,
        uploadedByUserId: userId,
        subjectId: dto.subjectId,
        examId: dto.examId,
        bookName: dto.bookName,
        publisher: dto.publisher,
        language: dto.language || 'Hindi/English',
        year: dto.year,
        shift: dto.shift,
        paperCode: dto.paperCode,
      },
    });

    // Create ImportBatch with chunks (25 pages per chunk)
    const pageCount = await this.estimatePageCount(dto.s3Key);
    const chunkSize = 25;
    const totalChunks = Math.ceil(pageCount / chunkSize);

    const batch = await this.prisma.importBatch.create({
      data: {
        sourcePdfId: sourcePdf.id,
        status: 'QUEUED',
        totalChunks,
        chunks: {
          create: Array.from({ length: totalChunks }, (_, i) => ({
            chunkIndex: i,
            startPage: i * chunkSize + 1,
            endPage: Math.min((i + 1) * chunkSize, pageCount),
          })),
        },
      },
      include: { chunks: true },
    });

    // Enqueue all chunks for processing
    for (const chunk of batch.chunks) {
      await this.extractionQueue.add('extract-chunk', {
        batchId: batch.id,
        chunkId: chunk.id,
        sourcePdfId: sourcePdf.id,
        s3Key: dto.s3Key,
        startPage: chunk.startPage,
        endPage: chunk.endPage,
        metadata: {
          subjectId: dto.subjectId,
          examId: dto.examId,
          bookName: dto.bookName,
          publisher: dto.publisher,
          language: dto.language || 'Hindi/English',
          year: dto.year,
          shift: dto.shift,
          paperCode: dto.paperCode,
        },
      });
    }

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'PROCESSING' },
    });

    await this.audit.log({
      userId,
      action: 'PDF_UPLOAD',
      targetEntity: 'SourcePdf',
      entityId: sourcePdf.id,
      metadataJson: { batchId: batch.id, totalChunks },
    });

    return { sourcePdf, batch };
  }

  private async estimatePageCount(s3Key: string): Promise<number> {
    const obj = await this.s3.headObject(s3Key);
    const sizeKb = (obj.ContentLength || 0) / 1024;
    return Math.max(1, Math.ceil(sizeKb / 50));
  }

  async listBatches(query: any) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.sourcePdfId) where.sourcePdfId = query.sourcePdfId;

    const [batches, total] = await Promise.all([
      this.prisma.importBatch.findMany({
        where,
        include: {
          sourcePdf: { select: { filename: true, bookName: true } },
          chunks: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.importBatch.count({ where }),
    ]);

    return {
      data: batches.map(b => ({
        ...b,
        completedChunks: b.chunks.filter(c => c.status === 'SUCCESS').length,
        failedChunks: b.chunks.filter(c => c.status === 'FAILED').length,
        pendingChunks: b.chunks.filter(c => c.status === 'PENDING').length,
        progress: b.totalChunks > 0 ? Math.round((b.chunks.filter(c => c.status === 'SUCCESS').length / b.totalChunks) * 100) : 0,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getBatch(id: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id },
      include: {
        sourcePdf: true,
        chunks: { orderBy: { chunkIndex: 'asc' } },
        questions: { select: { id: true, isApproved: true, answerVerificationStatus: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async getBatchQuestions(batchId: string, page = 1, limit = 50, status?: string) {
    const where: any = { importBatchId: batchId };
    if (status === 'APPROVED') where.isApproved = true;
    if (status === 'REJECTED') where.isApproved = false;
    if (status === 'VERIFIED') where.answerVerificationStatus = 'VERIFIED_OFFICIAL';

    const [questions, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        include: {
          chapter: { select: { name: true } },
          topic: { select: { name: true } },
          exam: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.question.count({ where }),
    ]);

    return { questions, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // v5 §37.1 — publish gate: only VERIFIED_* statuses may reach PUBLISHED.
  // UNVERIFIED_SINGLE_SOURCE / DISPUTED questions cannot be approved until an
  // admin sets an eligible verification status (or supplies one in this call).
  private static readonly VERIFIED_STATUSES = new Set([
    'VERIFIED_OFFICIAL',
    'VERIFIED_MULTI_SOURCE',
    'VERIFIED_COMPUTED',
  ]);

  async approveQuestion(dto: any, adminId: string) {
    const question = await this.prisma.question.findUnique({ where: { id: dto.questionId } });
    if (!question) throw new NotFoundException('Question not found');

    const targetStatus = dto.answerVerificationStatus ?? question.answerVerificationStatus ?? 'UNVERIFIED_SINGLE_SOURCE';
    if (!PdfIngestionService.VERIFIED_STATUSES.has(targetStatus)) {
      throw new BadRequestException(
        `Cannot publish: answerVerificationStatus "${targetStatus}" is not verified. ` +
          `Set VERIFIED_OFFICIAL / VERIFIED_MULTI_SOURCE / VERIFIED_COMPUTED first.`,
      );
    }

    // Create version history
    await this.prisma.questionVersion.create({
      data: {
        questionId: dto.questionId,
        editedByUserId: adminId,
        previousText: question.questionText,
        previousOptions: question.optionsJson as any,
        previousAnswer: question.correctAnswer,
        reason: 'Admin approval/edit',
      },
    });

    // Update question with admin edits
    const updated = await this.prisma.question.update({
      where: { id: dto.questionId },
      data: {
        questionText: dto.questionText ?? question.questionText,
        questionTextHindi: dto.questionTextHindi ?? question.questionTextHindi,
        correctAnswer: dto.correctAnswer ?? question.correctAnswer,
        explanation: dto.explanation ?? question.explanation,
        explanationHindi: dto.explanationHindi ?? question.explanationHindi,
        chapterId: dto.chapterId ?? question.chapterId,
        topicId: dto.topicId ?? question.topicId,
        subTopicId: dto.subTopicId ?? question.subTopicId,
        examId: dto.examId ?? question.examId,
        year: dto.year ?? question.year,
        shift: dto.shift ?? question.shift,
        difficulty: dto.difficulty ?? question.difficulty,
        marks: dto.marks ?? question.marks,
        negativeMarks: dto.negativeMarks ?? question.negativeMarks,
        explanationSource: dto.explanationSource ?? question.explanationSource,
        translationStatus: dto.translationStatus ?? question.translationStatus,
        answerVerificationStatus: targetStatus,
        lastVerifiedAt: new Date(),
        isApproved: true,
      },
    });

    // Invalidate caches and re-index
    await this.indexQueue.add('reindex-question', { questionId: dto.questionId });

    await this.audit.log({
      userId: adminId,
      action: 'QUESTION_APPROVED',
      targetEntity: 'Question',
      entityId: dto.questionId,
      metadataJson: { changes: dto },
    });

    return updated;
  }

  async bulkApproveQuestions(questionIds: string[], adminId: string) {
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
    });

    // v5 §37.1 — publish gate: only VERIFIED_* statuses may be bulk-published.
    // UNVERIFIED/DISPUTED rows are left untouched so they stay in the review queue.
    const eligible = questions.filter((q) =>
      PdfIngestionService.VERIFIED_STATUSES.has(q.answerVerificationStatus ?? ''),
    );
    const skipped = questions.length - eligible.length;
    const eligibleIds = eligible.map((q) => q.id);
    if (eligibleIds.length === 0) {
      throw new BadRequestException(
        `None of the ${questions.length} questions are VERIFIED_*. Set verification status first.`,
      );
    }

    await this.prisma.questionVersion.createMany({
      data: eligible.map(q => ({
        questionId: q.id,
        editedByUserId: adminId,
        previousText: q.questionText,
        previousOptions: q.optionsJson as any,
        previousAnswer: q.correctAnswer,
        reason: 'Bulk admin approval',
      })),
    });

    await this.prisma.question.updateMany({
      where: { id: { in: eligibleIds } },
      data: {
        isApproved: true,
        lastVerifiedAt: new Date(),
      },
    });

    // Batch re-index
    await this.indexQueue.add('reindex-batch', { questionIds: eligibleIds });

    await this.audit.log({
      userId: adminId,
      action: 'QUESTIONS_BULK_APPROVED',
      targetEntity: 'Question',
      entityId: eligibleIds.join(','),
      metadataJson: { count: eligibleIds.length, skippedUnverified: skipped },
    });

    return { approved: eligibleIds.length, skippedUnverified: skipped };
  }

  async rejectQuestion(dto: any, adminId: string) {
    const question = await this.prisma.question.update({
      where: { id: dto.questionId },
      data: {
        isApproved: false,
      },
    });

    await this.audit.log({
      userId: adminId,
      action: 'QUESTION_REJECTED',
      targetEntity: 'Question',
      entityId: dto.questionId,
      metadataJson: { reason: dto.reason },
    });

    return question;
  }

  async retryChunk(chunkId: string, adminId: string) {
    const chunk = await this.prisma.importChunk.findUnique({
      where: { id: chunkId },
      include: { batch: { include: { sourcePdf: true } } },
    });
    if (!chunk) throw new NotFoundException('Chunk not found');

    await this.prisma.importChunk.update({
      where: { id: chunkId },
      data: { status: 'PENDING', errorMessage: null },
    });

    await this.extractionQueue.add('extract-chunk', {
      batchId: chunk.importBatchId,
      chunkId: chunk.id,
      sourcePdfId: chunk.batch.sourcePdfId,
      s3Key: chunk.batch.sourcePdf.originalUrl,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      metadata: {
        subjectId: chunk.batch.sourcePdf.subjectId,
        examId: chunk.batch.sourcePdf.examId,
        bookName: chunk.batch.sourcePdf.bookName,
        publisher: chunk.batch.sourcePdf.publisher,
        language: chunk.batch.sourcePdf.language,
        year: chunk.batch.sourcePdf.year,
        shift: chunk.batch.sourcePdf.shift,
        paperCode: chunk.batch.sourcePdf.paperCode,
      },
    });

    await this.audit.log({
      userId: adminId,
      action: 'CHUNK_RETRY',
      targetEntity: 'ImportChunk',
      entityId: chunkId,
    });

    return { queued: true };
  }

  async rollbackBatch(batchId: string, adminId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { questions: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    // Soft-delete questions from this batch
    await this.prisma.question.updateMany({
      where: { importBatchId: batchId },
      data: { isActive: false },
    });

    await this.audit.log({
      userId: adminId,
      action: 'BATCH_ROLLBACK',
      targetEntity: 'ImportBatch',
      entityId: batchId,
      metadataJson: { questionsDeactivated: batch.questions.length },
    });

    return { rolledBack: batch.questions.length };
  }

  async getPipelineStats() {
    const [batches, chunks, questions, sources] = await Promise.all([
      this.prisma.importBatch.groupBy({ by: ['status'], _count: true }),
      this.prisma.importChunk.groupBy({ by: ['status'], _count: true }),
      this.prisma.question.groupBy({ by: ['answerVerificationStatus'], _count: true }),
      this.prisma.sourcePdf.count(),
    ]);

    return {
      batches: batches.reduce((acc, b) => ({ ...acc, [b.status]: b._count }), {}),
      chunks: chunks.reduce((acc, c) => ({ ...acc, [c.status]: c._count }), {}),
      questions: questions.reduce((acc, q) => ({ ...acc, [q.answerVerificationStatus]: q._count }), {}),
      totalSources: sources,
    };
  }
}