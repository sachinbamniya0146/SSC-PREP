import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface StudyPlanRequest {
  userId: string;
  testResults: {
    totalQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    skippedAnswers: number;
    subjectScores: { subject: string; score: number; total: number }[];
    topicScores: { topic: string; score: number; total: number }[];
  };
  userOpenRouterKey?: string;
}

interface StudyPlanResponse {
  plan: string;
  planHindi: string;
  focusAreas: string[];
  focusAreasHindi: string[];
  dailySchedule: { day: number; topic: string; duration: number; priority: 'high' | 'medium' | 'low' }[];
  tips: string[];
  tipsHindi: string[];
}

@Injectable()
export class StudyPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async generateStudyPlan(request: StudyPlanRequest, userOpenRouterKey?: string): Promise<StudyPlanResponse> {
    const { testResults } = request;
    const accuracy = testResults.totalQuestions > 0 ? (testResults.correctAnswers / testResults.totalQuestions) * 100 : 0;
    const apiKey = userOpenRouterKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return this.generateBasicStudyPlan(testResults);
    }

    try {
      const prompt = `Create a study plan based on these test results:
Total: ${testResults.totalQuestions}, Correct: ${testResults.correctAnswers} (${accuracy.toFixed(1)}%)
Subjects: ${testResults.subjectScores.map(s => `${s.subject}: ${s.score}/${s.total}`).join(', ')}
Topics: ${testResults.topicScores.map(t => `${t.topic}: ${t.score}/${t.total}`).join(', ')}

Return JSON:
{
  "plan": "Study plan in English",
  "planHindi": "Study plan in Hindi",
  "focusAreas": ["weak areas"],
  "focusAreasHindi": ["कमजोर areas"],
  "dailySchedule": [{"day": 1, "topic": "topic", "duration": 60, "priority": "high"}],
  "tips": ["tips in English"],
  "tipsHindi": ["tips in Hindi"]
}`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://sscprephub.in',
          'X-Title': 'SSC Prep Hub',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) throw new Error(`AI API error: ${response.status}`);

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response');

      return JSON.parse(content);
    } catch {
      return this.generateBasicStudyPlan(testResults);
    }
  }

  private generateBasicStudyPlan(testResults: StudyPlanRequest['testResults']): StudyPlanResponse {
    const weakTopics = testResults.topicScores
      .filter(t => (t.score / t.total) * 100 < 60)
      .sort((a, b) => (a.score / a.total) - (b.score / b.total))
      .slice(0, 5)
      .map(t => t.topic);

    const accuracy = testResults.totalQuestions > 0 ? (testResults.correctAnswers / testResults.totalQuestions) * 100 : 0;

    return {
      plan: accuracy < 50
        ? 'Focus on fundamentals. Practice 80+ questions daily.'
        : accuracy < 75
        ? 'Good progress! Focus on weak areas. Practice 100+ questions daily.'
        : 'Excellent! Focus on advanced topics and time management.',
      planHindi: accuracy < 50
        ? 'बुनियादी बतों पर ध्यान दें। रोज़ 80+ प्रश्न अभ्यאस करें।'
        : accuracy < 75
        ? 'अचछी प़्रगति! कमज़ोर areas पर ध्यान दें।'
        : 'उतकृष्ट! उन्नत विषयों पर ध्यान दें।',
      focusAreas: weakTopics,
      focusAreasHindi: weakTopics,
      dailySchedule: weakTopics.slice(0, 5).map((topic, i) => ({
        day: i + 1,
        topic,
        duration: 60,
        priority: 'high' as const,
      })),
      tips: ['Practice daily', 'Focus on weak areas', 'Take mock tests'],
      tipsHindi: ['रोज़ाना अभ्यास करें', 'कमज़ोर areas पर ध्यान दें', 'Mock tests लें'],
    };
  }
}
