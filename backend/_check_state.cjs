
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const total = await p.question.count();
  const noAnswer = await p.question.count({ where: { OR: [{ correctAnswer: null }, { correctAnswer: '' }] } });
  const noHindi = await p.question.count({ where: { OR: [{ questionTextHindi: null }, { questionTextHindi: '' }] } });
  const noExpl = await p.question.count({ where: { OR: [{ explanation: null }, { explanation: '' }] } });
  const notApproved = await p.question.count({ where: { isApproved: false } });
  const byExam = await p.$queryRawUnsafe(`SELECT e.code, count(q.id)::int as c FROM "Question" q LEFT JOIN "Exam" e ON q."examId"=e.id GROUP BY e.code ORDER BY c DESC`);
  const bySubject = await p.$queryRawUnsafe(`SELECT s.name, count(q.id)::int as c FROM "Question" q LEFT JOIN "Subject" s ON q."subjectId"=s.id GROUP BY s.name ORDER BY c DESC LIMIT 20`);
  const byYear = await p.$queryRawUnsafe(`SELECT q.year::text, count(q.id)::int as c FROM "Question" q GROUP BY q.year ORDER BY q.year`);
  console.log(JSON.stringify({ total, noAnswer, noHindi, noExpl, notApproved, byExam, bySubject, byYear }, null, 2));
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
