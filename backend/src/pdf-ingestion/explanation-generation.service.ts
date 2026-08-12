import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

@Injectable()
export class ExplanationGenerationService {
  private readonly logger = new Logger(ExplanationGenerationService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const baseUrl = this.config.get<string>('OPENAI_BASE_URL');
    this.model = this.config.get<string>('LLM_EXPLANATION_MODEL') || 'openai/gpt-oss-20b:free';
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY is not set. Explanation generation will not work.');
    }
    this.openai = new OpenAI({ apiKey: apiKey || 'missing', baseURL: baseUrl || undefined });
  }

  async generateExplanation(questionText: string, language: 'English' | 'Hindi' = 'English'): Promise<string> {
    if (!this.openai.apiKey || this.openai.apiKey === 'missing') {
      throw new Error('OpenAI API key is not configured');
    }

    const prompt = language === 'English'
      ? `Explain the following SSC question step by step, providing the reasoning behind the correct answer. Keep it concise (3-5 lines):\n\n${questionText}`
      : `निम्नलिखित SSC प्रश्न का चरण दर चरण स्पष्टीकरण दें, सही उत्तर के पीछे के तर्क को समझाएं। संक्षिप्त रखें (3-5 पंक्तियां):\n\n${questionText}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
      });

      return completion.choices[0].message.content?.trim() || '';
    } catch (error: unknown) {
      this.logger.error(`Failed to generate explanation: ${String(error)}`);
      throw error;
    }
  }

  async generateExplanationForQuestion(questionId: string): Promise<void> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        questionText: true,
        questionTextHindi: true,
        explanation: true,
        explanationHindi: true,
      },
    });

    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    // Generate English explanation if missing
    if (!question.explanation) {
      const explanation = await this.generateExplanation(question.questionText, 'English');
      await this.prisma.question.update({
        where: { id: questionId },
        data: { explanation, explanationSource: 'AI_GENERATED' },
      });
      this.logger.log(`Generated English explanation for question ${questionId}`);
    }

    // Generate Hindi explanation if missing
    if (!question.explanationHindi && question.questionTextHindi) {
      const explanationHindi = await this.generateExplanation(question.questionTextHindi, 'Hindi');
      await this.prisma.question.update({
        where: { id: questionId },
        data: { explanationHindi },
      });
      this.logger.log(`Generated Hindi explanation for question ${questionId}`);
    }
  }
}