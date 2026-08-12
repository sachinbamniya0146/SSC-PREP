#!/usr/bin/env node
/** Clean up questions with empty/invalid answers (bug: 'ABCD'.includes('') === true). */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find all invalid-answer questions
  const bad = await prisma.question.findMany({
    where: { correctAnswer: { notIn: ['A', 'B', 'C', 'D'] } },
    select: { id: true, questionText: true, correctAnswer: true },
    take: 5000,
  });
  console.log(`Invalid-answer questions found: ${bad.length}`);

  // Check none have attempts referencing them
  const withAttempts = await prisma.attemptAnswer.count({
    where: { questionId: { in: bad.map(b => b.id) } },
  });
  console.log(`With attempt references: ${withAttempts} (must be 0 for safe hard delete)`);

  if (withAttempts > 0) {
    console.log('SAFETY: soft-delete instead (isActive=false)');
    const res = await prisma.question.updateMany({
      where: { id: { in: bad.map(b => b.id) } },
      data: { isActive: false },
    });
    console.log(`Soft-deleted: ${res.count}`);
  } else {
    const res = await prisma.question.deleteMany({
      where: { id: { in: bad.map(b => b.id) } },
    });
    console.log(`Hard-deleted: ${res.count}`);
  }

  const remaining = await prisma.question.count();
  console.log(`Remaining questions: ${remaining}`);
  const stillBad = await prisma.question.count({ where: { correctAnswer: { notIn: ['A','B','C','D'] } } });
  console.log(`Still invalid: ${stillBad}`);
}

main().catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());