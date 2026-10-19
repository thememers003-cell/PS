// ============================================================
// Kiosks — Kiosk listing and status endpoints
// ============================================================

import { Router, Request, Response } from 'express';
import * as QRCode from 'qrcode';

const router = Router();

// List all available kiosks
router.get('/', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const showAll = req.query.showAll === 'true';

    const kiosks = await prisma.kiosk.findMany({
      include: { printer: true },
      orderBy: { displayId: 'asc' },
    });

    const formatted = kiosks.map((k: any) => ({
      id: k.id,
      displayId: k.displayId,
      name: k.name,
      location: k.location,
      status: k.status,
      printerStatus: k.printer?.status || 'OFFLINE',
      qrUrl: k.qrUrl,
      lastHeartbeat: k.lastHeartbeat?.toISOString() || null,
      isOnline: k.lastHeartbeat
        ? Date.now() - new Date(k.lastHeartbeat).getTime() < 60000
        : false,
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Kiosk listing error:', error);
    res.status(500).json({ success: false, error: 'Failed to list kiosks' });
  }
});

// Create a new kiosk dynamically
router.post('/', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { displayId, name, location, printerName = 'Default Printer', colorCapabilities = ['BW', 'COLOR'] } = req.body;

    if (!displayId || !name || !location) {
      return res.status(400).json({ success: false, error: 'Kiosk ID, Name, and Location are required' });
    }

    const existing = await prisma.kiosk.findUnique({ where: { displayId } });
    if (existing) {
      return res.status(400).json({ success: false, error: `Kiosk with ID "${displayId}" already exists` });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qrUrl = `${appUrl}/remote?kiosk=${displayId}`;

    const kiosk = await prisma.kiosk.create({
      data: {
        displayId,
        name,
        location,
        status: 'ACTIVE',
        qrUrl,
        printer: {
          create: {
            name: printerName || 'Default Printer',
            model: 'Auto-Detected Printer',
            status: 'READY',
          },
        },
      },
      include: { printer: true },
    });

    const io = req.app.locals.io;
    if (io) {
      io.emit('kiosks_updated', { type: 'CREATED', kiosk });
      io.to('admin').emit('kiosk_updated');
    }

    res.json({
      success: true,
      data: {
        id: kiosk.id,
        displayId: kiosk.displayId,
        name: kiosk.name,
        location: kiosk.location,
        status: kiosk.status,
        printerStatus: kiosk.printer?.status || 'READY',
        qrUrl: kiosk.qrUrl,
        lastHeartbeat: null,
        isOnline: false,
      },
    });
  } catch (error) {
    console.error('Kiosk creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create kiosk' });
  }
});

// Get single kiosk details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const printerService = req.app.locals.printer;

    const kiosk = await prisma.kiosk.findFirst({
      where: {
        OR: [
          { id: req.params.id },
          { displayId: req.params.id },
        ],
      },
      include: { printer: true },
    });

    if (!kiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    let printerName = kiosk.printer?.name || null;
    let printerStatus = kiosk.printer?.status || 'READY';

    const isAutoDetect = !process.env.WINDOWS_PRINTER_NAME || process.env.WINDOWS_PRINTER_NAME.toLowerCase() === 'auto';

    // Auto-detect physical printer on host and assign to kiosk
    if (isAutoDetect || !printerName || printerName === 'Default Printer' || printerName === 'Auto-Detected Printer') {
      try {
        const detectedDefault = await printerService?.getDefaultPrinter?.();
        if (detectedDefault?.name && (isAutoDetect || !printerName || printerName === 'Default Printer' || printerName === 'Auto-Detected Printer')) {
          printerName = detectedDefault.name;
          printerStatus = detectedDefault.status || 'READY';
          // Persist detected printer
          await prisma.printer.upsert({
            where: { kioskId: kiosk.id },
            create: {
              kioskId: kiosk.id,
              name: printerName,
              model: printerName,
              status: printerStatus,
            },
            update: {
              name: printerName,
              model: printerName,
              status: printerStatus,
            },
          });
        }
      } catch (detErr) {
        console.warn('Auto printer detection in kiosk GET /:id:', detErr);
      }
    }

    res.json({
      success: true,
      data: {
        id: kiosk.id,
        displayId: kiosk.displayId,
        name: kiosk.name,
        location: kiosk.location,
        status: kiosk.status,
        printerStatus: printerStatus,
        printerName: printerName,
        qrUrl: kiosk.qrUrl,
        lastHeartbeat: kiosk.lastHeartbeat?.toISOString() || null,
        isOnline: kiosk.lastHeartbeat
          ? Date.now() - new Date(kiosk.lastHeartbeat).getTime() < 60000
          : false,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get kiosk details' });
  }
});

// Detect installed printers on host PC and auto-sync with this kiosk
router.get('/:id/detected-printers', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const printerService = req.app.locals.printer;
    const io = req.app.locals.io;

    let printers = [];
    if (printerService && typeof printerService.getPrinters === 'function') {
      printers = await printerService.getPrinters();
    }

    const defaultPrinter = (printerService && typeof printerService.getDefaultPrinter === 'function')
      ? await printerService.getDefaultPrinter()
      : null;

    const kiosk = await prisma.kiosk.findFirst({
      where: {
        OR: [{ id: req.params.id }, { displayId: req.params.id }],
      },
      include: { printer: true },
    });

    if (kiosk && defaultPrinter?.name) {
      const isAutoDetect = !process.env.WINDOWS_PRINTER_NAME || process.env.WINDOWS_PRINTER_NAME.toLowerCase() === 'auto';
      // Auto-assign detected hardware printer if auto-detection is enabled or kiosk has generic printer
      if (isAutoDetect || !kiosk.printer || kiosk.printer.name === 'Default Printer' || kiosk.printer.name === 'Auto-Detected Printer') {
        const assigned = await prisma.printer.upsert({
          where: { kioskId: kiosk.id },
          create: {
            kioskId: kiosk.id,
            name: defaultPrinter.name,
            model: defaultPrinter.name,
            status: 'READY',
          },
          update: {
            name: defaultPrinter.name,
            model: defaultPrinter.name,
            status: 'READY',
          },
        });

        if (io) {
          io.to(`kiosk:${kiosk.displayId}`).emit('printer_assigned', {
            printerName: defaultPrinter.name,
            status: 'READY',
          });
          io.to('admin').emit('kiosk_updated');
        }
      }
    }

    res.json({
      success: true,
      data: {
        printers,
        defaultPrinter,
        activePrinter: kiosk?.printer?.name || defaultPrinter?.name || 'Default Printer',
      },
    });
  } catch (error) {
    console.error('Failed to get detected printers:', error);
    res.status(500).json({ success: false, error: 'Failed to detect printers' });
  }
});

