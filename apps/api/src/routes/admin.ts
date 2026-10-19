// ============================================================
// Super Admin & Fleet Management Control Center Endpoints
// ============================================================

import { Router, Request, Response } from 'express';

const router = Router();

// ── 1. Dashboard Stats ──
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalJobsToday,
      completedJobsToday,
      failedJobsToday,
      cancelledJobsToday,
      revenueToday,
      allTimeRevenue,
      totalKiosks,
      activeKiosks,
      totalPagesToday,
      activeCodesCount,
      kiosksWithStats,
      globalRules,
    ] = await Promise.all([
      prisma.printJob.count({ where: { createdAt: { gte: today } } }),
      prisma.printJob.count({ where: { status: 'COMPLETED', createdAt: { gte: today } } }),
      prisma.printJob.count({ where: { status: 'FAILED', createdAt: { gte: today } } }),
      prisma.printJob.count({ where: { status: 'CANCELLED', createdAt: { gte: today } } }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID', createdAt: { gte: today } },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID' },
      }),
      prisma.kiosk.count(),
      prisma.kiosk.count({ where: { status: 'ACTIVE' } }),
      prisma.printJob.aggregate({
        _sum: { totalPages: true },
        where: { status: 'COMPLETED', createdAt: { gte: today } },
      }),
      prisma.printCode.count({ where: { status: 'ACTIVE' } }),
      prisma.kiosk.findMany({
        include: {
          printer: true,
          printJobs: {
            where: { status: 'COMPLETED' },
            include: { payment: true },
          },
        },
        orderBy: { displayId: 'asc' },
      }),
      prisma.pricingRule.findMany({ where: { isActive: true } }),
    ]);

    const defaultBw = globalRules.find((r: any) => r.colorMode === 'BW')?.pricePerPage || 2;
    const defaultColor = globalRules.find((r: any) => r.colorMode === 'COLOR')?.pricePerPage || 10;

    const kioskBreakdown = kiosksWithStats.map((k: any) => {
      let custom: any = null;
      if (k.deviceTokenHash) {
        try { custom = JSON.parse(k.deviceTokenHash); } catch {}
      }

      const completedJobs = k.printJobs || [];
      const totalRevenue = completedJobs.reduce((sum: number, j: any) => sum + (j.payment?.amount || j.totalPrice || 0), 0);
      const todayJobs = completedJobs.filter((j: any) => new Date(j.createdAt) >= today);
      const todayRevenue = todayJobs.reduce((sum: number, j: any) => sum + (j.payment?.amount || j.totalPrice || 0), 0);
      const totalPages = completedJobs.reduce((sum: number, j: any) => sum + (j.totalPages || 0), 0);

      return {
        id: k.id,
        displayId: k.displayId,
        name: k.name,
        location: k.location,
        status: k.status,
        printerStatus: k.printer?.status || 'READY',
        printerName: k.printer?.name || 'Auto-Detected Printer',
        totalJobs: completedJobs.length,
        todayJobs: todayJobs.length,
        totalRevenue,
        todayRevenue,
        totalPages,
        bwPrice: typeof custom?.bwPrice === 'number' ? custom.bwPrice : defaultBw,
        colorPrice: typeof custom?.colorPrice === 'number' ? custom.colorPrice : defaultColor,
        isCustomPricing: Boolean(custom?.bwPrice || custom?.colorPrice),
      };
    });

    res.json({
      success: true,
      data: {
        today: {
          revenue: revenueToday._sum.amount || 0,
          allTimeRevenue: allTimeRevenue._sum.amount || 0,
          printJobs: totalJobsToday,
          pages: totalPagesToday._sum.totalPages || 0,
          successful: completedJobsToday,
          failed: failedJobsToday,
          cancelled: cancelledJobsToday,
          activeCodes: activeCodesCount,
        },
        kiosks: {
          total: totalKiosks,
          online: activeKiosks,
        },
        kioskBreakdown,
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get dashboard data' });
  }
});

