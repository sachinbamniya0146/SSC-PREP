import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AIExplanationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrGenerateExplanation(questionId: string, _userOpenRouterKey?: string) {
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
      throw new Error('Question not found');
    }

    if (question.explanation && question.explanationHindi) {
      return {
        explanation: question.explanation,
        explanationHindi: question.explanationHindi,
        stepByStepSolution: question.explanation,
        stepByStepSolutionHindi: question.explanationHindi,
        keyConcepts: [],
        keyConceptsHindi: [],
      };
    }

    throw new Error('No AI explanation available yet. Contact admin to generate.');
  }

  async hasExplanation(questionId: string): Promise<boolean> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { explanation: true, explanationHindi: true, explanationSource: true },
    });
    return !!(question?.explanation && question?.explanationHindi &&
      (question.explanationSource === 'AI_GENERATED' || question.explanationSource === 'HUMAN_VERIFIED'));
  }

  async getAvailableModels() {
    return ['openai/gpt-4o-mini', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct'];
  }
}
