import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
// Use synchronous require for ESM package - avoids __importStar wrapper issue
const MeiliSearchClass = require('meilisearch').Meilisearch;

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: any;
  private indexName = 'questions';

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private initClient() {
    if (this.client) return;
    const host = this.configService.get('MEILISEARCH_HOST') || 'http://localhost:7700';
    const apiKey = this.configService.get('MEILISEARCH_API_KEY') || '';
    this.client = new MeiliSearchClass({ host, apiKey: apiKey || undefined });
  }

  async onModuleInit() {
    this.initClient();
    await this.ensureIndex();
  }

  private async ensureIndex() {
    try {
      await this.initClient();
      const indexes = await this.client.getIndexes();
      const exists = indexes.results.some((i: any) => i.uid === this.indexName);
      if (!exists) {
        await this.client.createIndex(this.indexName, { primaryKey: 'id' });
        this.logger.log(`Created Meilisearch index: ${this.indexName}`);
      }
      await this.client.index(this.indexName).updateSettings({
        searchableAttributes: [
          'questionText',
          'questionTextHindi',
          'explanation',
          'explanationHindi',
          'subject.name',
          'chapter.name',
          'topic.name',
          'exam.name',
          'year',
        ],
        filterableAttributes: [
          'subjectId',
          'chapterId',
          'topicId',
          'subTopicId',
          'examId',
          'year',
          'difficulty',
          'isApproved',
          'isActive',
          'explanationSource',
        ],
        sortableAttributes: ['year', 'createdAt', 'updatedAt'],
        rankingRules: [
          'words',
          'typo',
          'proximity',
          'attribute',
          'sort',
          'exactness',
        ],
        distinctAttribute: 'id',
      });
      this.logger.log('Meilisearch index settings updated');
    } catch (e) {
      this.logger.error('Failed to ensure Meilisearch index', e);
    }
  }

  private transformQuestion(q: any) {
    return {
      id: q.id,
      subjectId: q.subjectId,
      subject: q.subject?.name || '',
      chapterId: q.chapterId,
      chapter: q.chapter?.name || '',
      topicId: q.topicId,
      topic: q.topic?.name || '',
      subTopicId: q.subTopicId,
      subTopic: q.subTopic?.name || '',
      examId: q.examId,
      exam: q.exam?.name || '',
      year: q.year,
      shift: q.shift,
      paperCode: q.paperCode,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi || '',
      optionsJson: q.optionsJson,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || '',
      explanationHindi: q.explanationHindi || '',
      explanationSource: q.explanationSource,
      translationStatus: q.translationStatus,
      answerVerificationStatus: q.answerVerificationStatus,
      lastVerifiedAt: q.lastVerifiedAt?.toISOString() || null,
      isApproved: q.isApproved,
      difficulty: q.difficulty,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      searchHash: q.searchHash,
      isActive: q.isActive,
      videoUrl: q.videoUrl || '',
      videoSource: q.videoSource || '',
      videoTitle: q.videoTitle || '',
      videoDescription: q.videoDescription || '',
      videoDurationSeconds: q.videoDurationSeconds,
      videoLanguage: q.videoLanguage || '',
      videoUploadedAt: q.videoUploadedAt?.toISOString() || null,
      videoUploadedBy: q.videoUploadedBy || '',
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    };
  }

  async indexQuestion(questionId: string) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { subject: true, chapter: true, topic: true, subTopic: true, exam: true },
    });
    if (!q) return { success: false, error: 'Question not found' };
    try {
      this.initClient();
      await this.client.index(this.indexName).addDocuments([this.transformQuestion(q)]);
      return { success: true };
    } catch (e: any) {
      this.logger.error(`Failed to index question ${questionId}`, e);
      return { success: false, error: e.message };
    }
  }

  async indexAllApproved(batchSize = 500) {
    this.initClient();
    let total = 0;
    let skip = 0;
    while (true) {
      const questions = await this.prisma.question.findMany({
        where: { isApproved: true, isActive: true },
        include: { subject: true, chapter: true, topic: true, subTopic: true, exam: true },
        take: batchSize,
        skip,
        orderBy: { createdAt: 'asc' },
      });
      if (questions.length === 0) break;
      const docs = questions.map(this.transformQuestion.bind(this));
      await this.client.index(this.indexName).addDocuments(docs);
      total += questions.length;
      skip += batchSize;
      this.logger.log(`Indexed batch: ${total} questions`);
    }
    return { success: true, totalIndexed: total };
  }

  async search(params: {
    q?: string;
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
    examId?: string;
    year?: number;
    difficulty?: string;
    explanationSource?: string;
    limit?: number;
    offset?: number;
    sort?: string[];
  }) {
    const filter = [];
    if (params.subjectId) filter.push(`subjectId = ${params.subjectId}`);
    if (params.chapterId) filter.push(`chapterId = ${params.chapterId}`);
    if (params.topicId) filter.push(`topicId = ${params.topicId}`);
    if (params.examId) filter.push(`examId = ${params.examId}`);
    if (params.year) filter.push(`year = ${params.year}`);
    if (params.difficulty) filter.push(`difficulty = ${params.difficulty}`);
    if (params.explanationSource) filter.push(`explanationSource = ${params.explanationSource}`);
    filter.push('isApproved = true');
    filter.push('isActive = true');

    try {
      this.initClient();
      const result = await this.client.index(this.indexName).search(params.q || '', {
        filter: filter.join(' AND '),
        limit: Math.min(params.limit ?? 20, 100),
        offset: params.offset ?? 0,
        sort: params.sort,
        attributesToHighlight: ['questionText', 'questionTextHindi', 'explanation', 'explanationHindi'],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
      });
      return {
        hits: result.hits,
        estimatedTotalHits: result.estimatedTotalHits,
        query: result.query,
        processingTimeMs: result.processingTimeMs,
      };
    } catch (e: any) {
      this.logger.error('Search failed', e);
      throw e;
    }
  }

  async deleteQuestion(questionId: string) {
    try {
      this.initClient();
      await this.client.index(this.indexName).deleteDocument(questionId);
      return { success: true };
    } catch (e: any) {
      this.logger.error(`Failed to delete question ${questionId} from index`, e);
      return { success: false, error: e.message };
    }
  }

  async getStats() {
    try {
      this.initClient();
      const stats = await this.client.index(this.indexName).getStats();
      return stats;
    } catch (e: any) {
      this.logger.error('Failed to get index stats', e);
      return { error: e.message };
    }
  }
}