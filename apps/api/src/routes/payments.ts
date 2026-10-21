// ============================================================
// Payments — Payment creation and verification
// ============================================================

import { Router, Request, Response } from 'express';
import { createPaymentProvider } from '@xpos/payment';

const router = Router();

// Create a payment order
router.post('/create', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const payment = createPaymentProvider();
    const { jobId, redirectUrl: clientRedirectUrl } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, error: 'Job ID required' });
    }

    // Get job
    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id: jobId }, { displayId: jobId }] },
    });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Check if payment already exists
    const existingPayment = await prisma.payment.findUnique({ where: { jobId: job.id } });
    if (existingPayment && existingPayment.status === 'PAID') {
      return res.json({
        success: true,
        data: {
          paymentId: existingPayment.id,
          status: 'PAID',
          message: 'Payment already completed',
        },
      });
    }

    // Determine the frontend client URL for redirect
    let origin = req.headers.origin as string | undefined;
    if (!origin && req.headers.referer) {
      try {
        origin = new URL(req.headers.referer).origin;
      } catch {}
    }
    const redirectUrl = clientRedirectUrl || (origin ? `${origin}/code` : undefined);

    // Create payment order via provider
    const order = await payment.createOrder(job.totalPrice, 'INR', {
      jobId: job.id,
      displayId: job.displayId,
      ...(redirectUrl ? { redirectUrl } : {}),
    });

    // Store or update payment record idempotently
    const paymentRecord = await prisma.payment.upsert({
      where: { jobId: job.id },
      update: {
        amount: job.totalPrice,
        provider: payment.name,
        providerOrderId: order.orderId,
        qrData: order.qrData,
        status: 'PAYMENT_PENDING',
      },
      create: {
        jobId: job.id,
        amount: job.totalPrice,
        currency: 'INR',
        provider: payment.name,
        providerOrderId: order.orderId,
        qrData: order.qrData,
        status: 'PAYMENT_PENDING',
      },
    });

    // Update job status
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: 'PAYMENT_PENDING' },
    });

    const pgCheckoutUrl = (order as any).checkoutUrl ||
      ((order as any).gpayLink && String((order as any).gpayLink).startsWith('https://') ? (order as any).gpayLink : undefined) ||
      (order.qrData && order.qrData.startsWith('https://') ? order.qrData : undefined);

    res.json({
      success: true,
      data: {
        paymentId: paymentRecord.id,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        qrData: order.qrData,
        upiLink: order.upiLink,
        gpayLink: pgCheckoutUrl || order.upiLink,
        checkoutUrl: pgCheckoutUrl,
        payeeVpa: 'PhonePe PG (M236NFVVSAXD2)',
        provider: 'phonepe',
        expiresAt: order.expiresAt,
      },
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create payment' });
  }
});

// Sync order from Next.js PhonePe session
router.post('/sync-order', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const { jobId, orderId, provider, amount } = req.body;
    if (!jobId || !orderId) {
      return res.status(400).json({ success: false, error: 'jobId and orderId required' });
    }

    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id: jobId }, { displayId: jobId }] },
    });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    await prisma.payment.upsert({
      where: { jobId: job.id },
      update: {
        provider: provider || 'phonepe',
        providerOrderId: orderId,
        status: 'PAYMENT_PENDING',
      },
      create: {
        jobId: job.id,
        amount: Number(amount || job.totalPrice || 1),
        currency: 'INR',
        provider: provider || 'phonepe',
        providerOrderId: orderId,
        status: 'PAYMENT_PENDING',
      },
    });

    res.json({ success: true, message: 'Order synced successfully' });
  } catch (err: any) {
    console.error('Failed to sync payment order:', err);
    res.status(500).json({ success: false, error: err?.message });
  }
});

