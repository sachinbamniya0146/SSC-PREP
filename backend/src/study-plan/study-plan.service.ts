/* eslint-disable @typescript-eslint/no-explicit-any */
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
    const { userId, testResults } = request;
    const accuracy = testResults.totalQuestions > 0 ? (testResults.correctAnswers / testResults.totalQuestions) * 100 : 0;

    const apiKey = userOpenRouterKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return this.generateBasicStudyPlan(testResults);
    }

    try {
      const prompt = `You are an expert SSC exam study planner. Based on the student's test performance, create a personalized study plan.

Test Performance:
- Total Questions: ${testResults.totalQuestions}
- Correct Answers: ${testResults.correctAnswers} (${((testResults.correctAnswers / testResults.totalQuestions) * 100).toFixed(1)}%)
- Incorrect Answers: ${testResults.incorrectAnswers}
- Skipped Answers: ${testResults.skippedAnswers}

Subject-wise Performance:
${testResults.subjectScores.map(s => `- ${s.subject}: ${s.score}/${s.total} (${((s.score/s.total)*100).toFixed(1)}%)`).join('\n')}

Topic-wise Performance:
${testResults.topicScores.map(t => `- ${t.topic}: ${t.score}/${t.total} (${((t.score/t.total)*100).toFixed(1)}%)`).join('\n')}

Create a comprehensive study plan in the following JSON format:
{
  "plan": "Detailed study plan in English (3-4 paragraphs with specific recommendations)",
  "planHindi": "Detailed study plan in Hindi (3-4 paragraphs with specific recommendations)",
  "focusAreas": ["Top 5 weak areas to focus on"],
  "focusAreasHindi": ["Top 5 weak areas in Hindi"],
  "dailySchedule": [
    { "day": 1, "topic": "Topic name", "duration": 60, "priority": "high" },
    { "day": 2, "topic": "Topic name", "duration": 45, "priority": "medium" }
  ],
  "tips": ["Exam tips in English"],
  "tipsHindi": ["Exam tips in Hindi"]
}

IMPORTANT:
- Focus on weak areas first
- Include specific topics, not just subjects
- Make duration realistic (30-90 minutes per topic)
- Use simple, encouraging language
- Return ONLY valid JSON`;

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
          messages: [
            { role: 'system', content: 'You are an expert SSC exam study planner.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from AI');
      }

      return JSON.parse(content);
    } catch (error) {
      return this.generateBasicStudyPlan(testResults);
    }
  }

  private generateBasicStudyPlan(testResults: StudyPlanRequest['testResults']): StudyPlanResponse {
    const weakSubjects = testResults.subjectScores
      .filter(s => (s.score / s.total) * 100 < 60)
      .sort((a, b) => (a.score / a.total) - (b.score / b.total))
      .slice(0, 5)
      .map(s => s.subject);

    const weakTopics = testResults.topicScores
      .filter(t => (t.score / t.total) * 100 < 60)
      .sort((a, b) => (a.score / a.total) - (b.score / b.total))
      .slice(0, 5)
      .map(t => t.topic);

    const accuracy = testResults.totalQuestions > 0 ? (testResults.correctAnswers / testResults.totalQuestions) * 100 : 0;

    return {
      plan: accuracy < 50
        ? 'Your accuracy is low. Focus on building fundamentals. Start with easy topics and practice daily. Aim for 80+ questions per day.'
        : accuracy < 75
        ? 'Good progress! Focus on your weak areas while maintaining strength in good subjects. Practice 100+ questions daily.'
        : 'Excellent performance! Focus on advanced topics and time management. Practice full mock tests.',
      planHindi: accuracy < 50
        ? 'आपकୀ सटीकता कम है। बुनियादी बातों पर ध्यान दें। आसान विषयों से शुरू करें और रोजाना अभ्यास करें।'
        : accuracy < 75
        ? 'अच्छी प्रगति! अपनी कमज़ोर areas पर ध्यान दें जबकि अच्छे विषयों में मज़बूती बनाए रखें।'
        : 'उत्कृष्ट प्रदर्शन! उन्नत विषयों और समय प्रबंधन पर ध्यान दें।',
      focusAreas: [...weakSubjects, ...weakTopics].slice(0, 5),
      focusAreasHindi: [...weakSubjects, ...weakTopics].slice(0, 5),
      dailySchedule: [
        { day: 1, topic: weakTopics[0] || 'Quantitative Aptitude', duration: 60, priority: 'high' },
        { day: 2, topic: weakTopics[1] || 'Reasoning', duration: 45, priority: 'high' },
        { day: 3, topic: weakTopics[2] || 'General Awareness', duration: 30, priority: 'medium' },
        { day: 4, topic: weakTopics[0] || 'English', duration: 45, priority: 'medium' },
        { day: 5, topic: 'Mock Test Review', duration: 90, priority: 'high' },
      ],
      tips: ['Practice daily', 'Focus on weak areas', 'Take mock tests regularly', 'Review mistakes'],
      tipsHindi: ['रोज़ाना अभ्यास करें', 'कमज़ोर areas पर ध्यान दें', 'नियमित mock tests लें', 'ग़लतियों का विश्लेषण करें'],
    };
  }
}
