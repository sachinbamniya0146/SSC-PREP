import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'sachinbamniya0143@gmail.com' }
  });
  console.log('User found:', user ? JSON.stringify(user, null, 2) : 'No user found');
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
