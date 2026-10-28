/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ATTEMPT_DONE } from '../common/attempt-status';
import { TestsService } from './tests.service';

/** Attempts changed by ONE apply call; the admin presses the button again for the rest (the answer says how many are left). */
export const RESCORE_BATCH = 200;
/** Answer rows looked at per call (a question is rarely answered by more people than this in a finished attempt). */
const SCAN_MAX = 20_000;

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();

/**
 * Answer key corrected after students finished (session 29, G3; Sachin's decision: admin re-score).
 * The admin edits the question as before; nothing is re-scored by itself. Then this service shows how many finished attempts used the old key
 * (preview) and, on a click, re-scores them one by one with TestsService.rescoreAttempt (audit log, first score kept, note on the result).
 */
@Injectable()
export class AttemptRescoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestsService,
  ) {}

  /** Finished attempts whose stored verdict for this question disagrees with the question's CURRENT key. */
  private async affected(questionId: string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionNo: true, correctAnswer: true } });
    if (!q) throw new NotFoundException('Question not found');
    const rows: { id: string; testAttemptId: string; selectedOption: string | null; isCorrect: boolean }[] = await this.prisma.attemptAnswer.findMany({
      where: { questionId, selectedOption: { not: null }, testAttempt: { status: ATTEMPT_DONE } },
      select: { id: true, testAttemptId: true, selectedOption: true, isCorrect: true },
      take: SCAN_MAX,
    });
    const key = norm(q.correctAnswer);
    const wrongNow = rows.filter((r) => (norm(r.selectedOption) === key) !== r.isCorrect);
    return {
      question: q,
      attemptIds: Array.from(new Set(wrongNow.map((r) => r.testAttemptId))),
      becomeCorrect: wrongNow.filter((r) => norm(r.selectedOption) === key).length,
      becomeWrong: wrongNow.filter((r) => norm(r.selectedOption) !== key).length,
    };
  }

  /** Nothing is changed. */
  async preview(questionId: string) {
    const a = await this.affected(questionId);
    return { questionId, questionNo: a.question.questionNo, currentKey: a.question.correctAnswer, attempts: a.attemptIds.length, becomeCorrect: a.becomeCorrect, becomeWrong: a.becomeWrong };
  }

  async apply(questionId: string, adminId: string) {
    if (!adminId) throw new BadRequestException('Admin required');
    const a = await this.affected(questionId);
    const todo = a.attemptIds.slice(0, RESCORE_BATCH);
    let changed = 0;
    let unchanged = 0;
    let failed = 0;
    for (const id of todo) {
      try {
        const r = await this.tests.rescoreAttempt(id, adminId, { onlyQuestionId: questionId });
        if (r.changed) changed++;
        else unchanged++;
      } catch {
        failed++;
      }
    }
    await this.prisma.auditLog
      .create({ data: { userId: adminId, action: 'ATTEMPTS_RESCORED', targetEntity: 'Question', entityId: questionId, metadataJson: { questionNo: a.question.questionNo, key: a.question.correctAnswer, changed, unchanged, failed, remaining: Math.max(0, a.attemptIds.length - todo.length) } as any } })
      .catch(() => undefined);
    return { questionId, questionNo: a.question.questionNo, changed, unchanged, failed, remaining: Math.max(0, a.attemptIds.length - todo.length) };
  }
}