// ── 2. List All Jobs with Detailed Filters & Search ──
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { status, printMethod, kioskId, search, page = '1', limit = '50' } = req.query;

    const where: any = {};
    if (status && status !== 'ALL') where.status = status;
    if (printMethod && printMethod !== 'ALL') where.printMethod = printMethod;
    if (kioskId && kioskId !== 'ALL') {
      where.OR = [{ kioskId }, { kiosk: { displayId: kioskId as string } }];
    }
    if (search) {
      where.OR = [
        { displayId: { contains: String(search), mode: 'insensitive' } },
        { file: { originalName: { contains: String(search), mode: 'insensitive' } } },
        { printCode: { qrToken: { contains: String(search) } } },
      ];
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [jobs, total] = await Promise.all([
      prisma.printJob.findMany({
        where,
        include: {
          file: true,
          kiosk: true,
          payment: true,
          printCode: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.printJob.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        jobs: jobs.map((j: any) => ({
          id: j.id,
          displayId: j.displayId,
          status: j.status,
          printMethod: j.printMethod,
          colorMode: j.colorMode,
          copies: j.copies,
          totalPages: j.totalPages,
          totalPrice: j.totalPrice,
          sides: j.sides,
          printCode: j.printCode?.qrToken || null,
          printCodeStatus: j.printCode?.status || null,
          printCodeExpiresAt: j.printCode?.expiresAt?.toISOString() || null,
          fileName: j.file?.originalName,
          fileSize: j.file?.sizeBytes,
          kioskId: j.kiosk?.id || null,
          kioskDisplayId: j.kiosk?.displayId || null,
          kioskName: j.kiosk?.displayId || j.kiosk?.name || null,
          kioskLocation: j.kiosk?.location || null,
          paymentStatus: j.payment?.status,
          paymentAmount: j.payment?.amount,
          paymentOrderId: j.payment?.orderId,
          createdAt: j.createdAt.toISOString(),
          completedAt: j.completedAt?.toISOString(),
        })),
        pagination: {
          total,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          pages: Math.ceil(total / parseInt(limit as string)),
        },
      },
    });
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({ success: false, error: 'Failed to list jobs' });
  }
});

// ── 3. Cancel Print Job & Invalidate Code ──
router.post('/jobs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;
    const { reason = 'Cancelled by Administrator' } = req.body;

    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
      include: { printCode: true },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Update job to CANCELLED
    const updatedJob = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: 'CANCELLED',
        errorMessage: reason,
      },
    });

    // Invalidate code
    if (job.printCode) {
      await prisma.printCode.update({
        where: { id: job.printCode.id },
        data: { status: 'CANCELLED' },
      });
    }

    // Broadcast update
    if (io) {
      io.to(`session:${job.sessionId}`).emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: job.id,
        displayId: job.displayId,
        status: 'CANCELLED',
        error: reason,
      });
      io.emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: job.id,
        displayId: job.displayId,
        status: 'CANCELLED',
        error: reason,
      });
      io.to('admin').emit('job_updated', {
        id: job.id,
        displayId: job.displayId,
        status: 'CANCELLED',
      });
    }

    res.json({ success: true, message: `Job ${job.displayId} cancelled successfully`, data: updatedJob });
  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel job' });
  }
});

// ── Restore / Reactivate Cancelled Job ──
router.post('/jobs/:id/restore', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;

    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
      include: { printCode: true },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Reactivate job back to QUEUED
    const updatedJob = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: 'QUEUED',
        errorMessage: null,
      },
    });

    // Reactivate code and ensure +24h validity
    if (job.printCode) {
      await prisma.printCode.update({
        where: { id: job.printCode.id },
        data: {
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    // Broadcast live restoration
    if (io) {
      io.to(`session:${job.sessionId}`).emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: job.id,
        displayId: job.displayId,
        status: 'QUEUED',
      });
      io.emit('job_update', {
        type: 'JOB_UPDATE',
        jobId: job.id,
        displayId: job.displayId,
        status: 'QUEUED',
      });
      io.to('admin').emit('job_updated', {
        id: job.id,
        displayId: job.displayId,
        status: 'QUEUED',
      });
    }

    res.json({ success: true, message: `Job ${job.displayId} restored to active queue!`, data: updatedJob });
  } catch (error) {
    console.error('Restore job error:', error);
    res.status(500).json({ success: false, error: 'Failed to restore job' });
  }
});

