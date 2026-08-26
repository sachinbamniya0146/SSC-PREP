/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

interface AIExplanationRequest {
  questionText: string;
  questionTextHindi?: string;
  options: { key: string; text: string; textHi?: string }[];
  correctAnswer: string;
  explanation?: string;
  explanationHindi?: string;
  subject?: string;
  chapter?: string;
  difficulty?: string;
}

interface AIExplanationResponse {
  explanation: string;
  explanationHindi: string;
  stepByStepSolution: string;
  stepByStepSolutionHindi: string;
  keyConcepts: string[];
  keyConceptsHindi: string[];
  relatedFormulas?: string[];
  tips?: string[];
}

@Injectable()
export class AIExplanationService {
  private readonly openRouterApiKey: string;
  private readonly openRouterBaseUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
  }

  /**
   * Get or generate AI explanation for a question
   * If already exists in DB, return cached version
   * Otherwise generate new one, save to DB, and return
   */
  async getOrGenerateExplanation(questionId: string, userOpenRouterKey?: string): Promise<AIExplanationResponse> {
    // First check if explanation already exists in database
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        questionText: true,
        questionTextHindi: true,
        optionsJson: true,
        correctAnswer: true,
        explanation: true,
        explanationHindi: true,
        explanationSource: true,
        subject: { select: { name: true } },
        chapter: { select: { name: true } },
        difficulty: true,
      },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // If explanation already exists and is AI-generated or human-verified, return it
    if (question.explanation && question.explanationHindi && 
        (question.explanationSource === 'AI_GENERATED' || question.explanationSource === 'HUMAN_VERIFIED')) {
      return {
        explanation: question.explanation,
        explanationHindi: question.explanationHindi || question.explanation,
        stepByStepSolution: question.explanation,
        stepByStepSolutionHindi: question.explanationHindi || question.explanation,
        keyConcepts: [],
        keyConceptsHindi: [],
      };
    }

    // Generate new AI explanation
    const aiKey = userOpenRouterKey || this.openRouterApiKey;
    if (!aiKey) {
      throw new BadRequestException('No OpenRouter API key available. Please add your API key in settings or contact admin.');
    }

    const explanation = await this.generateAIExplanation({
      questionText: question.questionText,
      questionTextHindi: question.questionTextHindi || undefined,
      options: question.optionsJson as any[],
      correctAnswer: question.correctAnswer,
      subject: question.subject?.name,
      chapter: question.chapter?.name,
      difficulty: question.difficulty,
    }, aiKey);

    // Save the generated explanation to database
    await this.prisma.question.update({
      where: { id: questionId },
      data: {
        explanation: explanation.explanation,
        explanationHindi: explanation.explanationHindi,
        explanationSource: 'AI_GENERATED',
      },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        userId: 'system',
        action: 'AI_EXPLANATION_GENERATED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: { 
          hasHindi: !!explanation.explanationHindi,
          stepByStep: true,
        } as any,
      },
    });

    return explanation;
  }

  /**
   * Generate AI explanation using OpenRouter
   */
  private async generateAIExplanation(
    request: AIExplanationRequest,
    apiKey: string
  ): Promise<AIExplanationResponse> {
    const optionsText = request.options
      .map(o => `${o.key}) ${o.text}${o.textHi ? ` / ${o.textHi}` : ''}`)
      .join('\n');

    const prompt = `You are an expert SSC exam tutor. Provide a detailed, step-by-step explanation for this question in BOTH English and Hindi.

Question: ${request.questionText}
${request.questionTextHindi ? `\nHindi: ${request.questionTextHindi}` : ''}

Options:
${optionsText}

Correct Answer: ${request.correctAnswer}

${request.explanation ? `Existing Explanation: ${request.explanation}` : ''}
${request.explanationHindi ? `Existing Hindi Explanation: ${request.explanationHindi}` : ''}

Subject: ${request.subject || 'General'}
Chapter: ${request.chapter || 'General'}
Difficulty: ${request.difficulty || 'MEDIUM'}

Provide a comprehensive response in the following JSON format:
{
  "explanation": "Clear, concise explanation in English (2-3 paragraphs)",
  "explanationHindi": "Clear, concise explanation in Hindi (2-3 paragraphs)",
  "stepByStepSolution": "Detailed step-by-step solution in English with numbered steps",
  "stepByStepSolutionHindi": "Detailed step-by-step solution in Hindi with numbered steps",
  "keyConcepts": ["concept1", "concept2", "concept3"],
  "keyConceptsHindi": ["अवधारणा1", "अवधारणा2", "अवधारणा3"],
  "relatedFormulas": ["formula1", "formula2"] (if applicable),
  "tips": ["tip1", "tip2"] (exam-specific tips)
}

IMPORTANT:
- Both English and Hindi must be high quality
- Step-by-step solution must be detailed enough for a student to follow
- Use simple, clear language
- Include relevant formulas/tricks for SSC exams
- Return ONLY valid JSON`;

    try {
      const response = await fetch(this.openRouterBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://sscprephub.in',
          'X-Title': 'SSC Prep Hub',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini', // Free model
          messages: [
            { role: 'system', content: 'You are an expert SSC exam tutor providing detailed bilingual explanations.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from AI');
      }

      const parsed = JSON.parse(content);
      return {
        explanation: parsed.explanation || '',
        explanationHindi: parsed.explanationHindi || '',
        stepByStepSolution: parsed.stepByStepSolution || parsed.explanation || '',
        stepByStepSolutionHindi: parsed.stepByStepSolutionHindi || parsed.explanationHindi || '',
        keyConcepts: parsed.keyConcepts || [],
        keyConceptsHindi: parsed.keyConceptsHindi || [],
        relatedFormulas: parsed.relatedFormulas || [],
        tips: parsed.tips || [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('AI Explanation generation failed:', message);
      throw new BadRequestException(`Failed to generate AI explanation: ${message}`);
    }
  }

  /**
   * Check if question has AI explanation
   */
  async hasExplanation(questionId: string): Promise<boolean> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { explanation: true, explanationHindi: true, explanationSource: true },
    });
    return !!(question?.explanation && question?.explanationHindi && 
      (question.explanationSource === 'AI_GENERATED' || question.explanationSource === 'HUMAN_VERIFIED'));
  }

  /**
   * Get available free models from OpenRouter
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.openRouterApiKey}`,
        },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.data
        .filter((m: any) => m.pricing?.prompt === '0' && m.pricing?.completion === '0')
        .map((m: any) => m.id)
        .slice(0, 10);
    } catch {
      return ['openai/gpt-4o-mini', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct'];
    }
  }
}