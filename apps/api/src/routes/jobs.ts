// ============================================================
// Jobs — Print job creation and status
// ============================================================

import { Router, Request, Response } from 'express';

const router = Router();

// Create a print job
router.post('/', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const {
      sessionId,
      fileId,
      kioskId,
      printMethod,
      colorMode,
      paperSize,
      sides,
      copies,
      pageRange,
      totalPages,
      totalPrice,
    } = req.body;

    // Validate required fields
    if (!sessionId || !fileId) {
      return res.status(400).json({ success: false, error: 'sessionId and fileId are required' });
    }

    // Verify or auto-create session
    let session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      session = await prisma.session.create({
        data: {
          id: sessionId,
          printMethod: printMethod || 'CODE',
          status: 'ACTIVE',
        },
      });
    }

    // Verify file
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Get kiosk internal ID if display ID provided
    let kioskInternalId = null;
    if (kioskId) {
      const kiosk = await prisma.kiosk.findFirst({
        where: { OR: [{ id: kioskId }, { displayId: kioskId }] },
      });
      kioskInternalId = kiosk?.id || null;
    }

    // Get next job number for display ID
    const lastJob = await prisma.printJob.findFirst({
      orderBy: { jobNumber: 'desc' },
    });
    const nextNumber = (lastJob?.jobNumber || 0) + 1;
    const displayId = `XP-${String(nextNumber).padStart(6, '0')}`;

    const finalTotalPages = totalPages || file.pageCount || 1;
    const finalTotalPrice = totalPrice !== undefined ? totalPrice : 2;

    // Create job
    const job = await prisma.printJob.create({
      data: {
        displayId,
        sessionId,
        fileId,
        kioskId: kioskInternalId,
        printMethod: printMethod || 'CODE',
        status: 'CREATED',
        colorMode: colorMode || 'BW',
        paperSize: paperSize || 'A4',
        sides: sides || 'SINGLE',
        copies: copies || 1,
        pageRange: pageRange || null,
        totalPages: finalTotalPages,
        totalPrice: finalTotalPrice,
        jobNumber: nextNumber,
      },
      include: {
        file: true,
        kiosk: true,
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        action: 'JOB_CREATED',
        entityType: 'PrintJob',
        entityId: job.id,
        kioskId: kioskInternalId,
        details: JSON.stringify({ printMethod, colorMode, copies, totalPrice }),
      },
    });

    // Notify real-time Admin Portal
    const io = req.app.locals.io;
    if (io) {
      io.to('admin').emit('job_updated', {
        id: job.id,
        displayId: job.displayId,
        status: job.status,
        totalPages: job.totalPages,
        totalPrice: job.totalPrice,
        colorMode: job.colorMode,
        fileName: job.file?.originalName,
        kioskName: job.kiosk?.displayId,
        createdAt: job.createdAt.toISOString(),
      });
    }

    res.json({
      success: true,
      data: {
        id: job.id,
        displayId: job.displayId,
        status: job.status,
        printMethod: job.printMethod,
        colorMode: job.colorMode,
        paperSize: job.paperSize,
        sides: job.sides,
        copies: job.copies,
        pageRange: job.pageRange,
        totalPages: job.totalPages,
        totalPrice: job.totalPrice,
        createdAt: job.createdAt.toISOString(),
        file: {
          id: job.file.id,
          originalName: job.file.originalName,
          pageCount: job.file.pageCount,
        },
        kiosk: job.kiosk ? {
          id: job.kiosk.id,
          displayId: job.kiosk.displayId,
          name: job.kiosk.name,
          location: job.kiosk.location,
        } : null,
      },
    });
  } catch (error) {
    console.error('Job creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create job' });
  }
});

