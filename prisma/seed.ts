import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYSTEM_PAPER_ACCOUNT_ID = 'system-paper-reserve';

async function main() {
  console.log('Seeding database...');

  // System account for paper topup and agent creation (contra for ledger)
  await prisma.account.upsert({
    where: { id: SYSTEM_PAPER_ACCOUNT_ID },
    create: {
      id: SYSTEM_PAPER_ACCOUNT_ID,
      balance: 10_000_000,
      isPaper: false,
    },
    update: {},
  });

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