// Explicitly assign/change a detected printer to a kiosk
router.post('/:id/assign-printer', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const { printerName, model } = req.body;

    if (!printerName) {
      return res.status(400).json({ success: false, error: 'Printer name is required' });
    }

    const kiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ id: req.params.id }, { displayId: req.params.id }] },
      include: { printer: true },
    });

    if (!kiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    const updatedPrinter = await prisma.printer.upsert({
      where: { kioskId: kiosk.id },
      create: {
        kioskId: kiosk.id,
        name: printerName,
        model: model || printerName,
        status: 'READY',
      },
      update: {
        name: printerName,
        model: model || printerName,
        status: 'READY',
      },
    });

    if (io) {
      io.to(`kiosk:${kiosk.displayId}`).emit('printer_assigned', {
        printerName,
        status: 'READY',
      });
      io.to(`kiosk:${kiosk.id}`).emit('printer_assigned', {
        printerName,
        status: 'READY',
      });
      io.to('admin').emit('kiosk_updated');
    }

    res.json({ success: true, data: updatedPrinter });
  } catch (error) {
    console.error('Failed to assign printer:', error);
    res.status(500).json({ success: false, error: 'Failed to assign printer' });
  }
});

// Get QR code image for a kiosk
router.get('/:id/qr', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const kiosk = await prisma.kiosk.findFirst({
      where: {
        OR: [{ id: req.params.id }, { displayId: req.params.id }],
      },
    });

    if (!kiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qrUrl = `${appUrl}/print?kiosk=${kiosk.displayId}`;

    const qrImage = await QRCode.toDataURL(qrUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    res.json({ success: true, data: { qrImage, qrUrl, kioskId: kiosk.displayId } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// Kiosk heartbeat
router.post('/:id/heartbeat', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { cpu, ram, disk, internet, appVersion, printerStatus, currentJobId } = req.body;

    const kiosk = await prisma.kiosk.findFirst({
      where: {
        OR: [{ id: req.params.id }, { displayId: req.params.id }],
      },
    });

    if (!kiosk) {
      return res.status(404).json({ success: false, error: 'Kiosk not found' });
    }

    await prisma.kiosk.update({
      where: { id: kiosk.id },
      data: {
        lastHeartbeat: new Date(),
        cpu,
        ram,
        disk,
        appVersion,
      },
    });

    // Update printer status
    if (printerStatus) {
      await prisma.printer.updateMany({
        where: { kioskId: kiosk.id },
        data: {
          status: printerStatus,
          currentJobId: currentJobId || null,
        },
      });
    }

    res.json({ success: true, data: { acknowledged: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Heartbeat failed' });
  }
});

export { router as kioskRoutes };