// Get job status
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const job = await prisma.printJob.findFirst({
      where: {
        OR: [{ id: req.params.id }, { displayId: req.params.id }],
      },
      include: {
        file: true,
        kiosk: true,
        payment: true,
        printCode: true,
      },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({
      success: true,
      data: {
        id: job.id,
        displayId: job.displayId,
        status: job.status,
        printMethod: job.printMethod,
        colorMode: job.colorMode,
        paperSize: job.paperSize,
        sides: job.sides,
        copies: job.copies,
        pageRange: job.pageRange,
        totalPages: job.totalPages,
        totalPrice: job.totalPrice,
        currentPage: job.currentPage,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() || null,
        file: {
          id: job.file.id,
          originalName: job.file.originalName,
          pageCount: job.file.pageCount,
        },
        kiosk: job.kiosk ? {
          displayId: job.kiosk.displayId,
          name: job.kiosk.name,
          location: job.kiosk.location,
        } : null,
        payment: job.payment ? {
          status: job.payment.status,
          amount: job.payment.amount,
          currency: job.payment.currency,
        } : null,
        printCode: job.printCode ? {
          status: job.printCode.status,
          expiresAt: job.printCode.expiresAt.toISOString(),
          usedAt: job.printCode.usedAt?.toISOString() || null,
          remainingSeconds: Math.max(0, Math.floor((job.printCode.expiresAt.getTime() - Date.now()) / 1000)),
        } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get job' });
  }
});

// Update job status (for kiosk use)
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { status, currentPage, errorMessage } = req.body;

    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id: req.params.id }, { displayId: req.params.id }] },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const updateData: any = { status };
    if (currentPage !== undefined) updateData.currentPage = currentPage;
    if (errorMessage) updateData.errorMessage = errorMessage;
    if (status === 'COMPLETED') updateData.completedAt = new Date();

    const updated = await prisma.printJob.update({
      where: { id: job.id },
      data: updateData,
    });

    // Notify customer via WebSocket (both session room and broadcast)
    io.to(`session:${job.sessionId}`).emit('job_update', {
      type: 'JOB_UPDATE',
      jobId: job.id,
      displayId: job.displayId,
      status,
      currentPage,
      totalPages: job.totalPages,
    });
    io.emit('job_update', {
      type: 'JOB_UPDATE',
      jobId: job.id,
      displayId: job.displayId,
      status,
      currentPage,
      totalPages: job.totalPages,
    });

    // If completed, mark print code as used
    if (status === 'COMPLETED') {
      await prisma.printCode.updateMany({
        where: { jobId: job.id, status: 'ACTIVE' },
        data: { status: 'USED', usedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          action: 'JOB_COMPLETED',
          entityType: 'PrintJob',
          entityId: job.id,
          kioskId: job.kioskId,
        },
      });
    }

    res.json({ success: true, data: { status: updated.status } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update job status' });
  }
});

