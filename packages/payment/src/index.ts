// ============================================================
// XPOS Payment — Provider abstraction + Mock implementation
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type { PaymentOrder, PaymentVerification, RefundResult, PaymentStatus } from '@xpos/types';

// ── Payment Provider Interface ──
export interface PaymentProvider {
  name: string;
  createOrder(amount: number, currency: string, metadata: Record<string, string>): Promise<PaymentOrder>;
  verifyPayment(orderId: string, paymentData: unknown): Promise<PaymentVerification>;
  initiateRefund(paymentId: string, amount: number): Promise<RefundResult>;
  processWebhook?(payload: any, signatureHeader?: string): { success: boolean; orderId?: string; amount?: number; providerRef?: string; error?: string };
  initiateOmnichannelPayment?(params: any): Promise<any>;
  getOmnichannelStatus?(transactionId: string, authToken?: string): Promise<any>;
}

// ── Mock Payment Provider ──
export class MockPaymentProvider implements PaymentProvider {
  name = 'mock';
  private orders = new Map<string, { amount: number; currency: string; status: PaymentStatus }>();
  private autoSuccess: boolean;
  private delayMs: number;

  constructor() {
    this.autoSuccess = process.env.MOCK_PAYMENT_AUTO_SUCCESS !== 'false';
    this.delayMs = parseInt(process.env.MOCK_PAYMENT_DELAY_MS || '3000');
  }

  async createOrder(
    amount: number,
    currency: string,
    metadata: Record<string, string>
  ): Promise<PaymentOrder> {
    const orderId = `mock_order_${uuidv4().slice(0, 8)}`;
    this.orders.set(orderId, { amount, currency, status: 'PAYMENT_PENDING' });

    // Generate a mock UPI QR string
    const qrData = `upi://pay?pa=xpos@mock&pn=XPOS&am=${amount}&cu=${currency}&tn=Print-${metadata.jobId || 'unknown'}`;

    return {
      orderId,
      amount,
      currency,
      qrData,
      upiLink: qrData,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async verifyPayment(orderId: string, _paymentData: unknown): Promise<PaymentVerification> {
    const order = this.orders.get(orderId);
    if (!order) {
      return {
        verified: false,
        paymentId: '',
        amount: 0,
        status: 'PAYMENT_FAILED',
        providerRef: null,
      };
    }

    // Simulate delay
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    const paymentId = `mock_pay_${uuidv4().slice(0, 8)}`;
    const status: PaymentStatus = this.autoSuccess ? 'PAID' : 'PAYMENT_FAILED';

    order.status = status;

    return {
      verified: status === 'PAID',
      paymentId,
      amount: order.amount,
      status,
      providerRef: `MOCK_REF_${Date.now()}`,
    };
  }

  async initiateRefund(paymentId: string, amount: number): Promise<RefundResult> {
    return {
      refundId: `mock_refund_${uuidv4().slice(0, 8)}`,
      amount,
      status: 'SUCCESS',
    };
  }

  // Helper: directly mark an order as paid (for testing)
  markAsPaid(orderId: string): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'PAID';
    }
  }
}

import { PhonePeProvider } from './phonepe';

// ── Factory ──
export function createPaymentProvider(): PaymentProvider {
  const provider = (process.env.PAYMENT_PROVIDER || 'phonepe').toLowerCase();

  switch (provider) {
    case 'mock':
      return new MockPaymentProvider();
    case 'phonepe':
    case 'phonepe-pg':
    case 'phone-pe':
    default:
      return new PhonePeProvider();
  }
}

export { PhonePeProvider };
