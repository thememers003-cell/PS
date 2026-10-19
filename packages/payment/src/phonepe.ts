// ============================================================
// XPOS Payment — PhonePe Payment Provider
// Supports both PhonePe Payment Gateway (PG v1) & Direct PhonePe UPI
// ============================================================

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { PaymentOrder, PaymentVerification, RefundResult } from '@xpos/types';
import type { PaymentProvider } from './index';

export interface PhonePeConfig {
  merchantId?: string;
  saltKey?: string;
  keyIndex?: number;
  env?: 'UAT' | 'PROD';
  vpa?: string;
  merchantName?: string;
  callbackUrl?: string;
}

export class PhonePeProvider implements PaymentProvider {
  name = 'phonepe';
  private config: PhonePeConfig;
  private pendingOrders = new Map<string, { amount: number; currency: string; status: string; createdAt: number; providerRef?: string }>();

  constructor(customConfig?: Partial<PhonePeConfig>) {
    this.config = {
      merchantId: process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT',
      saltKey: process.env.PHONEPE_SALT_KEY || '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399',
      keyIndex: parseInt(process.env.PHONEPE_KEY_INDEX || '1'),
      env: (process.env.PHONEPE_ENV as 'UAT' | 'PROD') || 'UAT',
      vpa: process.env.PHONEPE_MERCHANT_VPA || process.env.UPI_MERCHANT_VPA || '8498864658@ybl',
      merchantName: process.env.PHONEPE_MERCHANT_NAME || process.env.UPI_MERCHANT_NAME || 'Print Bro',
      callbackUrl: process.env.PHONEPE_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:4000'}/api/payments/webhook`,
      ...customConfig,
    };
  }

  private getBaseUrl(): string {
    return this.config.env === 'PROD'
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  }

  /**
   * Create dynamic PhonePe payment order
   */
  async createOrder(
    amount: number,
    currency: string = 'INR',
    metadata: Record<string, string> = {}
  ): Promise<PaymentOrder> {
    const uniqueRef = `PP_${Date.now().toString(36).toUpperCase()}_${uuidv4().slice(0, 4).toUpperCase()}`;
    const orderId = uniqueRef;

    this.pendingOrders.set(orderId, {
      amount,
      currency,
      status: 'PAYMENT_PENDING',
      createdAt: Date.now(),
    });

    const vpa = this.config.vpa || '8498864658@ybl';
    const name = encodeURIComponent(this.config.merchantName || 'Print Bro');
    const note = encodeURIComponent(`Print Order ${metadata.displayId || metadata.jobId || uniqueRef}`);
    const formattedAmount = amount.toFixed(2);

    // 1. Standard universal UPI link
    const baseParams = [
      `pa=${vpa}`,
      `pn=${name}`,
      `am=${formattedAmount}`,
      `cu=${currency}`,
      `tn=${note}`,
    ];
    const upiLink = `upi://pay?${baseParams.join('&')}`;

    // 2. Direct PhonePe App Deep Link & Android Intent
    const phonepeLink = `phonepe://pay?${baseParams.join('&')}`;
    const gpayLink = `intent://pay?${baseParams.join('&')}#Intent;scheme=upi;package=com.phonepe.app;end`;

    // 3. If PhonePe PG Gateway keys configured, initialize PG order
    let pgRedirectUrl: string | undefined;
    if (this.config.merchantId && this.config.saltKey && !this.config.merchantId.includes('YOUR_')) {
      try {
        const amountInPaise = Math.round(amount * 100);
        const pgPayload = {
          merchantId: this.config.merchantId,
          merchantTransactionId: orderId,
          merchantUserId: metadata.sessionId || `user_${orderId}`,
          amount: amountInPaise,
          redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/job/${metadata.jobId || ''}`,
          redirectMode: 'REDIRECT',
          callbackUrl: this.config.callbackUrl,
          paymentInstrument: {
            type: 'PAY_PAGE',
          },
        };

        const base64Payload = Buffer.from(JSON.stringify(pgPayload)).toString('base64');
        const stringToHash = base64Payload + '/pg/v1/pay' + this.config.saltKey;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const checksum = `${sha256}###${this.config.keyIndex}`;

        const response = await fetch(`${this.getBaseUrl()}/pg/v1/pay`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum,
          },
          body: JSON.stringify({ request: base64Payload }),
        });

        const data: any = await response.json();
        if (data.success && data.data?.instrumentResponse?.redirectInfo?.url) {
          pgRedirectUrl = data.data.instrumentResponse.redirectInfo.url;
        }
      } catch (err) {
        console.warn('⚠️ PhonePe PG API call error, falling back to dynamic UPI:', err);
      }
    }

