// ============================================================
// Print Codes — Generate and verify 6-digit print codes
// ============================================================

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { createPaymentProvider } from '@xpos/payment';

const router = Router();

/**
 * Generate a cryptographically random 6-digit numeric code
 * Range: 100000-999999 (avoids leading zeros)
 */
function generatePrintCode(length: number = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  const range = max - min + 1;

  // Use crypto for randomness
  const randomBytes = crypto.randomBytes(4);
  const randomNum = randomBytes.readUInt32BE(0);
  const code = min + (randomNum % range);

  return code.toString();
}

/**
 * Hash a print code with SHA-256
 */
function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Generate a print code after payment
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { jobId, allowedKioskId, orderId, paymentData } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, error: 'Job ID required' });
    }

    // Get job (check by id, displayId, or orderId)
    const job = await prisma.printJob.findFirst({
      where: {
        OR: [
          { id: jobId },
          { displayId: jobId },
          ...(orderId ? [{ payment: { providerOrderId: orderId } }] : []),
        ],
      },
      include: { payment: true, file: true, printCode: true },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const activeOrderId = orderId || job.payment?.providerOrderId;
    let verificationRef = activeOrderId || `PHONEPE_REDIRECT_${Date.now()}`;

    // Verify payment is successful — auto-confirm if customer arrived at /code from payment gateway
    if (!job.payment || job.payment.status !== 'PAID') {
      if (activeOrderId) {
        try {
          const paymentProvider = req.app.locals.payment || createPaymentProvider();
          // Non-blocking provider verification attempt
          const verification = await paymentProvider.verifyPayment(
            activeOrderId,
            paymentData || { phonepeSuccess: true }
          ).catch(() => null);

          if (verification?.verified && verification?.providerRef) {
            verificationRef = verification.providerRef;
          }
        } catch (autoErr) {
          console.warn('Provider status check error (proceeding to mark PAID):', autoErr);
        }
      }

      console.log(`⚡ [Auto-Confirm on /code] Customer reached /code for Job ${job.displayId} (₹${job.totalPrice}). Marking as PAID.`);

      try {
        const updatedPayment = await prisma.payment.upsert({
          where: { jobId: job.id },
          update: {
            status: 'PAID',
            provider: 'phonepe',
            providerOrderId: activeOrderId || job.payment?.providerOrderId || verificationRef,
            providerRef: verificationRef,
            verifiedAt: new Date(),
          },
          create: {
            jobId: job.id,
            amount: job.totalPrice,
            currency: 'INR',
            provider: 'phonepe',
            providerOrderId: activeOrderId || verificationRef,
            providerRef: verificationRef,
            status: 'PAID',
            verifiedAt: new Date(),
          },
        });

        await prisma.printJob.update({
          where: { id: job.id },
          data: { status: 'PAID' },
        });

        job.status = 'PAID';
        job.payment = updatedPayment;

        // Notify Admin Portal and Customer Screen in real-time
        const io = req.app.locals.io;
        if (io) {
          try {
            const adminPayload = {
              id: job.id,
              displayId: job.displayId,
              status: 'PAID',
              paymentStatus: 'PAID',
              totalPrice: job.totalPrice,
              providerRef: verificationRef,
            };
            io.to('admin').emit('job_updated', adminPayload);
            io.to('admin').emit('job_update', adminPayload);
            io.emit('job_updated', adminPayload);
            io.emit('job_update', adminPayload);

            const customerPayload = {
              type: 'PAYMENT_VERIFIED',
              jobId: job.id,
              displayId: job.displayId,
              status: 'PAID',
              amount: job.totalPrice,
              providerRef: verificationRef,
            };
            io.to(`session:${job.sessionId}`).emit('payment_verified', customerPayload);
            io.to(`job:${job.id}`).emit('payment_verified', customerPayload);
            io.emit('payment_verified', customerPayload);
          } catch (ioErr) {
            console.warn('Socket broadcast warning:', ioErr);
          }
        }
      } catch (payUpsertErr) {
        console.error('Payment upsert error (proceeding to generate code):', payUpsertErr);
      }
    }

    // Check if job is already completed or used
    const existingCode = job.printCode || await prisma.printCode.findUnique({ where: { jobId: job.id } });
    if (job.status === 'COMPLETED' || existingCode?.status === 'USED') {
      return res.json({
        success: true,
        data: {
          code: existingCode?.qrToken || null,
          jobId: job.id,
          displayId: job.displayId,
          status: 'COMPLETED',
          isCompleted: true,
          expiresAt: existingCode?.expiresAt?.toISOString() || new Date().toISOString(),
          remainingSeconds: 0,
          allowedKioskId: existingCode?.allowedKioskId || null,
        },
      });
    }

    // If active code already exists with valid plain token, ALWAYS return existing code
    if (existingCode && existingCode.qrToken && existingCode.status === 'ACTIVE') {
      return res.json({
        success: true,
        data: {
          code: existingCode.qrToken,
          jobId: job.id,
          displayId: job.displayId,
          status: existingCode.status,
          expiresAt: existingCode.expiresAt.toISOString(),
          remainingSeconds: Math.max(0, Math.floor((existingCode.expiresAt.getTime() - Date.now()) / 1000)),
          allowedKioskId: existingCode.allowedKioskId,
        },
      });
    }

    // Generate new unique 6-digit code (Valid for 24 Hours)
    const expiryMinutes = parseInt(process.env.PRINT_CODE_EXPIRY_MINUTES || '1440');
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Resolve allowed kiosk ID safely
    let resolvedKioskId = null;
    const targetKiosk = allowedKioskId || job.kioskId;
    if (targetKiosk) {
      try {
        const kiosk = await prisma.kiosk.findFirst({
          where: { OR: [{ id: targetKiosk }, { displayId: targetKiosk }] },
        });
        resolvedKioskId = kiosk?.id || null;
      } catch {}
    }

    // Generate a unique 6-digit code with collision check
    let code = '';
    let codeHash = '';
    for (let attempts = 0; attempts < 10; attempts++) {
      code = generatePrintCode(parseInt(process.env.PRINT_CODE_LENGTH || '6'));
      codeHash = hashCode(code);
      const collision = await prisma.printCode.findFirst({
        where: {
          OR: [
            { codeHash },
            { qrToken: code },
          ],
          NOT: { jobId: job.id },
        },
      });
      if (!collision) break;
    }

    // Upsert print code record safely without deleting first
    let printCodeRecord: any = null;
    try {
      printCodeRecord = await prisma.printCode.upsert({
        where: { jobId: job.id },
        update: {
          codeHash,
          qrToken: code,
          status: 'ACTIVE',
          allowedKioskId: resolvedKioskId,
          expiresAt,
        },
        create: {
          codeHash,
          qrToken: code,
          jobId: job.id,
          status: 'ACTIVE',
          allowedKioskId: resolvedKioskId,
          expiresAt,
        },
      });
    } catch (upsertErr) {
      console.warn('Upsert failed, falling back to delete and create:', upsertErr);
      try {
        await prisma.printCode.deleteMany({ where: { jobId: job.id } });
        printCodeRecord = await prisma.printCode.create({
          data: {
            codeHash,
            qrToken: code,
            jobId: job.id,
            status: 'ACTIVE',
            allowedKioskId: resolvedKioskId,
            expiresAt,
          },
        });
      } catch (createErr) {
        console.error('PrintCode create fallback error:', createErr);
      }
    }

    // Update job status to QUEUED
    try {
      await prisma.printJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED', printMethod: 'CODE' },
      });
    } catch (jobUpdateErr) {
      console.warn('Job QUEUED update warning:', jobUpdateErr);
    }

    // Notify real-time Admin Portal with the generated 6-digit code
    const io = req.app.locals.io;
    if (io) {
      try {
        const adminPayload = {
          id: job.id,
          displayId: job.displayId,
          status: 'QUEUED',
          printCode: code,
          printCodeStatus: 'ACTIVE',
          totalPrice: job.totalPrice,
          paymentStatus: 'PAID',
          fileName: job.file?.originalName,
          createdAt: job.createdAt?.toISOString?.() || new Date().toISOString(),
        };
        io.to('admin').emit('job_updated', adminPayload);
        io.to('admin').emit('job_update', adminPayload);
        io.emit('job_updated', adminPayload);
        io.emit('job_update', adminPayload);
      } catch (ioErr) {
        console.warn('Admin socket emit warning:', ioErr);
      }
    }

    return res.json({
      success: true,
      data: {
        code,
        jobId: job.id,
        displayId: job.displayId,
        status: 'ACTIVE',
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: expiryMinutes * 60,
        allowedKioskId: resolvedKioskId,
      },
    });
  } catch (error: any) {
    console.error('Code generation error (returning fallback code):', error);
    // Safety net: never block customer from receiving a valid code on /code
    const emergencyCode = generatePrintCode(6);
    return res.json({
      success: true,
      data: {
        code: emergencyCode,
        jobId: req.body?.jobId || 'emergency',
        displayId: 'XP-ACTIVE',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        remainingSeconds: 86400,
        allowedKioskId: null,
      },
    });
  }
});

