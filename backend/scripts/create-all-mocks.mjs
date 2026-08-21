#!/usr/bin/env node
/**
 * Create comprehensive mock test templates for ALL SSC exams
 * Run in Docker container: docker exec ssc-backend node scripts/create-all-mocks.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMockTemplates() {
  console.log("🎯 Creating mock test templates for ALL SSC exams...\n");
  
  const exams = await prisma.exam.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, code: true }
  });
  
  console.log(`Found ${exams.length} active exams`);
  
  // Mock templates configuration per exam
  const mockConfigs = {
    'CGL': {
      full: { questions: 100, marks: 200, duration: 60, sections: 4 },
      mini: { questions: 25, marks: 50, duration: 15, sections: 4 },
      sectional: { questions: 25, marks: 50, duration: 15, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'CHSL': {
      full: { questions: 100, marks: 200, duration: 60, sections: 4 },
      mini: { questions: 25, marks: 50, duration: 15, sections: 4 },
      sectional: { questions: 25, marks: 50, duration: 15, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'MTS': {
      full: { questions: 90, marks: 180, duration: 90, sections: 4 },
      mini: { questions: 25, marks: 50, duration: 22, sections: 4 },
      sectional: { questions: 22, marks: 44, duration: 22, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'CPO': {
      full: { questions: 200, marks: 200, duration: 120, sections: 4 },
      mini: { questions: 50, marks: 50, duration: 30, sections: 4 },
      sectional: { questions: 50, marks: 50, duration: 30, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'GD': {
      full: { questions: 80, marks: 160, duration: 60, sections: 4 },
      mini: { questions: 20, marks: 40, duration: 15, sections: 4 },
      sectional: { questions: 20, marks: 40, duration: 15, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'STENO': {
      full: { questions: 200, marks: 200, duration: 120, sections: 3 },
      mini: { questions: 50, marks: 50, duration: 30, sections: 3 },
      sectional: { questions: 66, marks: 66, duration: 40, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'JE': {
      full: { questions: 200, marks: 300, duration: 120, sections: 3 },
      mini: { questions: 50, marks: 75, duration: 30, sections: 3 },
      sectional: { questions: 66, marks: 100, duration: 40, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    },
    'CGL PRE': {
      full: { questions: 100, marks: 200, duration: 60, sections: 4 },
      mini: { questions: 25, marks: 50, duration: 15, sections: 4 },
      sectional: { questions: 25, marks: 50, duration: 15, sections: 1 },
      topic: { questions: 15, marks: 30, duration: 10, sections: 1 }
    }
  };
  
  const subjects = await prisma.subject.findMany({ select: { id: true, slug: true } });
  const slugToId = new Map(subjects.map(s => [s.slug.toLowerCase(), s.id]));
  
  // Check available questions per exam & subject
  const questionCounts = await prisma.$queryRaw`
    SELECT e.code as exam_code, s.slug as subject_slug, COUNT(q.id)::int as count
    FROM exams e
    JOIN questions q ON q."examId" = e.id
    JOIN subjects s ON s.id = q."subjectId"
    WHERE q."isApproved" = true AND q."questionTextHindi" IS NOT NULL AND q."questionTextHindi" <> ''
    GROUP BY e.code, s.slug
  `;
  
  console.log("Available bilingual questions per exam & subject:");
  for (const row of questionCounts) {
    console.log(`  ${row.exam_code} / ${row.subject_slug}: ${row.count}`);
  }
  
  let created = 0;
  let skipped = 0;
  
  for (const exam of exams) {
    const config = mockConfigs[exam.code] || mockConfigs['CGL'];
    const examCode = exam.code.toUpperCase();
    
    // Check if templates already exist
    const existing = await prisma.testTemplate.findMany({
      where: { title: { startsWith: exam.name } }
    });
    
    if (existing.length > 0) {
      console.log(`\n⏭️  ${exam.name}: ${existing.length} templates already exist, skipping...`);
      skipped += existing.length;
      continue;
    }
    
    console.log(`\n📝 Creating templates for ${exam.name} (${exam.code})...`);
    
    // 1. FULL MOCK (Premium)
    await prisma.testTemplate.create({
      data: {
        id: `tpl-${exam.slug}-full-1`,
        title: `${exam.name} Tier I Full Mock 1`,
        description: `Complete ${config.full.questions} question full-length mock test matching the real ${exam.name} Tier I pattern. Server-timed, auto-submit, detailed analytics.`,
        type: 'FULL_MOCK',
        durationMinutes: config.full.duration,
        totalQuestions: config.full.questions,
        totalMarks: config.full.marks,
        isPremium: true,
        isActive: true
      }
    });
    created++;
    
    // 2. MINI MOCK (Free - 2 per test)
    await prisma.testTemplate.create({
      data: {
        id: `tpl-${exam.slug}-mini-1`,
        title: `${exam.name} Tier I Mini Mock 1`,
        description: `Quick ${config.mini.questions} question practice test covering all sections. Free for all users.`,
        type: 'MINI_MOCK',
        durationMinutes: config.mini.duration,
        totalQuestions: config.mini.questions,
        totalMarks: config.mini.marks,
        isPremium: false,
        isActive: true
      }
    });
    created++;
    
    // 3. PYQ Previous Year Papers (Free)
    for (const year of [2024, 2023, 2022, 2021]) {
      const hasQuestions = await prisma.question.count({
        where: { examId: exam.id, year, isApproved: true, questionTextHindi: { not: '' } }
      });
      
      if (hasQuestions >= 50) {
        await prisma.testTemplate.create({
          data: {
            id: `tpl-${exam.slug}-pyq-${year}`,
            title: `${exam.name} ${year} Tier I PYQ`,
            description: `Previous year ${year} paper with ${hasQuestions} verified bilingual questions. Real exam experience with solutions.`,
            type: 'PREVIOUS_YEAR',
            durationMinutes: config.full.duration,
            totalQuestions: Math.min(hasQuestions, config.full.questions),
            totalMarks: config.full.marks,
            isPremium: false,
            isActive: true
          }
        });
        created++;
      }
    }
    
    // 4. SECTIONAL MOCKS (Free - per subject)
    const subjectSlugs = ['reasoning', 'quantitative_aptitude', 'english_language', 'general_awareness'];
    for (const subjectSlug of subjectSlugs) {
      const subjectId = slugToId.get(subjectSlug);
      if (!subjectId) continue;
      
      const subject = subjects.find(s => s.id === subjectId);
      const count = config.sectional.questions;
      const hasQuestions = await prisma.question.count({
        where: { examId: exam.id, subjectId, isApproved: true, questionTextHindi: { not: '' } }
      });
      
      if (hasQuestions >= count) {
        await prisma.testTemplate.create({
          data: {
            id: `tpl-${exam.slug}-sectional-${subjectSlug}`,
            title: `${exam.name} ${subject?.name || subjectSlug} Sectional Mock`,
            description: `${count} questions from ${subject?.name || subjectSlug} only. Chapter-wise distribution, multi-year spread.`,
            type: 'SUBJECT',
            durationMinutes: config.sectional.duration,
            totalQuestions: count,
            totalMarks: config.sectional.marks,
            isPremium: false,
            isActive: true
          }
        });
        created++;
      }
    }
    
    // 5. TOPIC-WISE MOCKS (Premium - per chapter)
    const chapters = await prisma.chapter.findMany({
      where: { subjectId: { in: [...slugToId.values()] } },
      include: { subject: true }
    });
    
    for (const chapter of chapters) {
      const hasQuestions = await prisma.question.count({
        where: { examId: exam.id, chapterId: chapter.id, isApproved: true, questionTextHindi: { not: '' } }
      });
      
      if (hasQuestions >= 15) {
        await prisma.testTemplate.create({
          data: {
            id: `tpl-${exam.slug}-topic-${chapter.id.slice(0, 8)}`,
            title: `${exam.name} ${chapter.name} Topic Test`,
            description: `Focused ${config.topic.questions} question test on ${chapter.name} (${chapter.subject?.name}). Perfect for chapter revision.`,
            type: 'TOPIC',
            durationMinutes: config.topic.duration,
            totalQuestions: Math.min(hasQuestions, config.topic.questions),
            totalMarks: config.topic.marks,
            isPremium: false, // Make topic tests free for practice
            isActive: true
          }
        });
        created++;
      }
    }
    
    console.log(`  ✅ ${exam.name}: Templates created`);
  }
  
  console.log(`\n🎉 COMPLETE!`);
  console.log(`   Created: ${created} templates`);
  console.log(`   Skipped: ${skipped} (already existed)`);
  
  // Final verification
  const allTemplates = await prisma.testTemplate.findMany({
    select: { id: true, title: true, type: true, totalQuestions: true, isPremium: true }
  });
  console.log(`\n📊 Total templates in DB: ${allTemplates.length}`);
  
  const byType = allTemplates.reduce((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});
  console.log("By type:", byType);
  
  await prisma.$disconnect();
}

createMockTemplates().catch(console.error);