// ============================================================
// Pricing — Price calculation and rules
// Handles Single-Sided, Double-Sided (Duplex), B&W, and Color
// ============================================================

import { Router, Request, Response } from 'express';
import { countPagesInRange } from '@xpos/document';

const router = Router();

// Get current pricing rules (Global or Kiosk-Specific)
router.get('/', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const kioskQuery = (req.query.kioskId || req.query.kiosk) as string | undefined;

    const globalRules = await prisma.pricingRule.findMany({
      where: { isActive: true },
      orderBy: [{ paperSize: 'asc' }, { colorMode: 'asc' }],
    });

    if (kioskQuery) {
      const kiosk = await prisma.kiosk.findFirst({
        where: { OR: [{ id: kioskQuery }, { displayId: kioskQuery }] },
      });

      if (kiosk?.deviceTokenHash) {
        try {
          const custom = JSON.parse(kiosk.deviceTokenHash);
          if (custom && typeof custom === 'object') {
            const kioskRules = globalRules.map((r: any) => {
              if (r.colorMode === 'BW' && typeof custom.bwPrice === 'number') {
                return { ...r, pricePerPage: custom.bwPrice, isKioskCustom: true, kioskId: kiosk.displayId };
              }
              if (r.colorMode === 'COLOR' && typeof custom.colorPrice === 'number') {
                return { ...r, pricePerPage: custom.colorPrice, isKioskCustom: true, kioskId: kiosk.displayId };
              }
              return r;
            });
            return res.json({ success: true, data: kioskRules, kioskId: kiosk.displayId, isCustom: true });
          }
        } catch {}
      }
    }

    res.json({ success: true, data: globalRules, isCustom: false });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get pricing' });
  }
});

// Calculate price for a print job (Supports Per-Kiosk Pricing)
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { fileId, colorMode, paperSize = 'A4', sides = 'SINGLE', copies = 1, pageRange, kioskId } = req.body;

    if (!fileId || !colorMode) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Get file info
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Get pricing rule for paperSize + colorMode
    const rule = await prisma.pricingRule.findFirst({
      where: { paperSize, colorMode, isActive: true },
    });

    let basePricePerPage = rule ? rule.pricePerPage : (colorMode === 'BW' ? 2 : 10);

    // Check if kiosk has custom pricing
    if (kioskId) {
      const kiosk = await prisma.kiosk.findFirst({
        where: { OR: [{ id: kioskId }, { displayId: kioskId }] },
      });
      if (kiosk?.deviceTokenHash) {
        try {
          const custom = JSON.parse(kiosk.deviceTokenHash);
          if (custom && typeof custom === 'object') {
            if (colorMode === 'BW' && typeof custom.bwPrice === 'number') {
              basePricePerPage = custom.bwPrice;
            } else if (colorMode === 'COLOR' && typeof custom.colorPrice === 'number') {
              basePricePerPage = custom.colorPrice;
            }
          }
        } catch {}
      }
    }

    // Calculate effective pages from page range
    const printPages = Math.max(1, countPagesInRange(pageRange || null, file.pageCount));

    // Calculate physical sheets (2 pages per sheet for DOUBLE)
    const sheetsPerCopy = sides === 'DOUBLE' ? Math.ceil(printPages / 2) : printPages;
    const totalSheets = sheetsPerCopy * copies;

    let subtotal = 0;
    let breakdownText = '';

    if (sides === 'DOUBLE') {
      // Duplex discount pricing:
      // For BW: ₹3 per full 2-page duplex sheet (₹1.50/side), remaining odd page = ₹2
      // For Color: ₹18 per full 2-page duplex sheet (₹9/side), remaining odd page = ₹10
      const fullSheets = Math.floor(printPages / 2);
      const oddPage = printPages % 2; // 1 if odd, 0 if even

      const duplexSheetRate = colorMode === 'BW' ? Math.round(basePricePerPage * 1.5) : Math.round(basePricePerPage * 1.8);
      subtotal = (fullSheets * duplexSheetRate) + (oddPage * basePricePerPage);

      breakdownText = fullSheets > 0
        ? `${printPages} pages (${sheetsPerCopy} double-sided sheets) × ₹${duplexSheetRate}/sheet${oddPage ? ` + 1 single page ₹${basePricePerPage}` : ''} × ${copies} ${copies > 1 ? 'copies' : 'copy'} = ₹${subtotal * copies}`
        : `${printPages} page × ₹${basePricePerPage}/page × ${copies} copy = ₹${subtotal * copies}`;
    } else {
      // Single-sided: standard rate per page
      subtotal = printPages * basePricePerPage;
      breakdownText = `${printPages} pages × ₹${basePricePerPage}/page × ${copies} ${copies > 1 ? 'copies' : 'copy'} = ₹${subtotal * copies}`;
    }

    const total = subtotal * copies;

    res.json({
      success: true,
      data: {
        pages: printPages,
        totalPages: printPages * copies,
        copies,
        sheets: totalSheets,
        sheetsPerCopy,
        pricePerPage: basePricePerPage,
        subtotal,
        total,
        currency: 'INR',
        breakdown: breakdownText,
        colorMode,
        paperSize,
        sides,
      },
    });
  } catch (error) {
    console.error('Price calculation error:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate price' });
  }
});

export { router as pricingRoutes };
