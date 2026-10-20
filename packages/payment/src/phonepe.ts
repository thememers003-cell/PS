// ============================================================
// XPOS Payment — PhonePe Payment Provider
// Supports PhonePe Standard Checkout V2 (OAuth 2.0) & Direct UPI
// ============================================================

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { PaymentOrder, PaymentVerification, RefundResult } from '@xpos/types';
import type { PaymentProvider } from './index';

export interface PhonePeConfig {
  merchantId?: string;
  clientId?: string;
  clientSecret?: string;
  clientVersion?: string;
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
  private pendingOrders = new Map<string, { amount: number; currency: string; status: string; createdAt: number; providerRef?: string; redirectUrl?: string }>();
  
  // OAuth Token Cache
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(customConfig?: Partial<PhonePeConfig>) {
    this.config = {
      merchantId: process.env.PHONEPE_MERCHANT_ID || 'M236NFVVSAXD2',
      clientId: process.env.PHONEPE_CLIENT_ID || 'SU2610191744120003675634',
      clientSecret: process.env.PHONEPE_CLIENT_SECRET || '51d26195-be6f-47ee-949a-297591229cce',
      clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1',
      saltKey: process.env.PHONEPE_SALT_KEY || process.env.PHONEPE_CLIENT_SECRET || '51d26195-be6f-47ee-949a-297591229cce',
      keyIndex: parseInt(process.env.PHONEPE_KEY_INDEX || '1'),
      env: (process.env.PHONEPE_ENV as 'UAT' | 'PROD') || 'PROD',
      vpa: process.env.PHONEPE_MERCHANT_VPA || 'PhonePe PG (M236NFVVSAXD2)',
      merchantName: process.env.PHONEPE_MERCHANT_NAME || 'Print Bro',
      callbackUrl: process.env.PHONEPE_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:4000'}/api/payments/webhook`,
      ...customConfig,
    };
  }

  /**
   * PhonePe V2 Identity Manager OAuth 2.0 Token Generation
   */
  private async getAccessToken(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now + 60000) {
      return this.cachedToken;
    }

    const { clientId, clientSecret, clientVersion, env } = this.config;
    if (!clientId || !clientSecret) {
      console.warn('⚠️ PhonePe OAuth: Missing clientId or clientSecret');
      return null;
    }