// ── 4. Revoke Print Code ──
router.post('/codes/:id/revoke', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;

    const code = await prisma.printCode.findFirst({
      where: { OR: [{ id }, { qrToken: id }, { jobId: id }] },
      include: { job: true },
    });

    if (!code) {
      return res.status(404).json({ success: false, error: 'Code not found' });
    }

    await prisma.printCode.update({
      where: { id: code.id },
      data: { status: 'REVOKED' },
    });

    if (code.job) {
      await prisma.printJob.update({
        where: { id: code.job.id },
        data: { status: 'CANCELLED', errorMessage: 'Print code revoked by administrator' },
      });

      if (io) {
        io.to(`session:${code.job.sessionId}`).emit('job_update', {
          jobId: code.job.id,
          displayId: code.job.displayId,
          status: 'CANCELLED',
        });
      }
    }

    res.json({ success: true, message: `Code ${code.qrToken} revoked` });
  } catch (error) {
    console.error('Revoke code error:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke code' });
  }
});

// ── 5. Extend Print Code Expiration (+24 Hours) ──
router.post('/codes/:id/extend', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { id } = req.params;
    const { hours = 24 } = req.body;

    const code = await prisma.printCode.findFirst({
      where: { OR: [{ id }, { qrToken: id }, { jobId: id }] },
    });

    if (!code) {
      return res.status(404).json({ success: false, error: 'Code not found' });
    }

    const newExpiry = new Date(Math.max(Date.now(), code.expiresAt.getTime()) + hours * 3600 * 1000);

    const updated = await prisma.printCode.update({
      where: { id: code.id },
      data: {
        expiresAt: newExpiry,
        status: 'ACTIVE',
      },
    });

    res.json({ success: true, message: `Code validity extended by ${hours} hours`, data: updated });
  } catch (error) {
    console.error('Extend code error:', error);
    res.status(500).json({ success: false, error: 'Failed to extend code' });
  }
});

// ── Delete Print Job Permanently ──
router.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { id } = req.params;

    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Delete associated print code and job
    await prisma.printCode.deleteMany({ where: { jobId: job.id } });
    await prisma.printJob.delete({ where: { id: job.id } });

    res.json({ success: true, message: `Job ${job.displayId} permanently deleted` });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete job' });
  }
});

// ── 6. Emergency Stop & Flush Queue ──
router.post('/queue/flush', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;

    const pendingJobs = await prisma.printJob.findMany({
      where: { status: { in: ['QUEUED', 'SENDING', 'PRINTING'] } },
    });

    await prisma.printJob.updateMany({
      where: { status: { in: ['QUEUED', 'SENDING', 'PRINTING'] } },
      data: { status: 'CANCELLED', errorMessage: 'Queue flushed by Emergency Administrator Stop' },
    });

    await prisma.printCode.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    if (io) {
      io.emit('emergency_stop', { message: 'All printing jobs flushed by Administrator' });
      io.emit('job_update', { status: 'CANCELLED' });
    }

    res.json({ success: true, message: `Flushed ${pendingJobs.length} active jobs from the queue` });
  } catch (error) {
    console.error('Flush queue error:', error);
    res.status(500).json({ success: false, error: 'Failed to flush queue' });
  }
});

