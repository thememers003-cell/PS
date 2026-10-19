const dotenv = require('dotenv');
dotenv.config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fs = require('fs');
  const path = require('path');
  const jobs = await prisma.printJob.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { file: true, kiosk: true }
  });
  console.log('=== LATEST 5 PRINT JOBS ===');
  for (const job of jobs) {
    const key = job.file?.storageKey;
    const candidates = [
      path.resolve(__dirname, key || ''),
      path.resolve(__dirname, 'uploads', key || ''),
      path.resolve(__dirname, 'apps/api/uploads', key || ''),
    ];
    const foundPath = candidates.find(c => fs.existsSync(c));
    console.log({
      id: job.id,
      displayId: job.displayId,
      status: job.status,
      fileName: job.file?.originalName,
      storageKey: key,
      fileSize: job.file?.sizeBytes,
      pageCount: job.file?.pageCount,
      fileExistsOnDisk: !!foundPath,
      resolvedPath: foundPath || 'NOT FOUND ON DISK',
      createdAt: job.createdAt
    });
  }
  const kiosks = await prisma.kiosk.findMany({ include: { printer: true } });
  console.log('=== KIOSKS & ASSIGNED PRINTERS ===');
  for (const k of kiosks) {
    console.log({
      id: k.id,
      displayId: k.displayId,
      name: k.name,
      status: k.status,
      printerId: k.printerId,
      printer: k.printer ? { name: k.printer.name, status: k.printer.status, model: k.printer.model } : null,
      lastHeartbeat: k.lastHeartbeat,
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