    return {
      orderId,
      amount,
      currency,
      qrData: upiLink,
      upiLink,
      gpayLink: pgRedirectUrl || gpayLink || phonepeLink,
      payeeVpa: vpa,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Verify payment status
   */
  async verifyPayment(orderId: string, paymentData: any = {}): Promise<PaymentVerification> {
    const order = this.pendingOrders.get(orderId);

    // 1. If marked paid via webhook
    if (order && order.status === 'PAID') {
      return {
        verified: true,
        paymentId: `pay_${orderId}`,
        amount: order.amount,
        status: 'PAID',
        providerRef: order.providerRef || `PHONEPE_REF_${orderId}`,
      };
    }

    // 2. Client provided manual UTR / Bank Reference Number
    const utr = paymentData?.utr || paymentData?.bankRef || paymentData?.rrn;
    if (utr && typeof utr === 'string' && utr.trim().length >= 6) {
      const ref = utr.trim();
      if (order) {
        order.status = 'PAID';
        order.providerRef = ref;
      }
      return {
        verified: true,
        paymentId: `pay_${orderId}`,
        amount: order?.amount || 0,
        status: 'PAID',
        providerRef: ref,
      };
    }

    // 3. Check PhonePe PG Status API if merchant keys configured
    if (this.config.merchantId && this.config.saltKey && !this.config.merchantId.includes('YOUR_')) {
      try {
        const endpoint = `/pg/v1/status/${this.config.merchantId}/${orderId}`;
        const stringToHash = endpoint + this.config.saltKey;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const checksum = `${sha256}###${this.config.keyIndex}`;

        const res = await fetch(`${this.getBaseUrl()}${endpoint}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum,
            'X-MERCHANT-ID': this.config.merchantId,
          },
        });

        const data: any = await res.json();
        if (data.success && data.code === 'PAYMENT_SUCCESS') {
          if (order) {
            order.status = 'PAID';
            order.providerRef = data.data?.transactionId || `PP_${Date.now()}`;
          }
          return {
            verified: true,
            paymentId: `pay_${orderId}`,
            amount: (data.data?.amount || 0) / 100,
            status: 'PAID',
            providerRef: data.data?.transactionId || `PHONEPE_${orderId}`,
          };
        }
      } catch (e) {
        console.warn('⚠️ PhonePe Status check error:', e);
      }
    }

    return {
      verified: false,
      paymentId: '',
      amount: order?.amount || 0,
      status: 'PAYMENT_PENDING',
      providerRef: null,
    };
  }

  /**
   * Process incoming Webhook callback from PhonePe
   */
  processWebhook(payload: any, signatureHeader?: string): { success: boolean; orderId?: string; amount?: number; providerRef?: string; error?: string } {
    try {
      let decoded: any = payload;
      if (typeof payload === 'object' && payload.response) {
        // Base64 decoded response
        const jsonStr = Buffer.from(payload.response, 'base64').toString('utf8');
        decoded = JSON.parse(jsonStr);
      }

      if (this.config.saltKey && signatureHeader && payload.response) {
        const stringToHash = payload.response + this.config.saltKey;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const expectedChecksum = `${sha256}###${this.config.keyIndex}`;
        if (signatureHeader !== expectedChecksum && !signatureHeader.startsWith(sha256)) {
          return { success: false, error: 'Invalid PhonePe webhook signature' };
        }
      }

      const orderId = decoded.data?.merchantTransactionId || decoded.merchantTransactionId;
      const isSuccess = decoded.success === true && (decoded.code === 'PAYMENT_SUCCESS' || decoded.data?.responseCode === 'SUCCESS');
      const amount = decoded.data?.amount ? decoded.data.amount / 100 : undefined;
      const providerRef = decoded.data?.transactionId || decoded.transactionId || decoded.data?.paymentInstrument?.utr;

      if (isSuccess && orderId) {
        const order = this.pendingOrders.get(orderId);
        if (order) {
          order.status = 'PAID';
          if (providerRef) order.providerRef = providerRef;
        }
        return {
          success: true,
          orderId,
          amount,
          providerRef,
        };
      }

      return { success: false, error: decoded.message || 'Payment not successful in webhook' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to process PhonePe webhook' };
    }
  }

  async initiateRefund(paymentId: string, amount: number): Promise<RefundResult> {
    return {
      refundId: `refund_${uuidv4().slice(0, 8)}`,
      amount,
      status: 'SUCCESS',
    };
  }
}
