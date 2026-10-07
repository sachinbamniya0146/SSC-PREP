const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  try {
    const questions = await prisma.question.findMany({
      where: { isActive: true, isApproved: true },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });
    const d = new Date().toLocaleDateString('en-IN');
    let msg = '📚 *Daily SSC Practice - ' + d + '*\n\n';
    questions.forEach((q, i) => {
      const text = q.questionTextHindi || q.questionText;
      msg += (i + 1) + '. ' + text.substring(0, 100) + '...\n';
    });
    msg += '\n🔗 Full practice: https://mighty-mirrors-draw.loca.lt';
    msg += '\n📱 Join: https://chat.whatsapp.com/Study__2026';
    console.log(msg);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}
run();
