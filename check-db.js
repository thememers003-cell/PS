const dotenv = require('dotenv');
dotenv.config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const job = await prisma.printJob.findUnique({
    where: { id: 'b36ee48e-8f06-49cb-8812-5404dc3c1020' },
    include: { file: true, kiosk: true }
  });
  console.log('JOB 29:', JSON.stringify(job, null, 2));

  const audit = await prisma.auditLog.findMany({
    take: 15,
    orderBy: { createdAt: 'desc' }
  });
  console.log('AUDIT LOGS:', JSON.stringify(audit, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
