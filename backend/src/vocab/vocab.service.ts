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
//
// REVISED (Oct 28 2026) — "word kabhi unlock ho jata hai, fir se lock ho jata hai":
//  * An unlock is now PERMANENT. The moment a word becomes reachable (or the student works on it) it is pinned in
//    vocab_word_progress.unlockedAt and never goes back to LOCKED, whatever happens to the word list, to the
//    student's later revision results or to a lapsed Rs 10/month pass.
//  * A failed daily-revision answer or a pending revision no longer flips words back to LOCKED. They are a
//    separate, temporary HOLD on starting NEW words (state stays UNLOCKED, `gate` says why) — the UI shows an
//    "on hold" badge with a one-tap fix instead of a padlock that appears and disappears.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../gamification/gamification.service';
import { computeRevisionState } from './vocab-revision.util';
import {
  REVISION_MAX_WORDS,
  REVISION_QUESTIONS_PER_WORD,
  VOCAB_MSG,
  VOCAB_WORD_UNLOCK_PRICE_INR,
  quizTimeLimitSec,
} from './vocab-messages';

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
/** Why an UNLOCKED, not-yet-mastered word cannot be started right now (temporary, never a lock). */
export type VocabGate = 'REVISION_PENDING' | 'REMASTER_REQUIRED' | null;

@Injectable()
export class VocabService {
  private readonly logger = new Logger(VocabService.name);

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

  /**
   * Persist "this word is open for this student" so it can never fall back to LOCKED. Safe to call repeatedly and
   * concurrently (createMany skips existing rows, updateMany only touches rows that still have no pin).
   * A failure here must never break reading the word list, so it is logged and swallowed.
   */
  private async pinUnlocked(userId: string, wordIds: string[]) {
    if (!wordIds.length) return;
    const now = new Date();
    try {
      await this.prisma.vocabWordProgress.createMany({
        data: wordIds.map((wordId) => ({ userId, wordId, unlockedAt: now })),
        skipDuplicates: true,
      });
      await this.prisma.vocabWordProgress.updateMany({
        where: { userId, wordId: { in: wordIds }, unlockedAt: null },
        data: { unlockedAt: now },
      });
    } catch (e) {
      this.logger.warn(`could not pin unlocked words for ${userId}: ${(e as Error)?.message}`);
    }
  }