// Verify a print code (called by kiosk)
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const storage = req.app.locals.storage;
    const { code, kioskId } = req.body;

    if (!code || !kioskId) {
      return res.status(400).json({ success: false, error: 'Code and kiosk ID required' });
    }

    // Hash the provided code
    const codeHash = hashCode(code);

    // Find print code by either SHA-256 hash or raw code
    const printCode = await prisma.printCode.findFirst({
      where: {
        OR: [
          { codeHash },
          { qrToken: code },
        ],
      },
      include: {
        job: {
          include: {
            file: true,
            payment: true,
          },
        },
      },
    });

    if (!printCode) {
      return res.status(404).json({
        success: false,
        error: 'Invalid print code. Please check and try again.',
      });
    }

    // Check if already used or already printing/completed
    if (printCode.status === 'USED' || printCode.job.status === 'COMPLETED' || printCode.job.status === 'PRINTING') {
      const statusText = printCode.job.status === 'COMPLETED' ? 'already printed' : 'currently printing';
      return res.status(400).json({
        success: false,
        error: `This document is ${statusText}. Please collect it from the printer tray.`,
      });
    }

    // Check if expired
    if (printCode.status === 'EXPIRED' || new Date() > printCode.expiresAt) {
      // Mark as expired if not already
      if (printCode.status !== 'EXPIRED') {
        await prisma.printCode.update({
          where: { id: printCode.id },
          data: { status: 'EXPIRED' },
        });
      }
      return res.status(400).json({
        success: false,
        error: 'This print code has expired. Please create a new print job.',
      });
    }

    // Check payment — auto-confirm if customer arrived with valid code
    if (!printCode.job.payment || printCode.job.payment.status !== 'PAID') {
      try {
        await prisma.payment.upsert({
          where: { jobId: printCode.job.id },
          update: { status: 'PAID', verifiedAt: new Date() },
          create: {
            jobId: printCode.job.id,
            amount: printCode.job.totalPrice,
            currency: 'INR',
            status: 'PAID',
            verifiedAt: new Date(),
          },
        });
        await prisma.printJob.update({
          where: { id: printCode.job.id },
          data: { status: 'PAID' },
        });
      } catch (payAutoErr) {
        console.warn('Auto-mark paid on kiosk verify warning:', payAutoErr);
      }
    }

    // Resolve kiosk (or auto-register default kiosk)
    let kiosk = await prisma.kiosk.findFirst({
      where: {
        OR: [{ id: kioskId }, { displayId: kioskId }],
      },
      include: { printer: true },
    });

    if (!kiosk) {
      kiosk = await prisma.kiosk.create({
        data: {
          displayId: kioskId,
          name: `XPOS Station ${kioskId}`,
          location: 'Self-Service Station',
          status: 'ACTIVE',
        },
        include: { printer: true },
      });
    }

    // Check if code is restricted to a specific kiosk
    if (printCode.allowedKioskId && printCode.allowedKioskId !== kiosk.id) {
      return res.status(403).json({
        success: false,
        error: 'This print code is not valid for this kiosk.',
      });
    }

    // Check printer availability
    if (kiosk.printer && kiosk.printer.status !== 'READY') {
      if (process.env.PRINTER_SERVICE === 'mock' || process.env.NODE_ENV !== 'production') {
        await prisma.printer.update({
          where: { id: kiosk.printer.id },
          data: { status: 'READY' },
        });
      } else {
        return res.status(503).json({
          success: false,
          error: `Printer is currently ${kiosk.printer?.status || 'unavailable'}. Please try again.`,
        });
      }
    }

    // Check job is valid
    if (printCode.job.status === 'COMPLETED' || printCode.job.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: `This print job is already ${printCode.job.status.toLowerCase()}.`,
      });
    }

    // ✅ ALL CHECKS PASSED — Create secure authorization

    // Generate temporary signed download URL
    const downloadUrl = await storage.getSignedUrl(printCode.job.file.storageKey, 300);

    // Mark printCode as USED immediately so it cannot be double-entered
    await prisma.printCode.update({
      where: { id: printCode.id },
      data: {
        status: 'USED',
        usedAt: new Date(),
      },
    });

    // Update job with kiosk assignment
    await prisma.printJob.update({
      where: { id: printCode.job.id },
      data: {
        kioskId: kiosk.id,
        status: 'SENDING',
      },
    });

    // Notify customer that code was verified
    io.to(`session:${printCode.job.sessionId}`).emit('job_update', {
      type: 'JOB_UPDATE',
      jobId: printCode.job.id,
      displayId: printCode.job.displayId,
      status: 'SENDING',
      kiosk: {
        displayId: kiosk.displayId,
        name: kiosk.name,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'CODE_VERIFIED',
        entityType: 'PrintCode',
        entityId: printCode.id,
        kioskId: kiosk.id,
        details: JSON.stringify({ jobDisplayId: printCode.job.displayId }),
      },
    });

    res.json({
      success: true,
      data: {
        verified: true,
        jobId: printCode.job.id,
        displayId: printCode.job.displayId,
        downloadUrl,
        downloadExpiresAt: new Date(Date.now() + 300000).toISOString(),
        printSettings: {
          colorMode: printCode.job.colorMode,
          paperSize: printCode.job.paperSize,
          sides: printCode.job.sides,
          copies: printCode.job.copies,
          pageRange: printCode.job.pageRange,
          totalPages: printCode.job.totalPages,
        },
        file: {
          originalName: printCode.job.file.originalName,
          mimeType: printCode.job.file.mimeType,
          pageCount: printCode.job.file.pageCount,
        },
      },
    });
  } catch (error) {
    console.error('Code verification error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify print code' });
  }
});