// ── 7. Kiosk Fleet Management ──
router.get('/kiosks', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const [kiosks, globalRules] = await Promise.all([
      prisma.kiosk.findMany({
        include: {
          printer: true,
          _count: { select: { printJobs: true } },
        },
        orderBy: { displayId: 'asc' },
      }),
      prisma.pricingRule.findMany({ where: { isActive: true } }),
    ]);

    const defaultBw = globalRules.find((r: any) => r.colorMode === 'BW')?.pricePerPage || 2;
    const defaultColor = globalRules.find((r: any) => r.colorMode === 'COLOR')?.pricePerPage || 10;

    res.json({
      success: true,
      data: kiosks.map((k: any) => {
        let custom: any = null;
        if (k.deviceTokenHash) {
          try { custom = JSON.parse(k.deviceTokenHash); } catch {}
        }
        return {
          id: k.id,
          displayId: k.displayId,
          name: k.name,
          location: k.location,
          status: k.status,
          printerStatus: k.printer?.status || 'READY',
          printerName: k.printer?.name || 'Auto-Detected Printer',
          totalJobsServed: k._count?.printJobs || 0,
          lastHeartbeat: k.lastHeartbeat?.toISOString() || new Date().toISOString(),
          isOnline: k.status === 'ACTIVE',
          paperLevel: k.paperLevel ?? 85,
          tonerLevel: k.tonerLevel ?? 92,
          cpu: k.cpu || 14,
          ram: k.ram || 38,
          disk: k.disk || 45,
          appVersion: k.appVersion || 'v2.4.0-cloud',
          bwPrice: typeof custom?.bwPrice === 'number' ? custom.bwPrice : defaultBw,
          colorPrice: typeof custom?.colorPrice === 'number' ? custom.colorPrice : defaultColor,
          isCustomPricing: Boolean(custom && (typeof custom.bwPrice === 'number' || typeof custom.colorPrice === 'number')),
        };
      }),
    });
  } catch (error) {
    console.error('List kiosks error:', error);
    res.status(500).json({ success: false, error: 'Failed to list kiosks' });
  }
});

// Create new Kiosk Station
router.post('/kiosks', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { displayId, name, location, printerName = 'Default Printer', bwPrice, colorPrice } = req.body;

    if (!displayId) {
      return res.status(400).json({ success: false, error: 'Kiosk Station ID required (e.g. XPOS-002)' });
    }

    const cleanDisplayId = displayId.trim().toUpperCase();
    const existing = await prisma.kiosk.findUnique({ where: { displayId: cleanDisplayId } });
    if (existing) {
      return res.status(400).json({ success: false, error: `Kiosk ID "${cleanDisplayId}" already exists` });
    }

    let deviceTokenHash: string | null = null;
    if (bwPrice !== undefined && bwPrice !== '' || colorPrice !== undefined && colorPrice !== '') {
      deviceTokenHash = JSON.stringify({
        ...(bwPrice !== undefined && bwPrice !== '' ? { bwPrice: Number(bwPrice) } : {}),
        ...(colorPrice !== undefined && colorPrice !== '' ? { colorPrice: Number(colorPrice) } : {}),
      });
    }

    const kiosk = await prisma.kiosk.create({
      data: {
        displayId: cleanDisplayId,
        name: name?.trim() || `XPOS Station ${cleanDisplayId}`,
        location: location?.trim() || 'Main Campus',
        status: 'ACTIVE',
        deviceTokenHash,
        printer: {
          create: {
            name: printerName || 'Default Printer',
            model: 'Auto-Detected Printer',
            status: 'READY',
          },
        },
      },
      include: { printer: true, _count: { select: { printJobs: true } } },
    });

    if (io) {
      io.emit('kiosks_updated', { type: 'CREATED', kiosk });
      io.to('admin').emit('kiosk_updated');
    }

    res.json({ success: true, message: `Kiosk ${kiosk.displayId} created`, data: kiosk });
  } catch (error: any) {
    console.error('Create kiosk error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create kiosk' });
  }
});

