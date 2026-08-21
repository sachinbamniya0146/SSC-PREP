// Achievement Badges System — Gamification
// Awards badges for streaks, XP milestones, accuracy, tests completed, etc.
import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { cacheSet } from "../common/cache";
import { AchievementType, AchievementTier } from "@prisma/client";

const TIER_ORDER: AchievementTier[] = ["DIAMOND", "PLATINUM", "GOLD", "SILVER", "BRONZE"];
const TIER_XP: Record<AchievementTier, number> = {
  DIAMOND: 500,
  PLATINUM: 250,
  GOLD: 100,
  SILVER: 50,
  BRONZE: 0,
};

interface AchievementDef {
  type: AchievementType;
  key: string;
  name: string;
  nameHindi: string;
  description: string;
  descriptionHindi: string;
  icon: string;
  tier: AchievementTier;
  criteria: { metric: string; threshold: number };
}

/** Seed list of achievements — can be extended via admin panel. */
const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { type: "STREAK_DAYS", key: "streak_7", name: "7-Day Streak", nameHindi: "7-दिवसीय स्ट्रीक", description: "Practice for 7 consecutive days", descriptionHindi: "लगातार 7 दिन अभ्यास करें", icon: "🔥", tier: "BRONZE", criteria: { metric: "currentStreak", threshold: 7 } },
  { type: "STREAK_DAYS", key: "streak_30", name: "30-Day Streak", nameHindi: "30-दिवसीय स्ट्रीक", description: "Practice for 30 consecutive days", descriptionHindi: "लगातार 30 दिन अभ्यास करें", icon: "🔥🔥", tier: "SILVER", criteria: { metric: "currentStreak", threshold: 30 } },
  { type: "STREAK_DAYS", key: "streak_60", name: "60-Day Streak", nameHindi: "60-दिवसीय स्ट्रीक", description: "Practice for 60 consecutive days", descriptionHindi: "लगातार 60 दिन अभ्यास करें", icon: "🔥🔥🔥", tier: "GOLD", criteria: { metric: "currentStreak", threshold: 60 } },
  { type: "STREAK_DAYS", key: "streak_100", name: "100-Day Streak", nameHindi: "100-दिवसीय स्ट्रीक", description: "Practice for 100 consecutive days", descriptionHindi: "लगातार 100 दिन अभ्यास करें", icon: "🔥🔥🔥🔥", tier: "PLATINUM", criteria: { metric: "currentStreak", threshold: 100 } },
  { type: "STREAK_DAYS", key: "streak_365", name: "Year Warrior", nameHindi: "वर्ष-युद्धी", description: "Practice for 365 consecutive days", descriptionHindi: "लगातार 365 दिन अभ्यास करें", icon: "🔥🔥🔥🔥🔥", tier: "DIAMOND", criteria: { metric: "currentStreak", threshold: 365 } },

  { type: "XP_MILESTONE", key: "xp_1000", name: "Rising Star", nameHindi: "उगता सितारा", description: "Reach 1,000 XP", descriptionHindi: "1,000 एक्सपी हासिल करें", icon: "⭐", tier: "BRONZE", criteria: { metric: "xp", threshold: 1000 } },
  { type: "XP_MILESTONE", key: "xp_5000", name: "Knowledge Seeker", nameHindi: "ज्ञान के खोजकर्ता", description: "Reach 5,000 XP", descriptionHindi: "5,000 एक्सपी हासिल करें", icon: "🌟", tier: "SILVER", criteria: { metric: "xp", threshold: 5000 } },
  { type: "XP_MILESTONE", key: "xp_10000", name: "Master Learner", nameHindi: "मास्टर सीखने वाला", description: "Reach 10,000 XP", descriptionHindi: "10,000 एक्सपी हासिल करें", icon: "✨", tier: "GOLD", criteria: { metric: "xp", threshold: 10000 } },
  { type: "XP_MILESTONE", key: "xp_50000", name: "Legend", nameHindi: "अभूतपूर्व", description: "Reach 50,000 XP", descriptionHindi: "50,000 एक्सपी हासिल करें", icon: "👑", tier: "PLATINUM", criteria: { metric: "xp", threshold: 50000 } },

  { type: "ACCURACY_MASTER", key: "accuracy_80", name: "Sharp Shooter", nameHindi: "तेज़ निशानेबाज़", description: "80%+ accuracy in a test", descriptionHindi: "80%+ सटीकता", icon: "🎯", tier: "BRONZE", criteria: { metric: "accuracy", threshold: 80 } },
  { type: "ACCURACY_MASTER", key: "accuracy_90", name: "Perfect Strike", nameHindi: "परफ़ेक्ट स्ट्राइक", description: "90%+ accuracy in a test", descriptionHindi: "90%+ सटीकता", icon: "🎯🎯", tier: "SILVER", criteria: { metric: "accuracy", threshold: 90 } },
  { type: "ACCURACY_MASTER", key: "accuracy_95", name: "Genius", nameHindi: "मनीषा", description: "95%+ accuracy in a test", descriptionHindi: "95%+ सटीकता", icon: "🎯🎯🎯", tier: "GOLD", criteria: { metric: "accuracy", threshold: 95 } },

  { type: "TESTS_COMPLETED", key: "tests_10", name: "First Steps", nameHindi: "पहले कदम", description: "Complete 10 tests", descriptionHindi: "10 टेस्ट पूरा करें", icon: "👟", tier: "BRONZE", criteria: { metric: "testsCompleted", threshold: 10 } },
  { type: "TESTS_COMPLETED", key: "tests_50", name: "Diligent Learner", nameHindi: "परिश्रमी शिक्षार्थी", description: "Complete 50 tests", descriptionHindi: "50 टेस्ट पूरा करें", icon: "📚", tier: "SILVER", criteria: { metric: "testsCompleted", threshold: 50 } },
  { type: "TESTS_COMPLETED", key: "tests_100", name: "Test Master", nameHindi: "टेस्ट मास्टर", description: "Complete 100 tests", descriptionHindi: "100 टेस्ट पूरा करें", icon: "🏆", tier: "GOLD", criteria: { metric: "testsCompleted", threshold: 100 } },

  { type: "QUESTIONS_ANSWERED", key: "qs_100", name: "Getting Started", nameHindi: "शुरुआती", description: "Answer 100 questions", descriptionHindi: "100 प्रश्न उत्तर दें", icon: "✍️", tier: "BRONZE", criteria: { metric: "questionsAnswered", threshold: 100 } },
  { type: "QUESTIONS_ANSWERED", key: "qs_1000", name: "Dedicated", nameHindi: "समर्पित", description: "Answer 1,000 questions", descriptionHindi: "1,000 प्रश्न उत्तर दें", icon: "📖", tier: "SILVER", criteria: { metric: "questionsAnswered", threshold: 1000 } },
  { type: "QUESTIONS_ANSWERED", key: "qs_5000", name: "Question Master", nameHindi: "प्रश्न मास्टर", description: "Answer 5,000 questions", descriptionHindi: "5,000 प्रश्न उत्तर दें", icon: "🧠", tier: "GOLD", criteria: { metric: "questionsAnswered", threshold: 5000 } },

  { type: "DAILY_QUIZ_STREAK", key: "dq_streak_7", name: "Quiz Regular", nameHindi: "क्विज़ नियमित", description: "Take daily quiz for 7 days", descriptionHindi: "7 दिन क्विज़ लें", icon: "🎯", tier: "BRONZE", criteria: { metric: "dailyQuizStreak", threshold: 7 } },
  { type: "DAILY_QUIZ_STREAK", key: "dq_streak_30", name: "Quiz Machine", nameHindi: "क्विज़ मशीन", description: "Take daily quiz for 30 days", descriptionHindi: "30 दिन क्विज़ लें", icon: "🎯🎯", tier: "SILVER", criteria: { metric: "dailyQuizStreak", threshold: 30 } },

  { type: "MOCK_RANK", key: "mock_top10", name: "Top 10 Finisher", nameHindi: "टॉप 10 फिनिशर", description: "Rank in top 10 in a mock test", descriptionHindi: "मक परीक्षण में टॉप 10 रैंक पाएं", icon: "🏅", tier: "GOLD", criteria: { metric: "mockRank", threshold: 10 } },

  { type: "REFERRAL", key: "ref_5", name: "Social Butterfly", nameHindi: "सामाजिक बटरफ्लाई", description: "Refer 5 friends who make a paid purchase", descriptionHindi: "5 दोस्त रेफ़र करें जो पेड पर्चेज़ करें", icon: "🦋", tier: "BRONZE", criteria: { metric: "paidReferrals", threshold: 5 } },
  { type: "REFERRAL", key: "ref_10", name: "Brand Ambassador", nameHindi: "ब्रांड एंबैसडर", description: "Refer 10 friends who make a paid purchase", descriptionHindi: "10 दोस्त रेफ़र करें जो पेड पर्चेज़ करें", icon: "🎤", tier: "GOLD", criteria: { metric: "paidReferrals", threshold: 10 } },

  { type: "SPECIAL", key: "first_test", name: "First Test", nameHindi: "पहला टेस्ट", description: "Take your first test", descriptionHindi: "अपना पहला टेस्ट लें", icon: "🥇", tier: "BRONZE", criteria: { metric: "testsCompleted", threshold: 1 } },
  { type: "SPECIAL", key: "first_mock", name: "First Mock", nameHindi: "पहला मक", description: "Take your first mock test", descriptionHindi: "अपना पहला मक परीक्षण लें", icon: "🏁", tier: "BRONZE", criteria: { metric: "mocksCompleted", threshold: 1 } },
];

