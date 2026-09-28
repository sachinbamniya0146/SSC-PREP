// Vocabulary Mastery (NEW — Sep 2026, revised Sep 26 2026)
//
// "ek ek word ka pura revision/understand, uske baad usi word ka quiz —
// jab 95% sahi kare tab hi complete mark lage, jab tak agla word test nahi
// khulega jab tak pehla complete na ho": a strictly sequential word-by-word
// mastery track, parallel to (and independent of) the regular
// Subject/Chapter/Topic/Question exam-prep bank.
//
// Unlock state is never stored as a column — see VocabWordProgress in
// schema.prisma for why — it is derived here, once, from: masteredAt (is
// this word actually done), forceUnlocked (paid ₹10 to skip just this one
// word — legacy path, see below), an ACTIVE VocabSubscription (paid ₹10/
// month — unlocks every word for the subscription's duration), and
// orderIndex (is this the very first word, or does the previous word's
// masteredAt say it's done). Computing it in one place keeps the
// LOCKED/UNLOCKED/MASTERED rule impossible to drift out of sync with
// itself the way a separately-written "status" column could.
//
// REVISED (Sep 26 2026) per Sachin's follow-up:
//  1. "ye vocab ka alag subscription rahe, ₹10 per month" — added
//     VocabSubscription; while active it unlocks every word (does NOT
//     auto-master anything — a subscriber still has to actually take and
//     pass each quiz).
//  2. Locked-word message now names the ACTUAL next actionable word (the
//     one furthest-along-but-not-yet-mastered unlocked word) instead of a
//     generic "master the previous word" — a student clicking word #12
//     while stuck on word #3 was getting no usable guidance before.
//  3. "40 questions me se X sahi chahiye, X me value daal dena" — added
//     requiredCorrectCount(), returned on every word/quiz/result response,
//     so the UI can say "38/40 sahi chahiye" instead of only a bare "95%".
//  4. "question upar niche ho jaye" on every retry — getQuiz() already
//     reshuffled question ORDER on every call; now each question's OPTION
//     order is reshuffled too (a memorized "3rd option" pattern no longer
//     works), with the stored A/B/C/D key kept bound to its original text
//     so submitQuiz()'s scoring needs no remapping.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../gamification/gamification.service';

const MASTERY_THRESHOLD_PCT = 95;

/**
 * "95% kitna hota hai" — 95% of a question count that isn't a clean
 * multiple of 20 has no exact integer answer (95% of 40 = 38 exactly, but
 * 95% of 25 = 23.75). We round UP (Math.ceil), so the bar is never
 * accidentally softer than 95% for an admin's question count — 23.75 becomes
 * "24 out of 25 correct", which is >=95% (96%), never <95%.
 */
function requiredCorrectCount(totalQuestions: number): number {
  return Math.ceil((MASTERY_THRESHOLD_PCT / 100) * totalQuestions);
}

function shuffledCopy<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type VocabWordState = 'LOCKED' | 'UNLOCKED' | 'MASTERED';

