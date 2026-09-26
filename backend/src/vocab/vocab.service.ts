// Vocabulary Mastery (NEW — Sep 2026)
//
// "ek ek word ka pura revision/understand, uske baad usi word ka quiz —
// jab 95% sahi kare tab hi complete mark lage, jab tak agla word test nahi
// khulega jab tak pehla complete na ho": a strictly sequential word-by-word
// mastery track, parallel to (and independent of) the regular
// Subject/Chapter/Topic/Question exam-prep bank.
//
// Unlock state is never stored as a column — see VocabWordProgress in
// schema.prisma for why — it is derived here, once, from three facts:
// masteredAt (is this word actually done), forceUnlocked (did they pay ₹10
// to skip ahead), and orderIndex (is this the very first word, or does the
// previous word's masteredAt say it's done). Computing it in one place
// keeps the LOCKED/UNLOCKED/MASTERED rule impossible to drift out of sync
// with itself the way a separately-written "status" column could.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../gamification/gamification.service';

const MASTERY_THRESHOLD_PCT = 95;

export type VocabWordState = 'LOCKED' | 'UNLOCKED' | 'MASTERED';

@Injectable()
export class VocabService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // shared: word list + this user's progress, joined and state-computed
  // ---------------------------------------------------------------------
  private async loadWordsWithProgress(userId: string) {
    const [words, progressRows] = await Promise.all([
      this.prisma.vocabWord.findMany({ where: { isActive: true }, orderBy: { orderIndex: 'asc' } }),
      this.prisma.vocabWordProgress.findMany({ where: { userId } }),
    ]);
    const progressByWord = new Map(progressRows.map((p) => [p.wordId, p]));

    let prevMastered = true; // the very first word is always unlocked
    return words.map((w) => {
      const progress = progressByWord.get(w.id);
      const mastered = !!progress?.masteredAt;
      const state: VocabWordState = mastered
        ? 'MASTERED'
        : prevMastered || progress?.forceUnlocked
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

  /** Full learning content for one word — 403s if the student hasn't reached it yet. */
  async getWordDetail(userId: string, slug: string) {
    const rows = await this.loadWordsWithProgress(userId);
    const row = rows.find((r) => r.word.slug === slug);
    if (!row) throw new NotFoundException('Word not found');
    if (row.state === 'LOCKED') {
      const prevIndex = row.word.orderIndex - 1;
      throw new ForbiddenException({
        message: 'Pehle pichla word master karein (95%+ quiz score), tabhi ye word khulega.',
        code: 'WORD_LOCKED',
        requiresWordAtOrderIndex: prevIndex,
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
    };
  }

  /** This word's quiz questions (answers hidden) — same 403 gate as getWordDetail. */
  async getQuiz(userId: string, slug: string) {
    const rows = await this.loadWordsWithProgress(userId);
    const row = rows.find((r) => r.word.slug === slug);
    if (!row) throw new NotFoundException('Word not found');
    if (row.state === 'LOCKED') {
      throw new ForbiddenException({ message: 'Ye word abhi locked hai.', code: 'WORD_LOCKED' });
    }
    const questions = await this.prisma.vocabQuestion.findMany({ where: { wordId: row.word.id } });
    // Fisher-Yates — same shuffle used everywhere else in the app, so a
    // retry doesn't hand back the exact same visual order every time.
    const shuffled = [...questions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return {
      wordId: row.word.id,
      word: row.word.word,
      slug: row.word.slug,
      masteryThresholdPct: MASTERY_THRESHOLD_PCT,
      questions: shuffled.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: Array.isArray(q.optionsJson) ? q.optionsJson : [],
      })),
    };
  }

  /**
   * Score a full quiz attempt in one shot (all N questions submitted
   * together, not one at a time — this is a fixed, short, self-contained
   * set, unlike the exam-prep bank's per-question /bank/attempt flow).
   * >=95% is what flips masteredAt and — on the NEXT read — unlocks the
   * following word.
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
    let correct = 0;
    let wrong = 0;
    const review = questions.map((q) => {
      const given = String(answers?.[q.id] ?? '').trim().toUpperCase();
      const isCorrect = given === String(q.correctAnswer).trim().toUpperCase();
      if (!given) {
        /* skipped — counts as wrong for mastery purposes, no separate bucket */
      }
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
    const justMastered = scorePct >= MASTERY_THRESHOLD_PCT;

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
   * widget. Because unlock is strictly sequential, there is really only
   * ever ONE genuinely-next new word; `wordsPerDay` mainly sizes how many
   * upcoming (still-locked) words to preview as "coming up", plus drives
   * the daily target shown at the top. Revision words (mastered but with a
   * wrong answer on the last attempt) are always included in full,
   * regardless of the daily goal number.
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
  // ₹10 force-unlock (called by MonetizationService after payment succeeds)
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