// Verify payment
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const paymentProvider = createPaymentProvider();
    const io = req.app.locals.io;
    const { paymentId, orderId } = req.body;
    const paymentData = req.body.paymentData || (req.body.utr ? { utr: req.body.utr } : {});
    if (req.body.utr && !paymentData.utr) {
      paymentData.utr = req.body.utr;
    }

    // Find payment record
    const paymentRecord = await prisma.payment.findFirst({
      where: paymentId ? { id: paymentId } : { providerOrderId: orderId },
      include: { job: true },
    });

    if (!paymentRecord) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (paymentRecord.status === 'PAID') {
      return res.json({
        success: true,
        data: { verified: true, status: 'PAID', message: 'Already verified' },
      });
    }

    // Determine the active order ID (use real PhonePe order ID if provided)
    const activeOrderId = (orderId && typeof orderId === 'string' && !orderId.startsWith('mock_'))
      ? orderId
      : paymentRecord.providerOrderId;

    // Verify with payment provider
    const verification = await paymentProvider.verifyPayment(
      activeOrderId,
      paymentData || {}
    );

    // Update payment record
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: verification.status,
        providerOrderId: verification.verified ? activeOrderId : paymentRecord.providerOrderId,
        provider: verification.verified ? 'phonepe' : paymentRecord.provider,
        providerRef: verification.providerRef,
        verifiedAt: verification.verified ? new Date() : null,
      },
    });

    if (verification.verified) {
      // Update job status
      await prisma.printJob.update({
        where: { id: paymentRecord.jobId },
        data: { status: 'PAID' },
      });

      // Notify customer via WebSocket
      io.to(`session:${paymentRecord.job.sessionId}`).emit('payment_verified', {
        type: 'PAYMENT_VERIFIED',
        jobId: paymentRecord.jobId,
        displayId: paymentRecord.job.displayId,
        status: 'PAID',
        amount: paymentRecord.amount,
      });

      // Broadcast globally for responsive frontends
      io.emit('payment_verified', {
        type: 'PAYMENT_VERIFIED',
        jobId: paymentRecord.jobId,
        displayId: paymentRecord.job.displayId,
        status: 'PAID',
        amount: paymentRecord.amount,
      });

      // Notify Real-Time Admin Portal
      io.to('admin').emit('job_updated', {
        id: paymentRecord.jobId,
        displayId: paymentRecord.job.displayId,
        status: 'PAID',
        paymentStatus: 'PAID',
        totalPrice: paymentRecord.amount,
      });

      // For QR flow: auto-queue the job
      if (paymentRecord.job.printMethod === 'QR' && paymentRecord.job.kioskId) {
        await prisma.printJob.update({
          where: { id: paymentRecord.jobId },
          data: { status: 'QUEUED' },
        });

        // Get signed URL for the file
        const file = await prisma.file.findUnique({ where: { id: paymentRecord.job.fileId } });
        const storage = req.app.locals.storage;
        const downloadUrl = await storage.getSignedUrl(file!.storageKey, 600);

        const jobPayload = {
          type: 'NEW_JOB',
          job: { ...paymentRecord.job, file },
          downloadUrl,
          downloadExpiresAt: new Date(Date.now() + 600000).toISOString(),
        };

        const pairPayload = {
          type: 'KIOSK_PAIRED_PRINT',
          kioskId: paymentRecord.job.kioskId,
          targetKioskId: paymentRecord.job.kioskId,
          jobId: paymentRecord.jobId,
          displayId: paymentRecord.job.displayId,
          downloadUrl,
          totalPages: paymentRecord.job.totalPages,
          fileName: file?.originalName || 'Document.pdf',
          colorMode: paymentRecord.job.colorMode,
          copies: paymentRecord.job.copies || 1,
        };

        // Notify kiosk via WebSocket
        io.to(`kiosk:${paymentRecord.job.kioskId}`).emit('new_job', jobPayload);
        io.to(`kiosk:${paymentRecord.job.kioskId}`).emit('kiosk_paired_print', pairPayload);
        io.emit('kiosk_paired_print', pairPayload);
      }

      await prisma.auditLog.create({
        data: {
          action: 'PAYMENT_VERIFIED',
          entityType: 'Payment',
          entityId: paymentRecord.id,
          details: JSON.stringify({ amount: verification.amount, provider: paymentRecord.provider }),
        },
      });
    }

    res.json({
      success: true,
      data: {
        verified: verification.verified,
        status: verification.status,
        paymentId: paymentRecord.id,
        jobId: paymentRecord.jobId,
      },
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify payment' });
  }
});

