#!/usr/bin/env node
/** Seed mock test templates so /mocks shows real content. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const templates = [
    { id: 'tpl-cgl-full-1', title: 'SSC CGL Tier I Full Mock 1', description: 'Full-length CGL Tier I mock — 100 Q, 60 min, bilingual', type: 'FULL_MOCK', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { id: 'tpl-cgl-mini-1', title: 'SSC CGL Tier I Mini Mock 1', description: 'Quick 25-question CGL mini mock', type: 'MINI_MOCK', durationMinutes: 15, totalQuestions: 25, totalMarks: 50, isPremium: false },
    { id: 'tpl-cgl-pyq-2024', title: 'SSC CGL 2024 Tier I PYQ', description: 'Real CGL 2024 previous year paper', type: 'PREVIOUS_YEAR', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { id: 'tpl-cgl-pyq-2023', title: 'SSC CGL 2023 Tier I PYQ', description: 'Real CGL 2023 previous year paper', type: 'PREVIOUS_YEAR', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { id: 'tpl-chsl-full-1', title: 'SSC CHSL Tier I Full Mock 1', description: 'Full-length CHSL Tier I mock — 100 Q, 60 min', type: 'FULL_MOCK', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { id: 'tpl-mts-full-1', title: 'SSC MTS Full Mock 1', description: 'Full-length MTS mock — 90 Q, 90 min', type: 'FULL_MOCK', durationMinutes: 90, totalQuestions: 90, totalMarks: 90, isPremium: false },
    { id: 'tpl-cpo-full-1', title: 'SSC CPO Full Mock 1', description: 'Full-length CPO mock — 100 Q, 60 min', type: 'FULL_MOCK', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
  ];
  
  let created = 0;
  for (const t of templates) {
    try {
      await prisma.testTemplate.upsert({
        where: { id: t.id },
        create: t,
        update: {},
      });
      created++;
    } catch (e) {
      console.log(`SKIP ${t.id}: ${e.message.slice(0,80)}`);
    }
  }
  console.log(`Templates ready: ${created}`);
}

main().catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());