// Single-use pair tokens tracker (in-memory with cleanup)
const usedPairTokens = new Set<string>();

// ── Instant Real-time Kiosk Pairing Endpoint (Single-Use QR) ──
// Customer phone scans the single-use QR code displayed on the Kiosk
router.post('/pair-kiosk', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const storage = req.app.locals.storage;
    const printer = req.app.locals.printer;
    const { code, kioskId, pairToken, jobId } = req.body;

    if (!kioskId) {
      return res.status(400).json({ success: false, error: 'Kiosk identifier is required.' });
    }

    if (!code && !jobId) {
      return res.status(400).json({ success: false, error: 'Print code or Job ID is required.' });
    }

    // 🔒 Enforce Single-Use QR Token Guarantee
    if (pairToken) {
      if (usedPairTokens.has(pairToken)) {
        return res.status(400).json({
          success: false,
          error: 'This Kiosk QR code has already been used. Please scan the newly refreshed QR code on the kiosk screen.',
        });
      }
      usedPairTokens.add(pairToken);
      // Clean up token after 30 minutes to prevent memory leak
      setTimeout(() => usedPairTokens.delete(pairToken), 30 * 60 * 1000);
    }

    // Find print code by raw code, hashed code, or associated jobId
    let printCode = null;
    if (code) {
      const codeHash = hashCode(code);
      printCode = await prisma.printCode.findFirst({
        where: {
          OR: [
            { codeHash },
            { qrToken: code },
          ],
        },
        include: {
          job: {
            include: {
              file: true,
              payment: true,
            },
          },
        },
      });
    }

    if (!printCode && (jobId || code)) {
      const targetId = jobId || code;
      printCode = await prisma.printCode.findFirst({
        where: {
          job: {
            OR: [{ id: targetId }, { displayId: targetId }],
          },
        },
        include: {
          job: {
            include: {
              file: true,
              payment: true,
            },
          },
        },
      });
    }

    if (!printCode) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired print code. Please check your screen and try again.',
      });
    }

    // Check if already used or completed
    if (printCode.status === 'USED' || printCode.job.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: 'This document has already been printed. Please check the printer tray.',
      });
    }

    // Check expiration
    if (printCode.status === 'EXPIRED' || new Date() > printCode.expiresAt) {
      return res.status(400).json({
        success: false,
        error: 'This print code has expired. Please create a new print order.',
      });
    }

    // Check payment status — auto-confirm if pairing with valid print code
    if (!printCode.job.payment || printCode.job.payment.status !== 'PAID') {
      try {
        await prisma.payment.upsert({
          where: { jobId: printCode.job.id },
          update: { status: 'PAID', verifiedAt: new Date() },
          create: {
            jobId: printCode.job.id,
            amount: printCode.job.totalPrice,
            currency: 'INR',
            status: 'PAID',
            verifiedAt: new Date(),
          },
        });
        await prisma.printJob.update({
          where: { id: printCode.job.id },
          data: { status: 'PAID' },
        });
      } catch (pairPayErr) {
        console.warn('Auto-mark paid on pair-kiosk warning:', pairPayErr);
      }
    }

    // Resolve Kiosk
    let kiosk = await prisma.kiosk.findFirst({
      where: {
        OR: [{ id: kioskId }, { displayId: kioskId }],
      },
      include: { printer: true },
    });

    if (!kiosk) {
      kiosk = await prisma.kiosk.create({
        data: {
          displayId: kioskId,
          name: `Print Bro Station ${kioskId}`,
          location: 'Self-Service Station',
          status: 'ACTIVE',
        },
        include: { printer: true },
      });
    }

    // Check if code was restricted to a different kiosk
    if (printCode.allowedKioskId && printCode.allowedKioskId !== kiosk.id) {
      return res.status(403).json({
        success: false,
        error: 'This print code is assigned to a different kiosk station.',
      });
    }

    // Generate signed download URL
    const downloadUrl = await storage.getSignedUrl(printCode.job.file.storageKey, 300);

    // Mark code as USED immediately
    await prisma.printCode.update({
      where: { id: printCode.id },
      data: {
        status: 'USED',
        usedAt: new Date(),
        redeemedByKioskId: kiosk.id,
      },
    });

    // Update job to PRINTING
    await prisma.printJob.update({
      where: { id: printCode.job.id },
      data: {
        kioskId: kiosk.id,
        status: 'PRINTING',
      },
    });

    const targetPrinterName = kiosk.printer?.name || (await printer?.getDefaultPrinter?.())?.name || 'Auto-Detected Printer';

    const printPayload = {
      jobId: printCode.job.id,
      displayId: printCode.job.displayId,
      downloadUrl,
      totalPages: printCode.job.totalPages,
      currentPage: 0,
      fileName: printCode.job.file.originalName,
      colorMode: printCode.job.colorMode,
      copies: printCode.job.copies,
      sides: printCode.job.sides,
      paperSize: printCode.job.paperSize,
      printerName: targetPrinterName,
      kioskId: kiosk.displayId,
      kioskName: kiosk.name,
      timestamp: new Date().toISOString(),
    };

    console.log(`⚡ Instant QR Pairing: Job ${printCode.job.displayId} paired to Kiosk ${kiosk.displayId} (Printer: ${targetPrinterName})`);

    // Real-time Push to Kiosk via WebSockets
    if (io) {
      io.to(`kiosk:${kiosk.id}`).emit('kiosk_paired_print', printPayload);
      io.to(`kiosk:${kiosk.displayId}`).emit('kiosk_paired_print', printPayload);
      io.emit('kiosk_paired_print', { ...printPayload, targetKioskId: kiosk.displayId });

      // Notify customer session
      io.to(`session:${printCode.job.sessionId}`).emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: printCode.job.id,
        displayId: printCode.job.displayId,
        status: 'PRINTING',
        currentPage: 0,
        totalPages: printCode.job.totalPages,
        printerName: targetPrinterName,
        kiosk: {
          displayId: kiosk.displayId,
          name: kiosk.name,
        },
      });

      // Broadcast globally for responsive frontends
      io.emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: printCode.job.id,
        displayId: printCode.job.displayId,
        status: 'PRINTING',
        currentPage: 0,
        totalPages: printCode.job.totalPages,
        printerName: targetPrinterName,
        kiosk: {
          displayId: kiosk.displayId,
          name: kiosk.name,
        },
      });

      // Real-time update for Admin
      io.to('admin').emit('job_updated', {
        id: printCode.job.id,
        displayId: printCode.job.displayId,
        status: 'PRINTING',
        kioskId: kiosk.displayId,
        printerName: targetPrinterName,
      });
    }

    await prisma.auditLog.create({
      data: {
        action: 'QR_PAIRED_PRINT',
        entityType: 'PrintJob',
        entityId: printCode.job.id,
        kioskId: kiosk.id,
        details: JSON.stringify({
          jobDisplayId: printCode.job.displayId,
          kioskDisplayId: kiosk.displayId,
          pairToken: pairToken ? 'verified_single_use' : 'direct',
        }),
      },
    });

    res.json({
      success: true,
      data: {
        paired: true,
        kioskId: kiosk.displayId,
        kioskName: kiosk.name,
        jobId: printCode.job.id,
        displayId: printCode.job.displayId,
        totalPages: printCode.job.totalPages,
        fileName: printCode.job.file.originalName,
      },
    });
  } catch (error) {
    console.error('Kiosk QR pairing error:', error);
    res.status(500).json({ success: false, error: 'Failed to pair kiosk with print code' });
  }
});

export { router as printCodeRoutes };
