const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const total = await prisma.question.count();
  const sample = await prisma.question.findFirst({
    select: { id: true, questionText: true, correctAnswer: true, explanation: true, year: true, shift: true, marks: true, negativeMarks: true, difficulty: true, examId: true, subjectId: true, chapterId: true },
  });
  console.log('TOTAL=' + total);
  console.log('SAMPLE=' + JSON.stringify(sample));
  await prisma.$disconnect();
})().catch(e => console.log('ERR2 ' + e.message));