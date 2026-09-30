/* eslint-disable @typescript-eslint/no-explicit-any */
// Vocabulary Daily Revision (Sep 29 2026).
//
// Spec (Sachin): a student who has unlocked N words must revise them every
// day — 2 questions per word (50 words -> 100 questions), time-bound. A word
// answered wrong must be re-scored at 95%+ before new words unlock again.
// A student may skip the day for an escalating fee (Rs 1, 5, 10 ...) — the
// test is simply due again the next day. Payment itself goes through the
// existing Cashfree order flow (MonetizationService, kind VOCAB_REVISION_SKIP);
// this service only reads the resulting SKIPPED session.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeRevisionState } from './vocab-revision.util';
import {
  REVISION_MAX_WORDS,
  REVISION_QUESTIONS_PER_WORD,
  REVISION_SUBMIT_GRACE_SEC,
  VOCAB_MSG,
  VOCAB_UNLOCK_ALL_PRICE_INR,
  VOCAB_WORD_UNLOCK_PRICE_INR,
  SKIP_FEE_LADDER_INR,
  quizTimeLimitSec,
} from './vocab-messages';

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

@Injectable()
export class VocabRevisionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Static price list + warnings the payment dialogs show (both languages). */
  pricing() {
    return {
      wordUnlock: { priceInr: VOCAB_WORD_UNLOCK_PRICE_INR, message: VOCAB_MSG.unlockWordWarning },
      unlockAll: { priceInr: VOCAB_UNLOCK_ALL_PRICE_INR, message: VOCAB_MSG.unlockAllWarning },
      skipFeeLadderInr: SKIP_FEE_LADDER_INR,
    };
  }

  /** GET /vocab/revision/status — drives the banner on the vocabulary hub. */
  async status(userId: string) {
    const st = await computeRevisionState(this.prisma, userId);
    const wordsInTest = Math.min(st.poolWordIds.length, REVISION_MAX_WORDS);
    const questionsInTest = wordsInTest * REVISION_QUESTIONS_PER_WORD;
    const timeLimitSec = quizTimeLimitSec(questionsInTest);

    let remaster: { slug: string; word: string }[] = [];
    if (st.remasterWordIds.length) {
      const words = await this.prisma.vocabWord.findMany({
        where: { id: { in: st.remasterWordIds } },
        select: { slug: true, word: true },
        orderBy: { orderIndex: 'asc' },
      });
      remaster = words;
    }

    return {
      due: st.due,
      doneToday: st.doneToday,
      poolSize: st.poolWordIds.length,
      wordsInTest,
      questionsInTest,
      timeLimitSec,
      inProgressSessionId: st.inProgressSessionId,
      skipFeeInr: st.skipFeeInr,
      nextSkipFeeInr: st.nextSkipFeeInr,
      skipStreak: st.skipStreak,
      remaster,
      messages: {
        pending: st.due
          ? VOCAB_MSG.revisionPending(wordsInTest, questionsInTest, Math.ceil(timeLimitSec / 60), st.skipFeeInr)
          : null,
        skipWarning: VOCAB_MSG.skipWarning(st.skipFeeInr, st.nextSkipFeeInr),
        remaster: remaster.length ? VOCAB_MSG.remasterRequired(remaster.map((r) => r.word)) : null,
        nothingToRevise: st.poolWordIds.length === 0 ? VOCAB_MSG.nothingToRevise : null,
        alreadyDone: st.doneToday ? VOCAB_MSG.revisionAlreadyDone : null,
      },
    };
  }

  private async loadSessionQuestions(questionIds: string[]) {
    const rows = await this.prisma.vocabQuestion.findMany({ where: { id: { in: questionIds } } });
    const map = new Map(rows.map((r) => [r.id, r]));
    return questionIds
      .map((id) => map.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map((q) => ({
        id: q.id,
        questionText: q.questionText,
        // Option order reshuffled on every load, same as the per-word quiz —
        // the stored A/B/C/D key stays glued to its text so scoring needs no remap.
        options: shuffled(Array.isArray(q.optionsJson) ? (q.optionsJson as any[]) : []),
      }));
  }

  /** POST /vocab/revision/start — compose (or resume) today's timed test. */
  async start(userId: string) {
    const st = await computeRevisionState(this.prisma, userId);
    if (st.doneToday) {
      throw new BadRequestException({ message: VOCAB_MSG.revisionAlreadyDone.en, code: 'REVISION_DONE', messages: VOCAB_MSG.revisionAlreadyDone });
    }
    if (st.poolWordIds.length === 0) {
      throw new BadRequestException({ message: VOCAB_MSG.nothingToRevise.en, code: 'NOTHING_TO_REVISE', messages: VOCAB_MSG.nothingToRevise });
    }

    // Retire sessions whose clock already ran out so they never block a retry.
    await this.prisma.vocabRevisionSession.updateMany({
      where: { userId, status: 'IN_PROGRESS', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });

    if (st.inProgressSessionId) {
      const s = await this.prisma.vocabRevisionSession.findUnique({ where: { id: st.inProgressSessionId } });
      if (s && s.status === 'IN_PROGRESS' && s.expiresAt > new Date()) {
        return {
          sessionId: s.id,
          resumed: true,
          expiresAt: s.expiresAt,
          timeLimitSec: Math.max(1, Math.round((s.expiresAt.getTime() - Date.now()) / 1000)),
          totalQuestions: s.totalQuestions,
          questions: await this.loadSessionQuestions((s.questionIds as string[]) ?? []),
        };
      }
    }

    const wordIds = st.poolWordIds.slice(0, REVISION_MAX_WORDS);
    const all = await this.prisma.vocabQuestion.findMany({ where: { wordId: { in: wordIds } }, select: { id: true, wordId: true } });
    const byWord = new Map<string, string[]>();
    for (const q of all) {
      if (!byWord.has(q.wordId)) byWord.set(q.wordId, []);
      byWord.get(q.wordId)!.push(q.id);
    }
    const picked: string[] = [];
    const usedWordIds: string[] = [];
    for (const wid of wordIds) {
      const qs = byWord.get(wid);
      if (!qs?.length) continue;
      usedWordIds.push(wid);
      picked.push(...shuffled(qs).slice(0, REVISION_QUESTIONS_PER_WORD));
    }
    if (picked.length === 0) {
      throw new BadRequestException({ message: VOCAB_MSG.nothingToRevise.en, code: 'NOTHING_TO_REVISE', messages: VOCAB_MSG.nothingToRevise });
    }
    const order = shuffled(picked);
    const timeLimitSec = quizTimeLimitSec(order.length);
    const expiresAt = new Date(Date.now() + timeLimitSec * 1000);

    const session = await this.prisma.vocabRevisionSession.create({
      data: {
        userId,
        dateKey: st.dateKey,
        status: 'IN_PROGRESS',
        wordIds: usedWordIds,
        questionIds: order,
        totalQuestions: order.length,
        timeLimitSec,
        expiresAt,
      },
    });

    return {
      sessionId: session.id,
      resumed: false,
      expiresAt,
      timeLimitSec,
      totalQuestions: order.length,
      questions: await this.loadSessionQuestions(order),
    };
  }

  /** POST /vocab/revision/:sessionId/submit — score, flag wrong words. */
  async submit(userId: string, sessionId: string, answers: Record<string, string>) {
    const session = await this.prisma.vocabRevisionSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Revision session not found');
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException({
        message: 'This revision was already submitted or has expired.',
        code: 'REVISION_CLOSED',
        messages: session.status === 'EXPIRED' ? VOCAB_MSG.revisionExpired : VOCAB_MSG.revisionAlreadyDone,
      });
    }
    const now = new Date();
    if (now.getTime() > session.expiresAt.getTime() + REVISION_SUBMIT_GRACE_SEC * 1000) {
      await this.prisma.vocabRevisionSession.updateMany({ where: { id: session.id, status: 'IN_PROGRESS' }, data: { status: 'EXPIRED', completedAt: now } });
      throw new BadRequestException({ message: VOCAB_MSG.revisionExpired.en, code: 'REVISION_EXPIRED', messages: VOCAB_MSG.revisionExpired });
    }

    const questionIds = (session.questionIds as string[]) ?? [];
    const questions = await this.prisma.vocabQuestion.findMany({ where: { id: { in: questionIds } } });
    const qmap = new Map(questions.map((q) => [q.id, q]));

    let correct = 0;
    const wrongWordSet = new Set<string>();
    const review = questionIds
      .map((id) => qmap.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map((q) => {
        const given = String(answers?.[q.id] ?? '').trim().toUpperCase();
        const isCorrect = given !== '' && given === String(q.correctAnswer).trim().toUpperCase();
        if (isCorrect) correct++;
        else wrongWordSet.add(q.wordId); // unanswered counts as wrong
        return {
          id: q.id,
          wordId: q.wordId,
          questionText: q.questionText,
          options: Array.isArray(q.optionsJson) ? q.optionsJson : [],
          givenAnswer: given || null,
          correctAnswer: q.correctAnswer,
          isCorrect,
          explanation: q.explanation,
        };
      });
    const total = review.length || 1;
    const scorePct = Math.round((correct / total) * 100);
    const wrongWordIds = [...wrongWordSet];
    const wordIds = (session.wordIds as string[]) ?? [];

    // Claim the session atomically so a double-tap on Submit cannot score twice.
    const claim = await this.prisma.vocabRevisionSession.updateMany({
      where: { id: session.id, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', correctCount: correct, scorePct, wrongWordIds, completedAt: now },
    });
    if (claim.count === 0) {
      throw new BadRequestException({ message: VOCAB_MSG.revisionAlreadyDone.en, code: 'REVISION_CLOSED', messages: VOCAB_MSG.revisionAlreadyDone });
    }

    if (wordIds.length) {
      await this.prisma.vocabWordProgress.updateMany({ where: { userId, wordId: { in: wordIds } }, data: { lastRevisedAt: now } });
    }
    if (wrongWordIds.length) {
      await this.prisma.vocabWordProgress.updateMany({ where: { userId, wordId: { in: wrongWordIds } }, data: { remasterRequired: true } });
    }
    // Finishing a revision resets the escalating skip fee back to the first rung.
    await this.prisma.vocabUserState.upsert({
      where: { userId },
      create: { userId, skipStreak: 0 },
      update: { skipStreak: 0 },
    });

    const wrongWords = wrongWordIds.length
      ? await this.prisma.vocabWord.findMany({ where: { id: { in: wrongWordIds } }, select: { slug: true, word: true }, orderBy: { orderIndex: 'asc' } })
      : [];

    return {
      status: 'COMPLETED',
      scorePct,
      correct,
      wrong: review.length - correct,
      total: review.length,
      wrongWords,
      allClear: wrongWords.length === 0,
      messages: {
        summary: wrongWords.length ? VOCAB_MSG.remasterRequired(wrongWords.map((w) => w.word)) : VOCAB_MSG.revisionAllClear,
      },
      review,
    };
  }
}