  private async loadWordsWithProgress(userId: string) {
    // Oct 2026 — "ek baar unlock hua word dobara lock nahi hona chahiye".
    // Unlock state is a FRONTIER plus a permanent pin:
    //  * frontier = the furthest word the student has MASTERED (a later revision mistake never moves it back);
    //    everything up to one word past it is reachable;
    //  * every reachable word is pinned (unlockedAt) the first time it is seen, and a word the student has
    //    already attempted, bought (forceUnlocked) or mastered is open for good;
    //  * an active Rs 100 "unlock all" / legacy monthly pass opens every word while it lasts.
    // Inactive (soft-deleted) words still count for the frontier, so removing a word from the list can never push
    // a student backwards; and because reachable words are pinned, inserting / re-ordering words cannot re-lock one
    // the student has already been shown as open.
    const [allWords, progressRows, subscribedMonthly, userState] = await Promise.all([
      this.prisma.vocabWord.findMany({ orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.vocabWordProgress.findMany({ where: { userId } }),
      this.hasActiveSubscription(userId),
      this.prisma.vocabUserState.findUnique({ where: { userId } }),
    ]);
    const subscribed = subscribedMonthly || !!userState?.allUnlockedAt;
    const progressByWord = new Map(progressRows.map((p) => [p.wordId, p]));

    let frontier = -1; // index (in allWords) of the furthest mastered word
    allWords.forEach((w, i) => {
      if (progressByWord.get(w.id)?.masteredAt) frontier = i;
    });

    // First ACTIVE word after the frontier = the one the student may start next. (Counting positions in the full
    // list would lock everything whenever an inactive word happens to sit right after the frontier / at the start.)
    let nextOpenIndex = Number.POSITIVE_INFINITY;
    for (let i = frontier + 1; i < allWords.length; i++) {
      if (allWords[i].isActive) {
        nextOpenIndex = i;
        break;
      }
    }

    const toPin: string[] = [];
    const out: { word: (typeof allWords)[number]; progress: (typeof progressRows)[number] | undefined; state: VocabWordState }[] = [];
    allWords.forEach((w, i) => {
      if (!w.isActive) return;
      const progress = progressByWord.get(w.id);
      const mastered = !!progress?.masteredAt;
      const reachable = i <= nextOpenIndex;
      const pinned = !!progress?.unlockedAt || !!progress?.forceUnlocked || (progress?.attemptsCount ?? 0) > 0;
      let state: VocabWordState;
      if (mastered) state = 'MASTERED';
      else if (pinned) state = 'UNLOCKED';
      else if (reachable) {
        state = 'UNLOCKED';
        toPin.push(w.id); // first time this word is open for the student -> make it permanent
      } else if (subscribed) state = 'UNLOCKED';
      else state = 'LOCKED';
      out.push({ word: w, progress, state });
    });
    if (toPin.length) await this.pinUnlocked(userId, toPin);
    return out;
  }

  /**
   * Words that were mastered but then failed a daily-revision question: the student must re-score 95% on each
   * before starting NEW words. (Paying "unlock all" / holding a word via force-unlock skips this hold, exactly as
   * before — it never applied to them.)
   */
  private async pendingRemaster(userId: string) {
    const rows = await this.prisma.vocabWordProgress.findMany({
      where: { userId, remasterRequired: true, masteredAt: { not: null }, word: { isActive: true } },
      select: { word: { select: { slug: true, word: true, orderIndex: true } } },
    });
    return rows.map((r) => r.word).sort((a, b) => a.orderIndex - b.orderIndex);
  }

  /** Word list for the vocabulary hub — grid of locked/unlocked/mastered cards. */
  async listWords(userId: string) {
    const rows = await this.loadWordsWithProgress(userId);
    const masteredCount = rows.filter((r) => r.state === 'MASTERED').length;
    const gate = await this.currentGate(userId);
    return {
      totalWords: rows.length,
      masteredCount,
      // Temporary hold on starting NEW words (never a lock): the hub shows a banner + an "on hold" badge.
      gate: gate.code,
      remaster: gate.remaster,
      words: rows.map((r) => ({
        id: r.word.id,
        slug: r.word.slug,
        word: r.word.word,
        orderIndex: r.word.orderIndex,
        meaningHindi: r.word.meaningHindi,
        state: r.state,
        // only an open, not-yet-mastered word can be on hold
        gated: r.state === 'UNLOCKED' && gate.code !== null && !this.bypassesRemaster(r.progress, gate),
        bestScorePct: r.progress?.bestScorePct ?? 0,
        attemptsCount: r.progress?.attemptsCount ?? 0,
        needsRevision: r.state === 'MASTERED' && (r.progress?.lastWrongCount ?? 0) > 0,
        needsRemaster: !!r.progress?.remasterRequired,
      })),
    };
  }

  /** Is the student currently blocked from starting new words, and why? */
  private async currentGate(userId: string): Promise<{ code: VocabGate; remaster: { slug: string; word: string }[]; paid: boolean }> {
    const [rev, userState, sub, remaster] = await Promise.all([
      computeRevisionState(this.prisma, userId),
      this.prisma.vocabUserState.findUnique({ where: { userId } }),
      this.hasActiveSubscription(userId),
      this.pendingRemaster(userId),
    ]);
    const paid = !!userState?.allUnlockedAt || sub;
    const remasterList = remaster.map((w) => ({ slug: w.slug, word: w.word }));
    // Revision-due applies to everyone (same as before); the re-master hold never applied to paying students.
    const code: VocabGate = rev.due ? 'REVISION_PENDING' : remasterList.length && !paid ? 'REMASTER_REQUIRED' : null;
    return { code, remaster: remasterList, paid };
  }

  /** A paid word (force-unlock) or a paid pass skips the re-master hold, but never the daily revision. */
  private bypassesRemaster(progress: { forceUnlocked?: boolean } | undefined, gate: { code: VocabGate; paid: boolean }) {
    return gate.code === 'REMASTER_REQUIRED' && (gate.paid || !!progress?.forceUnlocked);
  }

  /**
   * NEW (daily revision gate): brand-new words (anything not yet MASTERED)
   * are blocked while today's revision is pending. Already-mastered words —
   * including ones that must be re-mastered after a revision mistake — are
   * never gated, otherwise the student could not fix what blocks them.
   */
  private async assertRevisionClear(userId: string, state: VocabWordState) {
    if (state === 'MASTERED') return;
    const st = await computeRevisionState(this.prisma, userId);
    if (!st.due) return;
    const words = Math.min(st.poolWordIds.length, REVISION_MAX_WORDS);
    const questions = words * REVISION_QUESTIONS_PER_WORD;
    const msg = VOCAB_MSG.revisionPending(words, questions, Math.ceil(quizTimeLimitSec(questions) / 60), st.skipFeeInr);
    throw new ForbiddenException({
      message: msg.en,
      code: 'REVISION_PENDING',
      messages: msg,
      poolSize: st.poolWordIds.length,
      skipFeeInr: st.skipFeeInr,
    });
  }

  /**
   * NEW (Oct 28 2026): the re-master hold. A word the student mastered but then missed in a daily revision must be
   * re-scored at 95% before NEW words can be started. This used to be implemented by flipping later words back to
   * LOCKED (the "unlock then lock again" bug); it is now an explicit, explained 403 that never changes a word's state.
   */
  private async assertRemasterClear(userId: string, state: VocabWordState, progress: { forceUnlocked?: boolean } | undefined) {
    if (state === 'MASTERED') return;
    const gate = await this.currentGate(userId);
    if (gate.code !== 'REMASTER_REQUIRED' || this.bypassesRemaster(progress, gate)) return;
    const msg = VOCAB_MSG.remasterRequired(gate.remaster.map((w) => w.word));
    throw new ForbiddenException({
      message: msg.en,
      code: 'REMASTER_REQUIRED',
      messages: msg,
      remaster: gate.remaster,
    });
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
      const msg = VOCAB_MSG.wordLocked(next.word.word);
      throw new ForbiddenException({
        message: msg.en,
        code: 'WORD_LOCKED',
        messages: msg,
        unlockPriceInr: VOCAB_WORD_UNLOCK_PRICE_INR,
        wordId: row.word.id,
        nextActionableWordSlug: next.word.slug,
        nextActionableWord: next.word.word,
      });
    }
    await this.assertRevisionClear(userId, row.state);
    await this.assertRemasterClear(userId, row.state, row.progress);
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
      needsRemaster: !!row.progress?.remasterRequired,
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
      const msg = VOCAB_MSG.wordLocked(next.word.word);
      throw new ForbiddenException({
        message: msg.en,
        code: 'WORD_LOCKED',
        messages: msg,
        unlockPriceInr: VOCAB_WORD_UNLOCK_PRICE_INR,
        wordId: row.word.id,
        nextActionableWordSlug: next.word.slug,
        nextActionableWord: next.word.word,
      });
    }
    await this.assertRevisionClear(userId, row.state);
    await this.assertRemasterClear(userId, row.state, row.progress);
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
      // NEW: the practice quiz is timed too (Sachin: "practice test ke
      // dauran bhi timer run ho"). The client shows a countdown and
      // auto-submits at 0; the number is advisory, scoring is unchanged.
      timeLimitSec: quizTimeLimitSec(questions.length),
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
      const msg = VOCAB_MSG.wordLocked((row ? this.findActionableWord(rows) : rows[0])?.word.word ?? '');
      throw new ForbiddenException({ message: msg.en, code: 'WORD_LOCKED', messages: msg, unlockPriceInr: VOCAB_WORD_UNLOCK_PRICE_INR });
    }
    await this.assertRevisionClear(userId, row.state);
    await this.assertRemasterClear(userId, row.state, row.progress);

