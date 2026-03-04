import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Test accounts only. Climate weekly markets are created by:
  //   npm run seed:bom-weekly
  const account1 = await prisma.account.create({
    data: { balance: 10000 },
  });
  const account2 = await prisma.account.create({
    data: { balance: 10000 },
  });
  console.log(`Created accounts: ${account1.id}, ${account2.id}`);

  console.log('Seed completed!');
  console.log('Run "npm run seed:bom-weekly" to create climate weekly markets (8 weeks × 8 stations × 5 types).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
