/* eslint-disable @typescript-eslint/no-explicit-any */
// "Ek baar unlock hua word hamesha unlock rahe" (Oct 2026).
//
// Normal admin "delete" is already SOFT (word hidden, progress kept, re-upload re-activates it). This module
// covers the remaining case: a HARD delete (or any removal that wipes the vocab_words row). Before the row
// goes, every student's standing on that word is copied into vocab_progress_archive, keyed by the WORD TEXT
// (not the id, which changes on re-upload). When a word with the same text is uploaded again, those rows are
// restored: students who had it unlocked / mastered get it back unlocked / mastered, scores intact.
import { PrismaService } from '../prisma/prisma.service';

/** case/space/punctuation-insensitive identity of a word, stable across re-uploads. */
export function vocabWordKey(word: string): string {
  return String(word ?? '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
}

const CHUNK = 1000;

/** Call BEFORE hard-deleting a word. Returns how many students' unlock state was kept. */
export async function archiveWordProgress(prisma: PrismaService, wordId: string): Promise<number> {
  const word = await prisma.vocabWord.findUnique({ where: { id: wordId } });
  if (!word) return 0;
  const wordKey = vocabWordKey(word.word);
  if (!wordKey) return 0;

  const rows = await prisma.vocabWordProgress.findMany({ where: { wordId } });
  const byUser = new Map<string, any>();
  for (const r of rows) {
    byUser.set(r.userId, {
      userId: r.userId, wordKey,
      bestScorePct: r.bestScorePct, attemptsCount: r.attemptsCount, lastWrongCount: r.lastWrongCount,
      masteredAt: r.masteredAt, forceUnlocked: true, remasterRequired: r.remasterRequired,
    });
  }
  // Students for whom this word is unlocked only because of how far they have progressed (no row of their own):
  // everyone who has cleanly mastered the word just before it, or anything later.
  const prev = await prisma.vocabWord.findFirst({
    where: { isActive: true, orderIndex: { lt: word.orderIndex } },
    orderBy: { orderIndex: 'desc' },
  });
  const reach = await prisma.vocabWordProgress.findMany({
    where: prev
      ? { masteredAt: { not: null }, remasterRequired: false, word: { orderIndex: { gte: prev.orderIndex } } }
      : {}, // first word: unlocked for every student who has started
    select: { userId: true },
    distinct: ['userId'],
  });
  for (const u of reach) {
    if (!byUser.has(u.userId)) {
      byUser.set(u.userId, {
        userId: u.userId, wordKey, bestScorePct: 0, attemptsCount: 0, lastWrongCount: 0,
        masteredAt: null, forceUnlocked: true, remasterRequired: false,
      });
    }
  }
  const all = [...byUser.values()];
  for (let i = 0; i < all.length; i += CHUNK) {
    const part = all.slice(i, i + CHUNK);
    await prisma.vocabProgressArchive.deleteMany({ where: { wordKey, userId: { in: part.map((p) => p.userId) } } });
    await prisma.vocabProgressArchive.createMany({ data: part, skipDuplicates: true });
  }
  return all.length;
}

/** Call right AFTER a word row is created. Gives back what students had on an earlier copy of the same word. */
export async function restoreArchivedProgress(prisma: PrismaService, wordId: string, wordText: string): Promise<number> {
  const wordKey = vocabWordKey(wordText);
  if (!wordKey) return 0;
  const saved = await prisma.vocabProgressArchive.findMany({ where: { wordKey } });
  if (!saved.length) return 0;
  for (let i = 0; i < saved.length; i += CHUNK) {
    const part = saved.slice(i, i + CHUNK);
    await prisma.vocabWordProgress.createMany({
      data: part.map((s) => ({
        userId: s.userId, wordId,
        bestScorePct: s.bestScorePct, attemptsCount: s.attemptsCount, lastWrongCount: s.lastWrongCount,
        masteredAt: s.masteredAt, forceUnlocked: true, remasterRequired: s.remasterRequired,
      })),
      skipDuplicates: true,
    });
    await prisma.vocabProgressArchive.deleteMany({ where: { id: { in: part.map((s) => s.id) } } });
  }
  return saved.length;
}