// ── Automated Webhook (Google Pay for Business / Payment Gateway / Bank PSP) ──
const handleIncomingWebhook = async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const paymentProvider = req.app.locals.payment;
    const io = req.app.locals.io;
    const payload = req.body;
    const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'] || req.headers['authorization'];

    console.log('⚡ [Webhook] Received incoming payment webhook:', JSON.stringify(payload));

    let processed: any = null;
    if (typeof (paymentProvider as any).processWebhook === 'function') {
      processed = (paymentProvider as any).processWebhook(payload, signature as string);
    }

    // Resolve order identifier from payload
    const orderId = processed?.orderId || payload.orderId || payload.order_id || payload.tr || payload.transactionReferenceId || payload.data?.orderId;
    const providerRef = processed?.providerRef || payload.rrn || payload.utr || payload.bankRefNumber || payload.paymentId || payload.id || `UPI_${Date.now()}`;
    const status = (payload.status || payload.event || payload.payment_status || 'PAID').toUpperCase();

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID or transaction reference missing' });
    }

    // Find payment record by providerOrderId or jobId
    const paymentRecord = await prisma.payment.findFirst({
      where: {
        OR: [
          { providerOrderId: orderId },
          { jobId: orderId },
        ],
      },
      include: { job: true },
    });

    if (!paymentRecord) {
      console.warn(`⚠️ [Webhook] No matching payment record found for order reference: ${orderId}`);
      return res.status(404).json({ success: false, error: 'Payment record not found' });
    }

    const isSuccess = status.includes('SUCCESS') || status.includes('PAID') || status.includes('CAPTURED') || payload.success === true;

    if (isSuccess) {
      // Mark payment as PAID
      await prisma.payment.update({
        where: { id: paymentRecord.id },
        data: {
          status: 'PAID',
          providerRef: String(providerRef),
          verifiedAt: new Date(),
        },
      });

      // Update job to PAID
      await prisma.printJob.update({
        where: { id: paymentRecord.jobId },
        data: { status: 'PAID' },
      });

      console.log(`✅ [Webhook] Payment SUCCESS for Job ${paymentRecord.job.displayId} (₹${paymentRecord.amount}) via UPI Ref: ${providerRef}`);

      // Notify customer instantly via WebSocket
      io.to(`session:${paymentRecord.job.sessionId}`).emit('payment_verified', {
        type: 'PAYMENT_VERIFIED',
        jobId: paymentRecord.jobId,
        displayId: paymentRecord.job.displayId,
        status: 'PAID',
        amount: paymentRecord.amount,
        providerRef,
      });

      // Broadcast globally for instant UI transition
      io.emit('payment_verified', {
        type: 'PAYMENT_VERIFIED',
        jobId: paymentRecord.jobId,
        displayId: paymentRecord.job.displayId,
        status: 'PAID',
        amount: paymentRecord.amount,
        providerRef,
      });

      // Notify Real-Time Admin Portal
      io.to('admin').emit('job_updated', {
        id: paymentRecord.jobId,
        displayId: paymentRecord.job.displayId,
        status: 'PAID',
        paymentStatus: 'PAID',
        totalPrice: paymentRecord.amount,
        providerRef,
      });

      // If kiosk flow, auto-queue job to printer
      if (paymentRecord.job.printMethod === 'QR' && paymentRecord.job.kioskId) {
        await prisma.printJob.update({
          where: { id: paymentRecord.jobId },
          data: { status: 'QUEUED' },
        });

        const file = await prisma.file.findUnique({ where: { id: paymentRecord.job.fileId } });
        if (file) {
          const storage = req.app.locals.storage;
          const downloadUrl = await storage.getSignedUrl(file.storageKey, 600);
          io.to(`kiosk:${paymentRecord.job.kioskId}`).emit('new_job', {
            type: 'NEW_JOB',
            job: paymentRecord.job,
            downloadUrl,
            downloadExpiresAt: new Date(Date.now() + 600000).toISOString(),
          });
        }
      }

      await prisma.auditLog.create({
        data: {
          action: 'WEBHOOK_PAYMENT_VERIFIED',
          entityType: 'Payment',
          entityId: paymentRecord.id,
          details: JSON.stringify({ amount: paymentRecord.amount, providerRef, orderId }),
        },
      });

      return res.json({ success: true, message: 'Payment verified and confirmed via webhook' });
    }

    res.json({ success: true, message: `Webhook processed with status: ${status}` });
  } catch (err: any) {
    console.error('❌ [Webhook] Error processing payment webhook:', err);
    res.status(500).json({ success: false, error: 'Internal server error processing webhook' });
  }
};

