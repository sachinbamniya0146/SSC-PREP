// Shared "is the daily revision due?" computation. Lives in a plain function
// (not a service method) because THREE places need the exact same answer and
// must never disagree: VocabService (gate on new words), VocabRevisionService
// (status/start/submit) and MonetizationService (validating a skip payment).
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../gamification/gamification.service';
import { skipFeeForStreak } from './vocab-messages';

export interface RevisionState {
  dateKey: string;
  /** Word ids eligible for today's revision, highest priority first (uncapped). */
  poolWordIds: string[];
  /** Words whose revision answer was wrong and still need a 95% re-master. */
  remasterWordIds: string[];
  doneToday: 'COMPLETED' | 'SKIPPED' | null;
  inProgressSessionId: string | null;
  /** true = the student must revise (or pay to skip) before new words. */
  due: boolean;
  skipStreak: number;
  skipFeeInr: number;
  nextSkipFeeInr: number;
  allUnlocked: boolean;
}

export async function computeRevisionState(prisma: PrismaService, userId: string, now = new Date()): Promise<RevisionState> {
  const dateKey = istDateKey(now);

  const [progressRows, remasterRows, sessionsToday, userState] = await Promise.all([
    prisma.vocabWordProgress.findMany({
      where: {
        userId,
        remasterRequired: false,
        OR: [{ masteredAt: { not: null } }, { forceUnlocked: true }],
        word: { isActive: true, questions: { some: {} } },
      },
      select: { wordId: true, masteredAt: true, lastRevisedAt: true, updatedAt: true },
    }),
    prisma.vocabWordProgress.findMany({
      where: { userId, remasterRequired: true, word: { isActive: true } },
      select: { wordId: true },
    }),
    prisma.vocabRevisionSession.findMany({
      where: { userId, dateKey },
      select: { id: true, status: true, expiresAt: true },
    }),
    prisma.vocabUserState.findUnique({ where: { userId } }),
  ]);

  // A word learned TODAY is not revised today — you cannot "revise" what you
  // just mastered an hour ago. It joins the pool from tomorrow.
  const eligible = progressRows.filter((r) => {
    const learnedAt = r.masteredAt ?? r.updatedAt;
    return istDateKey(learnedAt) !== dateKey;
  });
  // Longest-since-revised first (never revised = highest priority).
  eligible.sort((a, b) => {
    const ta = a.lastRevisedAt ? a.lastRevisedAt.getTime() : 0;
    const tb = b.lastRevisedAt ? b.lastRevisedAt.getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (a.masteredAt?.getTime() ?? 0) - (b.masteredAt?.getTime() ?? 0);
  });

  const completed = sessionsToday.find((s) => s.status === 'COMPLETED');
  const skipped = sessionsToday.find((s) => s.status === 'SKIPPED');
  const inProgress = sessionsToday.find((s) => s.status === 'IN_PROGRESS' && s.expiresAt > now);
  const doneToday: RevisionState['doneToday'] = completed ? 'COMPLETED' : skipped ? 'SKIPPED' : null;

  const skipStreak = userState?.skipStreak ?? 0;
  return {
    dateKey,
    poolWordIds: eligible.map((r) => r.wordId),
    remasterWordIds: remasterRows.map((r) => r.wordId),
    doneToday,
    inProgressSessionId: inProgress?.id ?? null,
    due: eligible.length > 0 && !doneToday,
    skipStreak,
    skipFeeInr: skipFeeForStreak(skipStreak),
    nextSkipFeeInr: skipFeeForStreak(skipStreak + 1),
    allUnlocked: !!userState?.allUnlockedAt,
  };
}
