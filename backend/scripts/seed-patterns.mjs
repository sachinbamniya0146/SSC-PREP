// v3 §6.4 — seed real-exam ExamPatterns (idempotent, run inside backend container:
//   docker exec ssc-backend node scripts/seed-patterns.mjs)
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const PATTERNS = [
  {
    examSlug: 'cgl', name: 'SSC CGL Tier 1 (2025)',
    totalQuestions: 100, totalMarks: 200, durationMinutes: 60, negativeMarks: 0.5,
    sections: [
      { name: 'Part A · General Intelligence & Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Part B · General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Part C · Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Part D · English Comprehension', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 15 },
    ],
  },
  {
    examSlug: 'chsl', name: 'SSC CHSL Tier 1 (2024)',
    totalQuestions: 100, totalMarks: 200, durationMinutes: 60, negativeMarks: 0.5,
    sections: [
      { name: 'Section I · English', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Section II · Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Section III · General Intelligence & Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Section IV · General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15 },
    ],
  },
  {
    examSlug: 'cpo', name: 'SSC CPO Paper 1 (2024)',
    totalQuestions: 100, totalMarks: 200, durationMinutes: 60, negativeMarks: 0.5,
    sections: [
      { name: 'Part A · Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Part B · General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Part C · Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Part D · English', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 15 },
    ],
  },
  {
    examSlug: 'mts', name: 'SSC MTS (2024)',
    totalQuestions: 90, totalMarks: 225, durationMinutes: 90, negativeMarks: 0.25,
    sections: [
      { name: 'Section 1 · Numeric & Mathematical Ability', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 62.5, durationMinutes: 22.5 },
      { name: 'Section 2 · Reasoning & Problem Solving', subjectSlug: 'reasoning', questions: 20, marks: 50, durationMinutes: 20 },
      { name: 'Section 3 · General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 62.5, durationMinutes: 22.5 },
      { name: 'Section 4 · English Language', subjectSlug: 'english', questions: 20, marks: 50, durationMinutes: 20 },
    ],
  },
  {
    examSlug: 'gd', name: 'SSC GD Constable (CBE 2024)',
    totalQuestions: 80, totalMarks: 160, durationMinutes: 60, negativeMarks: 0.25,
    sections: [
      { name: 'Part 1 · General Intelligence & Reasoning', subjectSlug: 'reasoning', questions: 20, marks: 40, durationMinutes: 15 },
      { name: 'Part 2 · General Knowledge & Awareness', subjectSlug: 'general_awareness', questions: 20, marks: 40, durationMinutes: 15 },
      { name: 'Part 3 · Elementary Mathematics', subjectSlug: 'quantitative_aptitude', questions: 20, marks: 40, durationMinutes: 15 },
      { name: 'Part 4 · English', subjectSlug: 'english', questions: 20, marks: 40, durationMinutes: 15 },
    ],
  },
];

async function main() {
  let seeded = 0;
  for (const p of PATTERNS) {
    const exam = await prisma.exam.findUnique({ where: { slug: p.examSlug } });
    if (!exam) { console.log(`SKIP (no exam slug ${p.examSlug})`); continue; }
    await prisma.examPattern.upsert({
      where: { examId_name: { examId: exam.id, name: p.name } },
      update: {
        totalQuestions: p.totalQuestions, totalMarks: p.totalMarks,
        durationMinutes: p.durationMinutes, negativeMarks: p.negativeMarks,
        sections: p.sections, isActive: true,
      },
      create: {
        examId: exam.id, name: p.name,
        totalQuestions: p.totalQuestions, totalMarks: p.totalMarks,
        durationMinutes: p.durationMinutes, negativeMarks: p.negativeMarks,
        sections: p.sections,
      },
    });
    seeded++;
    console.log(`SEEDED ${p.name}`);
  }
  console.log(`Done: ${seeded} patterns`);
}

main().finally(() => prisma.$disconnect());