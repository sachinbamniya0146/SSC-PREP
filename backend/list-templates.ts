import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.testTemplate.findMany({
    where: { isActive: true },
    select: {
      id: true,
      title: true,
      type: true,
      durationMinutes: true,
      totalQuestions: true,
      isPremium: true
    },
    orderBy: { createdAt: 'desc' }
  });
  console.log(`Found ${templates.length} templates:`);
  templates.forEach(t => {
    console.log(`- ${t.title} (${t.type}) - ${t.totalQuestions}Q, ${t.durationMinutes}min, Premium: ${t.isPremium}`);
  });
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