// ── Execute print — downloads file and sends to SavaPage ──
router.post('/:id/print', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const storage = req.app.locals.storage;
    const printer = req.app.locals.printer;
    const io = req.app.locals.io;

    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id: req.params.id }, { displayId: req.params.id }] },
      include: { file: true, kiosk: { include: { printer: true } } },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (job.status !== 'SENDING' && job.status !== 'QUEUED' && job.status !== 'PAID' && job.status !== 'PRINTING') {
      return res.status(400).json({ success: false, error: `Cannot print job in status: ${job.status}` });
    }

    // Get file path for printing (zero-copy if available locally)
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    let tempFilePath = typeof storage.getLocalFilePath === 'function'
      ? storage.getLocalFilePath(job.file.storageKey)
      : null;

    if (!tempFilePath || !fs.existsSync(tempFilePath)) {
      const tempDir = path.join(os.tmpdir(), 'xpos-print');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const safeBaseName = path.basename(job.file.originalName, path.extname(job.file.originalName)).replace(/[^a-zA-Z0-9_-]/g, '_');
      tempFilePath = path.join(tempDir, `${job.id}_${safeBaseName}.pdf`);
      const fileBuffer = await storage.downloadFile(job.file.storageKey);
      fs.writeFileSync(tempFilePath, fileBuffer);
      console.log(`📥 Downloaded "${job.file.originalName}" to temp path: "${tempFilePath}"`);
    } else {
      console.log(`⚡ Direct fast-print path used: "${tempFilePath}"`);
    }

    // Determine target printer name (request body -> kiosk assigned printer -> default physical)
    let targetPrinterName = req.body.printerName || job.kiosk?.printer?.name || undefined;
    if (
      !targetPrinterName ||
      targetPrinterName.toLowerCase().includes('detecting') ||
      targetPrinterName === 'Default Printer' ||
      targetPrinterName === 'Auto-Detected Printer'
    ) {
      const defaultPrinter = await printer.getDefaultPrinter?.();
      if (defaultPrinter?.name) {
        targetPrinterName = defaultPrinter.name;
      }
    }

    // Update status to PRINTING
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: 'PRINTING' },
    });

    io.to(`session:${job.sessionId}`).emit('job_update', {
      type: 'JOB_UPDATE',
      jobId: job.id,
      displayId: job.displayId,
      status: 'PRINTING',
      currentPage: 0,
      totalPages: job.totalPages * (job.copies || 1),
    });

    if (job.kioskId) {
      io.to(`kiosk:${job.kioskId}`).emit('job_progress', {
        jobId: job.id,
        currentPage: 0,
        totalPages: job.totalPages * (job.copies || 1),
        printerName: targetPrinterName,
      });
      if (job.kiosk?.displayId) {
        io.to(`kiosk:${job.kiosk.displayId}`).emit('job_progress', {
          jobId: job.id,
          currentPage: 0,
          totalPages: job.totalPages * (job.copies || 1),
          printerName: targetPrinterName,
        });
      }
    }

    // Submit to physical hardware printer via WindowsPrinterService / SumatraPDF
    const printResult = await printer.submitPrintJob({
      filePath: tempFilePath,
      printerName: targetPrinterName,
      colorMode: job.colorMode,
      paperSize: job.paperSize,
      sides: job.sides,
      copies: job.copies || 1,
      pageRange: job.pageRange || undefined,
      totalPages: job.totalPages,
    });

    console.log(`🖨️ Print job submitted: ${printResult.jobId} (status: ${printResult.status}) to "${targetPrinterName}"`);

    if (printResult.status === 'FAILED') {
      await prisma.printJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: printResult.error || 'Printer error' },
      });
      io.to(`session:${job.sessionId}`).emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: job.id,
        displayId: job.displayId,
        status: 'FAILED',
        error: printResult.error,
      });
      if (job.kioskId) {
        io.to(`kiosk:${job.kioskId}`).emit('job_failed', {
          jobId: job.id,
          error: printResult.error || 'Failed to print document',
        });
      }
      return res.status(500).json({ success: false, error: printResult.error || 'Failed to print document' });
    }

    // Listen for progress events from the printer service
    const onProgress = (data: any) => {
      if (data.jobId === printResult.jobId) {
        prisma.printJob.update({
          where: { id: job.id },
          data: { currentPage: data.currentPage, status: 'PRINTING' },
        }).catch(() => {});

        io.to(`session:${job.sessionId}`).emit('job_update', {
          type: 'JOB_UPDATE',
          jobId: job.id,
          displayId: job.displayId,
          status: 'PRINTING',
          currentPage: data.currentPage,
          totalPages: data.totalPages,
        });

        // Also notify kiosk
        if (job.kioskId) {
          io.to(`kiosk:${job.kioskId}`).emit('job_progress', {
            jobId: job.id,
            currentPage: data.currentPage,
            totalPages: data.totalPages,
          });
        }
        if (job.kiosk?.displayId && job.kiosk.displayId !== job.kioskId) {
          io.to(`kiosk:${job.kiosk.displayId}`).emit('job_progress', {
            jobId: job.id,
            currentPage: data.currentPage,
            totalPages: data.totalPages,
          });
        }
      }
    };

    const cleanupListeners = () => {
      printer.removeListener('progress', onProgress);
      printer.removeListener('completed', onCompleted);
      printer.removeListener('failed', onFailed);
    };

    const onFailed = (data: any) => {
      if (data.jobId === printResult.jobId) {
        console.error(`❌ [jobRoutes] Physical print failed for job ${job.id}:`, data.error);
        cleanupListeners();

        prisma.printJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: data.error || 'Physical print failed' },
        }).catch(() => {});

        io.to(`session:${job.sessionId}`).emit('job_update', {
          type: 'JOB_UPDATE',
          jobId: job.id,
          displayId: job.displayId,
          status: 'FAILED',
          error: data.error || 'Printer error',
        });

        io.to('admin').emit('job_updated', {
          id: job.id,
          displayId: job.displayId,
          status: 'FAILED',
          error: data.error,
        });

        if (job.kioskId) {
          io.to(`kiosk:${job.kioskId}`).emit('job_failed', {
            jobId: job.id,
            error: data.error || 'Physical printer failed to produce page',
          });
        }
        if (job.kiosk?.displayId && job.kiosk.displayId !== job.kioskId) {
          io.to(`kiosk:${job.kiosk.displayId}`).emit('job_failed', {
            jobId: job.id,
            error: data.error || 'Physical printer failed to produce page',
          });
        }
      }
    };

    const onCompleted = (data: any) => {
      if (data.jobId === printResult.jobId) {
        cleanupListeners();
        const completedDate = new Date();
        Promise.all([
          prisma.printJob.update({
            where: { id: job.id },
            data: { status: 'COMPLETED', completedAt: completedDate, currentPage: data.totalPages },
          }),
          prisma.printCode.updateMany({
            where: { jobId: job.id },
            data: { status: 'USED', usedAt: completedDate },
          }),
        ]).catch((err) => console.error('Completion sync error:', err));

        io.to(`session:${job.sessionId}`).emit('job_update', {
          type: 'JOB_UPDATE',
          jobId: job.id,
          displayId: job.displayId,
          status: 'COMPLETED',
          currentPage: data.totalPages,
          totalPages: data.totalPages,
        });

        // Notify Admin Portal in Real Time
        io.to('admin').emit('job_updated', {
          id: job.id,
          displayId: job.displayId,
          status: 'COMPLETED',
          completedAt: completedDate.toISOString(),
          currentPage: data.totalPages,
          totalPages: data.totalPages,
        });

        if (job.kioskId) {
          io.to(`kiosk:${job.kioskId}`).emit('job_completed', { jobId: job.id });
        }
        if (job.kiosk?.displayId && job.kiosk.displayId !== job.kioskId) {
          io.to(`kiosk:${job.kiosk.displayId}`).emit('job_completed', { jobId: job.id });
        }

        // Immediate Privacy Cleanup: Delete document from storage & temp cache
        try {
          if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch {}

        // Delete from cloud / local storage
        if (job.file?.storageKey) {
          storage.deleteFile(job.file.storageKey).then(() => {
            console.log(`🔒 [Privacy & Storage] Deleted "${job.file.originalName}" (${job.file.storageKey}) immediately after printing.`);
          }).catch(() => {});
        }
      }
    };

    printer.on('progress', onProgress);
    printer.on('completed', onCompleted);
    printer.on('failed', onFailed);

    res.json({
      success: true,
      data: {
        printJobId: printResult.jobId,
        printerName: targetPrinterName,
        status: printResult.status,
        message: 'Print job submitted to printer',
      },
    });
  } catch (error) {
    console.error('Print execution error:', error);
    res.status(500).json({ success: false, error: 'Failed to execute print job' });
  }
});

export { router as jobRoutes };