    const questions = await this.prisma.vocabQuestion.findMany({ where: { wordId: word.id } });
    if (questions.length === 0) {
      throw new BadRequestException('There are no questions for this word yet.');
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
        explanationHindi: q.explanationHindi,
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
        // NEW: a >=95% pass clears a "re-master after revision mistake" flag.
        ...(justMastered ? { remasterRequired: false, lastRevisedAt: new Date() } : {}),
        // masteredAt is a one-way door — a later lower-scoring revision
        // attempt must never un-master a word the student already earned.
        masteredAt: alreadyMastered ? existing!.masteredAt : justMastered ? new Date() : null,
      },
    });

    // Mastering a word opens the next active one — pin it right away so it stays open whatever the admin does to
    // the word list afterwards.
    if (justMastered && !alreadyMastered) {
      const at = rows.findIndex((r) => r.word.id === word.id);
      const next = at >= 0 ? rows[at + 1] : undefined;
      if (next && !next.progress?.unlockedAt && !next.progress?.masteredAt) await this.pinUnlocked(userId, [next.word.id]);
    }

    return {
      scorePct,
      correct,
      wrong,
      total: questions.length,
      masteryThresholdPct: MASTERY_THRESHOLD_PCT,
      requiredCorrectCount: needed,
      justMastered: justMastered && !alreadyMastered,
      alreadyMastered,
      remasterCleared: justMastered && !!existing?.remasterRequired,
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