// ── Automated Android Notification Webhook (Google Pay for Business / Soundbox / SMS Bridge) ──
const handleNotificationWebhook = async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;
    const payload = req.body || {};

    console.log('🔔 [Notification Webhook] Received notification alert:', JSON.stringify(payload));

    // Combine any text fields into a single search string
    const rawText = [
      payload.text,
      payload.message,
      payload.body,
      payload.content,
      payload.title,
      payload.subText,
    ].filter(Boolean).join(' ');

    // 1. Extract Amount from payload or regex
    let parsedAmount: number | null = null;
    if (typeof payload.amount === 'number' && payload.amount > 0) {
      parsedAmount = payload.amount;
    } else if (typeof payload.amount === 'string') {
      const num = parseFloat(payload.amount.replace(/[^0-9.]/g, ''));
      if (!isNaN(num) && num > 0) parsedAmount = num;
    }

    if (!parsedAmount && rawText) {
      // Common GPay patterns:
      // "Received ₹25.00 on Google Pay", "Received ₹15 from XYZ", "₹ 50.00 received", "Credited with Rs. 10"
      const match = rawText.match(/(?:received|credited|payment of)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:on google pay|received|credited|from)?/i);
      if (match && match[1]) {
        const cleaned = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(cleaned) && cleaned > 0) {
          parsedAmount = cleaned;
        }
      }
    }

    // 2. Extract potential UTR / Reference (12 digit numeric) if present
    const utrMatch = rawText.match(/\b\d{12}\b/);
    const providerRef = utrMatch ? utrMatch[0] : (payload.utr || payload.rrn || `GPAY_NOTIF_${Date.now()}`);

    // 3. Extract order ID if provided in notification note or payload
    let orderId = payload.orderId || payload.jobId || payload.tr;
    if (!orderId && rawText) {
      const orderMatch = rawText.match(/(?:job|order|ref|tr)[:\s-]*([a-zA-Z0-9_-]{6,})/i);
      if (orderMatch && orderMatch[1]) {
        orderId = orderMatch[1];
      }
    }

    // 4. Find matching pending payment
    let paymentRecord: any = null;

    if (orderId) {
      paymentRecord = await prisma.payment.findFirst({
        where: {
          OR: [
            { providerOrderId: orderId },
            { jobId: orderId },
          ],
        },
        include: { job: true },
      });
    }

    // If no orderId match, find the most recent PENDING payment matching this amount (within last 30 minutes)
    if (!paymentRecord && parsedAmount) {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      paymentRecord = await prisma.payment.findFirst({
        where: {
          status: 'PENDING',
          amount: {
            gte: parsedAmount - 0.5,
            lte: parsedAmount + 0.5,
          },
          createdAt: {
            gte: thirtyMinutesAgo,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: { job: true },
      });
    }

    if (!paymentRecord) {
      console.warn(`⚠️ [Notification Webhook] No pending payment found for amount: ₹${parsedAmount || 'unknown'}, text: "${rawText}"`);
      return res.status(200).json({
        success: false,
        message: 'Notification received but no matching pending payment found in last 30 mins',
        parsedAmount,
        rawText,
      });
    }

    console.log(`✅ [Notification Webhook] Matched payment ${paymentRecord.id} for job ${paymentRecord.jobId} (Amount: ₹${paymentRecord.amount})`);

    // 5. Update payment & print job
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: 'PAID',
        providerRef,
        verifiedAt: new Date(),
      },
    });

    if (paymentRecord.job.status !== 'PAID') {
      await prisma.printJob.update({
        where: { id: paymentRecord.jobId },
        data: {
          status: paymentRecord.job.status === 'CREATED' || paymentRecord.job.status === 'PAYMENT_PENDING' ? 'QUEUED' : paymentRecord.job.status,
        },
      });
    }

    // 6. Broadcast instant WebSocket event to customer screen and Admin portal
    const verificationPayload = {
      type: 'PAYMENT_VERIFIED',
      jobId: paymentRecord.jobId,
      displayId: paymentRecord.job.displayId,
      status: 'PAID',
      paymentStatus: 'PAID',
      totalPrice: paymentRecord.amount,
      providerRef,
    };

    io.to(`job:${paymentRecord.jobId}`).emit('payment_verified', verificationPayload);
    io.emit('payment_verified', verificationPayload);

    // Notify Real-Time Admin Portal
    io.to('admin').emit('job_updated', {
      id: paymentRecord.jobId,
      displayId: paymentRecord.job.displayId,
      status: 'PAID',
      paymentStatus: 'PAID',
      totalPrice: paymentRecord.amount,
      providerRef,
    });

    // 7. Auto-queue to kiosk printer if kiosk job
    if (paymentRecord.job.printMethod === 'QR' && paymentRecord.job.kioskId) {
      await prisma.printJob.update({
        where: { id: paymentRecord.jobId },
        data: { status: 'QUEUED' },
      });

      const file = await prisma.file.findUnique({ where: { id: paymentRecord.job.fileId } });
      if (file) {
        const storage = req.app.locals.storage;
        const downloadUrl = await storage.getSignedUrl(file.storageKey, 600);
        io.to(`kiosk:${paymentRecord.job.kioskId}`).emit('new_job', {
          type: 'NEW_JOB',
          job: paymentRecord.job,
          downloadUrl,
          downloadExpiresAt: new Date(Date.now() + 600000).toISOString(),
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        action: 'NOTIFICATION_PAYMENT_VERIFIED',
        entityType: 'Payment',
        entityId: paymentRecord.id,
        details: JSON.stringify({ amount: paymentRecord.amount, providerRef, parsedAmount, rawText }),
      },
    });

    return res.json({
      success: true,
      message: 'Payment verified and confirmed via notification forwarder',
      jobId: paymentRecord.jobId,
      amount: paymentRecord.amount,
      providerRef,
    });
  } catch (err: any) {
    console.error('❌ [Notification Webhook] Error processing notification webhook:', err);
    res.status(500).json({ success: false, error: 'Internal server error processing notification webhook' });
  }
};