    try {
      const tokenUrl = env === 'PROD'
        ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';

      const params = new URLSearchParams();
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('client_version', clientVersion || '1');
      params.append('grant_type', 'client_credentials');

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`❌ PhonePe OAuth Token Error [${res.status}]:`, errText);
        return null;
      }

      const data: any = await res.json();
      if (data.access_token) {
        this.cachedToken = data.access_token;
        this.tokenExpiresAt = (data.expires_at ? data.expires_at * 1000 : now + 3500 * 1000);
        return this.cachedToken;
      }
    } catch (err) {
      console.error('❌ PhonePe getAccessToken failed:', err);
    }
    return null;
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

    const vpa = this.config.merchantId ? `PhonePe PG (${this.config.merchantId})` : 'PhonePe PG';
    const name = encodeURIComponent(this.config.merchantName || 'Print Bro');
    const note = encodeURIComponent(`Print Order ${metadata.displayId || metadata.jobId || uniqueRef}`);
    const formattedAmount = amount.toFixed(2);

    // Standard Universal UPI Deep Link (fallback)
    const baseParams = [
      `pa=${vpa}`,
      `pn=${name}`,
      `am=${formattedAmount}`,
      `cu=${currency}`,
      `tn=${note}`,
    ];
    const upiLink = `upi://pay?${baseParams.join('&')}`;

    let pgRedirectUrl: string | undefined;

    // 1. PhonePe V2 Standard Checkout (Live Production)
    const token = await this.getAccessToken();
    if (token) {
      try {
        const checkoutUrl = this.config.env === 'PROD'
          ? 'https://api.phonepe.com/apis/pg/checkout/v2/pay'
          : 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay';

        // PhonePe PG strictly enforces minimum 100 paise (₹1.00 INR)
        const amountInPaise = Math.max(100, Math.round(amount * 100));
        const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/job/${metadata.jobId || ''}`;

        const payload = {
          merchantOrderId: orderId,
          amount: amountInPaise,
          expireAfter: 1200,
          paymentFlow: {
            type: 'PG_CHECKOUT',
            merchantUrls: {
              redirectUrl,
            },
          },
        };

        const res = await fetch(checkoutUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `O-Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data: any = await res.json();
          if (data.redirectUrl) {
            pgRedirectUrl = data.redirectUrl;
            console.log(`✅ [PhonePe V2 PG] Live order created: ${orderId} -> ${pgRedirectUrl.slice(0, 50)}...`);
            const existing = this.pendingOrders.get(orderId);
            if (existing) {
              existing.redirectUrl = pgRedirectUrl;
              existing.providerRef = data.orderId;
            }
          }
        } else {
          const errText = await res.text();
          console.warn('⚠️ PhonePe V2 Checkout returned error:', res.status, errText);
        }
      } catch (pgErr) {
        console.warn('⚠️ PhonePe V2 Checkout exception:', pgErr);
      }
    }

    const finalUrl = pgRedirectUrl || 'https://phonepe.com';

    return {
      orderId,
      amount: Math.max(1, amount),
      currency,
      qrData: finalUrl,
      upiLink: finalUrl,
      gpayLink: finalUrl,
      payeeVpa: `PhonePe Merchant ID: ${this.config.merchantId}`,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Real-Time Verify payment status
   */
  async verifyPayment(orderId: string, paymentData: any = {}): Promise<PaymentVerification> {
    const order = this.pendingOrders.get(orderId);

    // 1. If marked paid via webhook callback
    if (order && order.status === 'PAID') {
      return {
        verified: true,
        paymentId: `pay_${orderId}`,
        amount: order.amount,
        status: 'PAID',
        providerRef: order.providerRef || `PHONEPE_${orderId}`,
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

    // 3. Check PhonePe V2 Status API in Real-Time
    const token = await this.getAccessToken();
    if (token) {
      try {
        const statusUrl = this.config.env === 'PROD'
          ? `https://api.phonepe.com/apis/pg/checkout/v2/order/${orderId}/status?details=false`
          : `https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order/${orderId}/status?details=false`;

        const res = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `O-Bearer ${token}`,
          },
        });

        if (res.ok) {
          const data: any = await res.json();
          if (data.state === 'COMPLETED') {
            if (order) {
              order.status = 'PAID';
              order.providerRef = data.orderId || `PP_${Date.now()}`;
            }
            return {
              verified: true,
              paymentId: `pay_${orderId}`,
              amount: (data.amount || 0) / 100,
              status: 'PAID',
              providerRef: data.orderId || `PHONEPE_${orderId}`,
            };
          }
        }
      } catch (err) {
        console.warn('⚠️ PhonePe V2 Status check error:', err);
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
        const jsonStr = Buffer.from(payload.response, 'base64').toString('utf8');
        decoded = JSON.parse(jsonStr);
      }

      const orderId = decoded.data?.merchantOrderId || decoded.merchantOrderId || decoded.data?.merchantTransactionId || decoded.orderId;
      const state = decoded.data?.state || decoded.state || decoded.code;
      const isSuccess = state === 'COMPLETED' || state === 'PAYMENT_SUCCESS' || decoded.success === true;
      const amount = decoded.data?.amount ? decoded.data.amount / 100 : (decoded.amount ? decoded.amount / 100 : undefined);
      const providerRef = decoded.data?.orderId || decoded.orderId || decoded.data?.transactionId;

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

      return { success: false, error: 'Payment not completed or unknown order state' };
    } catch (err: any) {
      console.error('❌ PhonePe Webhook processing error:', err);
      return { success: false, error: err.message };
    }
  }

  async initiateRefund(paymentId: string, amount: number): Promise<RefundResult> {
    return {
      refundId: `pp_rf_${uuidv4().slice(0, 8)}`,
      amount,
      status: 'SUCCESS',
    };
  }
}