// Update Kiosk Details (Name, Location, Display ID, Status, Printer, Custom Rates)
router.put('/kiosks/:id', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;
    const { displayId, name, location, status, printerName, bwPrice, colorPrice } = req.body;

    const existingKiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
      include: { printer: true },
    });

    if (!existingKiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    // Check displayId uniqueness if changing
    if (displayId && displayId.trim().toUpperCase() !== existingKiosk.displayId) {
      const duplicate = await prisma.kiosk.findUnique({
        where: { displayId: displayId.trim().toUpperCase() },
      });
      if (duplicate) {
        return res.status(400).json({ success: false, error: `Kiosk ID "${displayId.trim().toUpperCase()}" is already in use` });
      }
    }

    const updateData: any = {};
    if (displayId) updateData.displayId = displayId.trim().toUpperCase();
    if (name !== undefined) updateData.name = name.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (status) updateData.status = status;

    if (bwPrice !== undefined || colorPrice !== undefined) {
      let existingCustom: any = {};
      if (existingKiosk.deviceTokenHash) {
        try { existingCustom = JSON.parse(existingKiosk.deviceTokenHash); } catch {}
      }
      if (bwPrice !== undefined) {
        if (bwPrice === null || bwPrice === '') {
          delete existingCustom.bwPrice;
        } else {
          existingCustom.bwPrice = Number(bwPrice);
        }
      }
      if (colorPrice !== undefined) {
        if (colorPrice === null || colorPrice === '') {
          delete existingCustom.colorPrice;
        } else {
          existingCustom.colorPrice = Number(colorPrice);
        }
      }
      updateData.deviceTokenHash = Object.keys(existingCustom).length > 0 ? JSON.stringify(existingCustom) : null;
    }

    await prisma.kiosk.update({
      where: { id: existingKiosk.id },
      data: updateData,
    });

    if (printerName !== undefined && existingKiosk.printer) {
      await prisma.printer.update({
        where: { id: existingKiosk.printer.id },
        data: { name: printerName.trim() },
      });
    } else if (printerName !== undefined && !existingKiosk.printer) {
      await prisma.printer.create({
        data: {
          name: printerName.trim(),
          kioskId: existingKiosk.id,
          status: 'READY',
        },
      });
    }

    const reloaded = await prisma.kiosk.findUnique({
      where: { id: existingKiosk.id },
      include: { printer: true, _count: { select: { printJobs: true } } },
    });

    if (io) {
      io.emit('kiosks_updated', { type: 'UPDATED', kiosk: reloaded });
      io.to(`kiosk:${existingKiosk.id}`).emit('kiosk_details_updated', reloaded);
      io.to(`kiosk:${existingKiosk.displayId}`).emit('kiosk_details_updated', reloaded);
      if (updateData.deviceTokenHash !== undefined) {
        let custom: any = null;
        try { custom = JSON.parse(updateData.deviceTokenHash || '{}'); } catch {}
        io.emit('pricing_updated', {
          kioskId: existingKiosk.id,
          kioskDisplayId: existingKiosk.displayId,
          bwPrice: custom?.bwPrice,
          colorPrice: custom?.colorPrice,
        });
        io.to(`kiosk:${existingKiosk.id}`).emit('pricing_updated', {
          kioskId: existingKiosk.id,
          kioskDisplayId: existingKiosk.displayId,
          bwPrice: custom?.bwPrice,
          colorPrice: custom?.colorPrice,
        });
        io.to(`kiosk:${existingKiosk.displayId}`).emit('pricing_updated', {
          kioskId: existingKiosk.id,
          kioskDisplayId: existingKiosk.displayId,
          bwPrice: custom?.bwPrice,
          colorPrice: custom?.colorPrice,
        });
      }
      if (status) {
        io.to(`kiosk:${existingKiosk.id}`).emit('status_change', { status });
        io.to(`kiosk:${existingKiosk.displayId}`).emit('status_change', { status });
      }
      io.to('admin').emit('kiosk_updated');
    }

    res.json({ success: true, message: `Kiosk ${reloaded?.displayId} updated successfully`, data: reloaded });
  } catch (error: any) {
    console.error('Update kiosk error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update kiosk' });
  }
});