router.post('/webhook', handleIncomingWebhook);
router.post('/webhook/gpay', handleIncomingWebhook);
router.post('/webhook/notification', handleNotificationWebhook);

// ── Google Pay Omnichannel API — In-Store POS Collect Request (Zero phone required on merchant side) ──
router.post('/gpay/collect', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const paymentProvider = req.app.locals.payment;
    const { jobId, phoneNumber } = req.body;

    if (!jobId || !phoneNumber) {
      return res.status(400).json({ success: false, error: 'jobId and phoneNumber are required' });
    }

    const job = await prisma.printJob.findUnique({
      where: { id: jobId },
      include: { payment: true },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (typeof (paymentProvider as any).initiateOmnichannelPayment !== 'function') {
      return res.status(400).json({ success: false, error: 'Current payment provider does not support Google Omnichannel API' });
    }

    const result = await (paymentProvider as any).initiateOmnichannelPayment({
      phoneNumber,
      amount: job.totalPrice,
      transactionId: job.id,
      description: `Print Job #${job.displayId || job.id.slice(0, 8)}`,
      originatingPlatform: 'INSTORE_POS',
    });

    res.json(result);
  } catch (err: any) {
    console.error('❌ [Google Omnichannel] Error initiating collect:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to initiate Google Pay collect request' });
  }
});

// Check Google Pay Omnichannel status for a transaction
router.get('/gpay/status/:transactionId', async (req: Request, res: Response) => {
  try {
    const prisma = req.app.locals.prisma;
    const paymentProvider = req.app.locals.payment;
    const io = req.app.locals.io;
    const { transactionId } = req.params;

    if (typeof (paymentProvider as any).getOmnichannelStatus !== 'function') {
      return res.status(400).json({ success: false, error: 'Omnichannel API not supported' });
    }

    const result = await (paymentProvider as any).getOmnichannelStatus(transactionId);

    // If Google reports status is SUCCESS / PAID, update database
    if (result.success && (result.status === 'SUCCESS' || result.status === 'PAID')) {
      const paymentRecord = await prisma.payment.findFirst({
        where: {
          OR: [{ providerOrderId: transactionId }, { jobId: transactionId }],
        },
        include: { job: true },
      });

      if (paymentRecord && paymentRecord.status !== 'PAID') {
        await prisma.payment.update({
          where: { id: paymentRecord.id },
          data: {
            status: 'PAID',
            providerRef: `GPAY_OMNI_${transactionId}`,
            verifiedAt: new Date(),
          },
        });

        await prisma.printJob.update({
          where: { id: paymentRecord.jobId },
          data: { status: 'QUEUED' },
        });

        const statusPayload = {
          type: 'PAYMENT_VERIFIED',
          jobId: paymentRecord.jobId,
          displayId: paymentRecord.job.displayId,
          status: 'PAID',
          paymentStatus: 'PAID',
          totalPrice: paymentRecord.amount,
          providerRef: `GPAY_OMNI_${transactionId}`,
        };

        io.to(`job:${paymentRecord.jobId}`).emit('payment_verified', statusPayload);
        io.emit('payment_verified', statusPayload);

        io.to('admin').emit('job_updated', {
          id: paymentRecord.jobId,
          displayId: paymentRecord.job.displayId,
          status: 'PAID',
          paymentStatus: 'PAID',
          totalPrice: paymentRecord.amount,
          providerRef: `GPAY_OMNI_${transactionId}`,
        });
      }
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

export { router as paymentRoutes };