@Injectable()
export class VocabService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // shared: word list + this user's progress + subscription, joined and
  // state-computed
  // ---------------------------------------------------------------------
  async hasActiveSubscription(userId: string): Promise<boolean> {
    const sub = await this.prisma.vocabSubscription.findUnique({ where: { userId } });
    return !!sub && sub.expiresAt > new Date();
  }

  async getSubscriptionStatus(userId: string) {
    const sub = await this.prisma.vocabSubscription.findUnique({ where: { userId } });
    const active = !!sub && sub.expiresAt > new Date();
    return { active, expiresAt: sub?.expiresAt ?? null, amountInr: 10, periodDays: 30 };
  }

  private async loadWordsWithProgress(userId: string) {
    const [words, progressRows, subscribed] = await Promise.all([
      this.prisma.vocabWord.findMany({ where: { isActive: true }, orderBy: { orderIndex: 'asc' } }),
      this.prisma.vocabWordProgress.findMany({ where: { userId } }),
      this.hasActiveSubscription(userId),
    ]);
    const progressByWord = new Map(progressRows.map((p) => [p.wordId, p]));

    let prevMastered = true; // the very first word is always unlocked
    return words.map((w) => {
      const progress = progressByWord.get(w.id);
      const mastered = !!progress?.masteredAt;
      const state: VocabWordState = mastered
        ? 'MASTERED'
        : prevMastered || progress?.forceUnlocked || subscribed
          ? 'UNLOCKED'
          : 'LOCKED';
      prevMastered = mastered; // next word's eligibility depends on THIS word's real mastery, not on it merely being unlocked
      return { word: w, progress, state };
    });
  }

  /** Word list for the vocabulary hub — grid of locked/unlocked/mastered cards. */
  async listWords(userId: string) {
    const rows = await this.loadWordsWithProgress(userId);
    const masteredCount = rows.filter((r) => r.state === 'MASTERED').length;
    return {
      totalWords: rows.length,
      masteredCount,
      words: rows.map((r) => ({
        id: r.word.id,
        slug: r.word.slug,
        word: r.word.word,
        orderIndex: r.word.orderIndex,
        meaningHindi: r.word.meaningHindi,
        state: r.state,
        bestScorePct: r.progress?.bestScorePct ?? 0,
        attemptsCount: r.progress?.attemptsCount ?? 0,
        needsRevision: r.state === 'MASTERED' && (r.progress?.lastWrongCount ?? 0) > 0,
      })),
    };
  }

  /**
   * The word a "locked" click should point the student at: the
   * furthest-along word that is UNLOCKED but not yet MASTERED (i.e. the
   * one actually blocking progress). Falls back to the very first word if
   * — implausibly — every unlocked word is already mastered (e.g. right
   * after finishing one, before the list has refreshed).
   */
  private findActionableWord(rows: Awaited<ReturnType<VocabService['loadWordsWithProgress']>>) {
    const actionable = rows.filter((r) => r.state === 'UNLOCKED' && !r.progress?.masteredAt);
    return actionable[0] ?? rows[0];
  }

  /** Full learning content for one word — 403s if the student hasn't reached it yet. */
  async getWordDetail(userId: string, slug: string) {
    const rows = await this.loadWordsWithProgress(userId);
    const row = rows.find((r) => r.word.slug === slug);
    if (!row) throw new NotFoundException('Word not found');
    if (row.state === 'LOCKED') {
      const next = this.findActionableWord(rows);
      throw new ForbiddenException({
        message: `Pehle "${next.word.word}" seekhein aur uska quiz dein (${MASTERY_THRESHOLD_PCT}%+ score) — tabhi ye word khulega. Ya ₹10/month me sabhi words abhi unlock karein.`,
        code: 'WORD_LOCKED',
        nextActionableWordSlug: next.word.slug,
        nextActionableWord: next.word.word,
      });
    }
    const questionCount = await this.prisma.vocabQuestion.count({ where: { wordId: row.word.id } });
    return {
      id: row.word.id,
      slug: row.word.slug,
      word: row.word.word,
      orderIndex: row.word.orderIndex,
      partOfSpeech: row.word.partOfSpeech,
      pronunciation: row.word.pronunciation,
      meaningHindi: row.word.meaningHindi,
      meaningEnglish: row.word.meaningEnglish,
      memoryTrick: row.word.memoryTrick,
      etymology: row.word.etymology,
      registerNote: row.word.registerNote,
      examTrendNote: row.word.examTrendNote,
      confusingPairNote: row.word.confusingPairNote,
      examples: row.word.examplesJson ?? [],
      synonyms: row.word.synonymsJson ?? [],
      antonyms: row.word.antonymsJson ?? [],
      state: row.state,
      bestScorePct: row.progress?.bestScorePct ?? 0,
      attemptsCount: row.progress?.attemptsCount ?? 0,
      questionCount,
      masteryThresholdPct: MASTERY_THRESHOLD_PCT,
      requiredCorrectCount: requiredCorrectCount(questionCount),
    };
  }

  /** This word's quiz questions (answers hidden) — same 403 gate as getWordDetail. */
  async getQuiz(userId: string, slug: string) {
    const rows = await this.loadWordsWithProgress(userId);
    const row = rows.find((r) => r.word.slug === slug);
    if (!row) throw new NotFoundException('Word not found');
    if (row.state === 'LOCKED') {
      const next = this.findActionableWord(rows);
      throw new ForbiddenException({
        message: `Pehle "${next.word.word}" seekhein aur uska quiz dein (${MASTERY_THRESHOLD_PCT}%+ score) — tabhi ye word khulega.`,
        code: 'WORD_LOCKED',
        nextActionableWordSlug: next.word.slug,
        nextActionableWord: next.word.word,
      });
    }
    const questions = await this.prisma.vocabQuestion.findMany({ where: { wordId: row.word.id } });
    // Question order shuffled on every call (every retry), plus — NEW —
    // each question's OPTION order is now shuffled too, so neither the
    // sequence of questions nor the position of the right answer within a
    // question stays memorizable across attempts. The stored A/B/C/D `key`
    // travels WITH its text, so submitQuiz() needs no remapping — whatever
    // key the student clicks is exactly the key that was already correct
    // or wrong in the database.
    const shuffledQuestions = shuffledCopy(questions);
    return {
      wordId: row.word.id,
      word: row.word.word,
      slug: row.word.slug,
      masteryThresholdPct: MASTERY_THRESHOLD_PCT,
      requiredCorrectCount: requiredCorrectCount(questions.length),
      questions: shuffledQuestions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: shuffledCopy(Array.isArray(q.optionsJson) ? (q.optionsJson as any[]) : []),
      })),
    };
  }

  /**
   * Score a full quiz attempt in one shot (all N questions submitted
   * together, not one at a time — this is a fixed, short, self-contained
   * set, unlike the exam-prep bank's per-question /bank/attempt flow).
   * >=95% (see requiredCorrectCount()) is what flips masteredAt and — on
   * the NEXT read — unlocks the following word.
   */
  async submitQuiz(userId: string, slug: string, answers: Record<string, string>) {
    const word = await this.prisma.vocabWord.findUnique({ where: { slug } });
    if (!word) throw new NotFoundException('Word not found');

    const rows = await this.loadWordsWithProgress(userId);
    const row = rows.find((r) => r.word.id === word.id);
    if (!row || row.state === 'LOCKED') {
      throw new ForbiddenException({ message: 'Ye word abhi locked hai.', code: 'WORD_LOCKED' });
    }

    const questions = await this.prisma.vocabQuestion.findMany({ where: { wordId: word.id } });
    if (questions.length === 0) {
      throw new BadRequestException('Is word ke liye abhi koi question nahi hai.');
    }
    const needed = requiredCorrectCount(questions.length);
    let correct = 0;
    let wrong = 0;
    const review = questions.map((q) => {
      const given = String(answers?.[q.id] ?? '').trim().toUpperCase();
      const isCorrect = given === String(q.correctAnswer).trim().toUpperCase();
      if (isCorrect) correct++;
      else wrong++;
      return {
        id: q.id,
        questionText: q.questionText,
        options: Array.isArray(q.optionsJson) ? q.optionsJson : [],
        givenAnswer: given || null,
        correctAnswer: q.correctAnswer,
        isCorrect,
        explanation: q.explanation,
      };
    });
    const scorePct = Math.round((correct / questions.length) * 100);
    const justMastered = correct >= needed;

    const existing = await this.prisma.vocabWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId: word.id } },
    });
    const alreadyMastered = !!existing?.masteredAt;

    await this.prisma.vocabWordProgress.upsert({
      where: { userId_wordId: { userId, wordId: word.id } },
      create: {
        userId,
        wordId: word.id,
        bestScorePct: scorePct,
        attemptsCount: 1,
        lastWrongCount: wrong,
        masteredAt: justMastered ? new Date() : null,
      },
      update: {
        bestScorePct: Math.max(existing?.bestScorePct ?? 0, scorePct),
        attemptsCount: { increment: 1 },
        lastWrongCount: wrong,
        // masteredAt is a one-way door — a later lower-scoring revision
        // attempt must never un-master a word the student already earned.
        masteredAt: alreadyMastered ? existing!.masteredAt : justMastered ? new Date() : null,
      },
    });

    return {
      scorePct,
      correct,
      wrong,
      total: questions.length,
      masteryThresholdPct: MASTERY_THRESHOLD_PCT,
      requiredCorrectCount: needed,
      justMastered: justMastered && !alreadyMastered,
      alreadyMastered,
      review,
    };
  }

  // ---------------------------------------------------------------------
  // daily goal + today's plan
  // ---------------------------------------------------------------------
  async getDailyGoal(userId: string) {
    const goal = await this.prisma.vocabDailyGoal.findUnique({ where: { userId } });
    return { wordsPerDay: goal?.wordsPerDay ?? 1 };
  }

  async setDailyGoal(userId: string, wordsPerDay: number) {
    const clamped = Math.min(10, Math.max(1, Math.round(wordsPerDay) || 1));
    await this.prisma.vocabDailyGoal.upsert({
      where: { userId },
      create: { userId, wordsPerDay: clamped },
      update: { wordsPerDay: clamped },
    });
    return { wordsPerDay: clamped };
  }

  /**
   * "aaj kya kya padhna hai" — the vocabulary dashboard card / today's-plan
   * widget. Because unlock is strictly sequential (unless subscribed),
   * there is really only ever ONE genuinely-next new word for a
   * non-subscriber; `wordsPerDay` mainly sizes how many upcoming
   * (still-locked) words to preview as "coming up", plus drives the daily
   * target shown at the top. Revision words (mastered but with a wrong
   * answer on the last attempt) are always included in full, regardless of
   * the daily goal number.
   */
  async todaysPlan(userId: string) {
    const [rows, goal] = await Promise.all([this.loadWordsWithProgress(userId), this.getDailyGoal(userId)]);

    const nextNew = rows.filter((r) => r.state === 'UNLOCKED' && !r.progress?.masteredAt).slice(0, goal.wordsPerDay);
    const upcoming = rows.filter((r) => r.state === 'LOCKED').slice(0, Math.max(0, goal.wordsPerDay - nextNew.length));
    const revision = rows.filter((r) => r.state === 'MASTERED' && (r.progress?.lastWrongCount ?? 0) > 0);
    const masteredToday = rows.filter(
      (r) => r.progress?.masteredAt && istDateKey(r.progress.masteredAt) === istDateKey(new Date()),
    ).length;

    const toCard = (r: (typeof rows)[number]) => ({
      slug: r.word.slug,
      word: r.word.word,
      meaningHindi: r.word.meaningHindi,
      state: r.state,
      bestScorePct: r.progress?.bestScorePct ?? 0,
    });

    return {
      wordsPerDay: goal.wordsPerDay,
      masteredToday,
      newWordsToday: nextNew.map(toCard),
      comingUp: upcoming.map(toCard),
      revisionToday: revision.map(toCard),
      totalMastered: rows.filter((r) => r.state === 'MASTERED').length,
      totalWords: rows.length,
    };
  }

  // ---------------------------------------------------------------------
  // ₹10 one-off per-word force-unlock (legacy — kept working, but the
  // frontend now promotes the ₹10/month subscription instead; see
  // MonetizationService's 'VOCAB_WORD' vs 'VOCAB_SUBSCRIPTION' order kinds)
  // ---------------------------------------------------------------------
  async forceUnlock(userId: string, wordId: string) {
    await this.prisma.vocabWordProgress.upsert({
      where: { userId_wordId: { userId, wordId } },
      create: { userId, wordId, forceUnlocked: true },
      update: { forceUnlocked: true },
    });
  }

  async getWordById(wordId: string) {
    const word = await this.prisma.vocabWord.findUnique({ where: { id: wordId } });
    if (!word) throw new NotFoundException('Word not found');
    return word;
  }
}