@Injectable()
export class AchievementService {
  private readonly logger = new Logger(AchievementService.name);

  constructor(private prisma: PrismaService) {}

  /** Seed achievements to DB if not present. */
  async seedAchievements() {
    const existing = await this.prisma.achievement.count();
    if (existing > 0) return;

    for (const def of ACHIEVEMENT_DEFS) {
      await this.prisma.achievement.upsert({
        where: { key: def.key },
        update: {},
        create: {
          type: def.type,
          key: def.key,
          name: def.name,
          nameHindi: def.nameHindi,
          description: def.description,
          descriptionHindi: def.descriptionHindi,
          icon: def.icon,
          tier: def.tier,
          xpReward: TIER_XP[def.tier],
          coinReward: Math.floor(TIER_XP[def.tier] / 10),
          criteria: def.criteria,
          sortOrder: ACHIEVEMENT_DEFS.indexOf(def),
        },
      });
    }
  }

  /** Get all achievements (catalog) — optionally with earned status. */
  async getAllAchievements(userId?: string) {
    await this.seedAchievements();

    const all = await this.prisma.achievement.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });

    if (!userId) return { achievements: all };

    const earned = await this.prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true, earnedAt: true },
    });

    const earnedMap = new Map(earned.map((e) => [e.achievementId, e]));

    return {
      achievements: all.map((a) => ({
        ...a,
        criteria: a.criteria as { metric: string; threshold: number },
        earned: earnedMap.get(a.id),
      })),
    };
  }

  /** Get all achievements with earned status for a user. */
  async getUserAchievements(userId: string) {
    await this.seedAchievements();

    const [earned, all] = await Promise.all([
      this.prisma.userAchievement.findMany({
        where: { userId },
        include: { achievement: true },
        orderBy: { earnedAt: "desc" },
      }),
      this.prisma.achievement.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    return {
      achievements: all.map((a) => ({
        ...a,
        criteria: a.criteria as { metric: string; threshold: number },
        earned: earned.find((e) => e.achievementId === a.id),
      })),
      earned,
    };
  }

  /** Check and award achievements based on user state. Called after XP/streak updates. */
  async checkAndAward(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        xp: true,
      },
    });
    if (!user) throw new BadRequestException("User not found");

    const { earned } = await this.getUserAchievements(userId);
    const earnedKeys = new Set(earned.map((e) => e.achievement.key));

    // Get stats for tests, questions, mocks, daily quiz streak, accuracy
    const [testCount, answerCount, mockCount, dailyQuizStreak, bestAccuracy] = await Promise.all([
      this.prisma.testAttempt.count({ where: { userId, status: "SUBMITTED" } }),
      this.prisma.attemptAnswer.count({ where: { testAttempt: { userId, status: "SUBMITTED" } } }),
      this.prisma.testAttempt.count({
        where: { userId, status: "SUBMITTED", testTemplate: { type: "FULL_MOCK" } },
      }),
      this.getDailyQuizStreak(userId),
      this.getBestAccuracy(userId),
    ]);

    const userMetrics: Record<string, number> = {
      currentStreak: user.longestStreak,
      xp: user.xp,
      accuracy: bestAccuracy,
      testsCompleted: testCount,
      questionsAnswered: answerCount,
      mocksCompleted: mockCount,
      dailyQuizStreak,
      paidReferrals: 0,
      mockRank: 0,
    };

    const newlyEarned: any[] = [];

    for (const def of ACHIEVEMENT_DEFS) {
      if (earnedKeys.has(def.key)) continue;

      const metric = def.criteria.metric;
      const threshold = def.criteria.threshold;
      const value = userMetrics[metric] || 0;

      if (value >= threshold) {
        const achievement = await this.prisma.achievement.findUnique({
          where: { key: def.key },
        });
        if (!achievement) continue;

        await this.prisma.userAchievement.create({
          data: {
            userId,
            achievementId: achievement.id,
          },
        });

        await this.prisma.user.update({
          where: { id: userId },
          data: {
            xp: { increment: achievement.xpReward },
            coins: { increment: achievement.coinReward },
          },
        });

        newlyEarned.push({
          ...achievement,
          criteria: achievement.criteria as { metric: string; threshold: number },
        });
      }
    }

    cacheSet(`achievements:${userId}`, { userMetrics, newlyEarned }, 60_000);

    return { userMetrics, newlyEarned };
  }

  private async getDailyQuizStreak(userId: string): Promise<number> {
    const attempts = await this.prisma.testAttempt.findMany({
      where: {
        userId,
        testTemplate: { type: "DAILY_PRACTICE" },
        status: "SUBMITTED",
      },
      select: { submittedAt: true, startedAt: true },
      orderBy: { submittedAt: "desc" },
    });

    if (attempts.length === 0) return 0;

    const dates = attempts
      .filter((a) => a.submittedAt)
      .map((a) => {
        const d = new Date(a.submittedAt!);
        return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      });

    const uniqueDates = Array.from(new Set(dates));
    let streak = 0;
    const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let checkDate = today;
    while (uniqueDates.includes(checkDate)) {
      streak++;
      const d = new Date(checkDate + "T00:00:00");
      d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
      checkDate = d.toISOString().slice(0, 10);
    }

    return streak;
  }

  private async getBestAccuracy(userId: string): Promise<number> {
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: "SUBMITTED" },
      select: { totalCorrect: true, testTemplate: { select: { totalQuestions: true } } },
    });

    if (attempts.length === 0) return 0;

    return Math.max(
      ...attempts.map((a) =>
        a.testTemplate.totalQuestions > 0 ? Math.round((a.totalCorrect / a.testTemplate.totalQuestions) * 100) : 0
      )
    );
  }
}

export { TIER_ORDER, TIER_XP };