// Toggle Kiosk Maintenance / Status
router.patch('/kiosks/:id/status', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;
    const { status } = req.body;

    const existingKiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
      include: { printer: true },
    });

    if (!existingKiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    const kiosk = await prisma.kiosk.update({
      where: { id: existingKiosk.id },
      data: { status },
      include: { printer: true, _count: { select: { printJobs: true } } },
    });

    if (io) {
      io.emit('kiosks_updated', { type: 'STATUS_CHANGED', kiosk });
      io.to(`kiosk:${kiosk.id}`).emit('status_change', { status: kiosk.status });
      io.to(`kiosk:${kiosk.displayId}`).emit('status_change', { status: kiosk.status });
      io.to('admin').emit('kiosk_updated');
    }

    res.json({ success: true, message: `Kiosk ${kiosk.displayId} status changed to ${status}`, data: kiosk });
  } catch (error) {
    console.error('Update kiosk status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update kiosk status' });
  }
});

// Delete Kiosk Station Permanently
router.delete('/kiosks/:id', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;

    const kiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
    });

    if (!kiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    await prisma.printer.deleteMany({ where: { kioskId: kiosk.id } });
    await prisma.kiosk.delete({ where: { id: kiosk.id } });

    if (io) {
      io.emit('kiosks_updated', { type: 'DELETED', id: kiosk.id, displayId: kiosk.displayId });
      io.to('admin').emit('kiosk_updated');
    }

    res.json({ success: true, message: `Kiosk ${kiosk.displayId} deleted successfully` });
  } catch (error: any) {
    console.error('Delete kiosk error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete kiosk' });
  }
});

// Remote Reboot Kiosk
router.post('/kiosks/:id/reboot', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { id } = req.params;

    const kiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ id }, { displayId: id }] },
    });

    if (io) {
      if (kiosk) {
        io.to(`kiosk:${kiosk.id}`).emit('system_reboot', { timestamp: new Date().toISOString() });
        io.to(`kiosk:${kiosk.displayId}`).emit('system_reboot', { timestamp: new Date().toISOString() });
      }
      io.to(`kiosk:${id}`).emit('system_reboot', { timestamp: new Date().toISOString() });
      io.emit('system_reboot', { kioskId: kiosk?.id || id, displayId: kiosk?.displayId || id });
    }

    res.json({ success: true, message: `Reboot signal sent to Kiosk ${kiosk?.displayId || id}` });
  } catch (error) {
    console.error('Reboot kiosk error:', error);
    res.status(500).json({ success: false, error: 'Failed to reboot kiosk' });
  }
});

// ── 8. Update Pricing Rules ──
router.put('/pricing', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { rules } = req.body;

    if (Array.isArray(rules)) {
      for (const r of rules) {
        await prisma.pricingRule.upsert({
          where: { paperSize_colorMode: { paperSize: r.paperSize, colorMode: r.colorMode } },
          update: { pricePerPage: Number(r.pricePerPage), isActive: true },
          create: { paperSize: r.paperSize, colorMode: r.colorMode, pricePerPage: Number(r.pricePerPage), isActive: true },
        });
      }
    } else {
      const { paperSize = 'A4', colorMode, pricePerPage } = req.body;
      await prisma.pricingRule.upsert({
        where: { paperSize_colorMode: { paperSize, colorMode } },
        update: { pricePerPage: Number(pricePerPage), isActive: true },
        create: { paperSize, colorMode, pricePerPage: Number(pricePerPage), isActive: true },
      });
    }

    const allRules = await prisma.pricingRule.findMany({
      where: { isActive: true },
      orderBy: [{ paperSize: 'asc' }, { colorMode: 'asc' }],
    });

    if (io) {
      io.emit('pricing_updated', { rules: allRules });
      io.to('admin').emit('pricing_updated', { rules: allRules });
    }

    res.json({ success: true, message: 'Pricing updated successfully', data: allRules });
  } catch (error) {
    console.error('Update pricing error:', error);
    res.status(500).json({ success: false, error: 'Failed to update pricing' });
  }
});

// ── 9. Audit Logs Feed ──
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ success: false, error: 'Failed to get audit logs' });
  }
});

export { router as adminRoutes };
