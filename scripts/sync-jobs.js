const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('Connecting to Neon PostgreSQL...');
  const jobs = await prisma.printJob.findMany({
    include: { payment: true, printCode: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`Found ${jobs.length} recent jobs:`);
  for (const j of jobs) {
    // Ensure payment is PAID
    await prisma.payment.upsert({
      where: { jobId: j.id },
      update: { status: 'PAID', verifiedAt: new Date() },
      create: {
        jobId: j.id,
        amount: j.totalPrice || 1,
        currency: 'INR',
        status: 'PAID',
        verifiedAt: new Date(),
      },
    });

    // Ensure job is PAID/QUEUED
    if (j.status === 'CREATED' || j.status === 'PAYMENT_PENDING') {
      await prisma.printJob.update({
        where: { id: j.id },
        data: { status: 'QUEUED' },
      });
    }

    console.log(`- Job ${j.displayId}: status=${j.status}, printCode=${j.printCode?.qrToken || 'NONE'}, payment=${j.payment?.status}`);
  }
}

main()
  .catch((e) => {
    console.error('Error syncing jobs:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
