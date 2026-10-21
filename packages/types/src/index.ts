// ============================================================
// XPOS Shared Types — Central type definitions for the system
// ============================================================

// ── Print Method ──
export type PrintMethod = 'QR' | 'CODE';

// ── Job Status ──
export type JobStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_PROCESSING'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'QUEUED'
  | 'SENDING'
  | 'PRINTING'
  | 'COMPLETED'
  | 'PRINT_FAILED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

// ── Payment Status ──
export type PaymentStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_PROCESSING'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

// ── Printer Status ──
export type PrinterStatus = 'READY' | 'PRINTING' | 'OFFLINE' | 'OUT_OF_PAPER' | 'JAM' | 'ERROR';

// ── Kiosk Status ──
export type KioskStatus = 'ACTIVE' | 'MAINTENANCE' | 'DISABLED';

// ── Print Code Status ──
export type PrintCodeStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'LOCKED';

// ── Color Mode ──
export type ColorMode = 'BW' | 'COLOR';

// ── Paper Size ──
export type PaperSize = 'A4';

// ── Sides ──
export type Sides = 'SINGLE' | 'DOUBLE';

// ── QR Scan State ──
export type QrScanState = 'SCANNING' | 'FOUND' | 'VALIDATING' | 'VALID' | 'INVALID' | 'EXPIRED' | 'ALREADY_USED' | 'ERROR';

// ── Error Codes ──
export type ErrorCode =
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'PIN_INVALID'
  | 'PIN_EXPIRED'
  | 'PIN_LOCKED'
  | 'QR_INVALID'
  | 'QR_EXPIRED'
  | 'QR_ALREADY_USED'
  | 'KIOSK_OFFLINE'
  | 'PRINTER_OFFLINE'
  | 'PRINTER_PAPER_OUT'
  | 'PRINTER_JAM'
  | 'PRINT_FAILED'
  | 'PRINT_PARTIAL'
  | 'SAVAPAGE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

// ── Interfaces ──

export interface KioskInfo {
  id: string;
  name: string;
  displayId: string;
  location: string;
  status: KioskStatus;
  printerStatus: PrinterStatus;
  qrUrl: string;
  lastHeartbeat: string | null;
}

export interface FileInfo {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  thumbnails?: string[];
}

export interface PrintSettings {
  colorMode: ColorMode;
  paperSize: PaperSize;
  sides: Sides;
  copies: number;
  pageRange: string | null; // null = all pages, "1-5,8,10-12"
}

export interface PricingRule {
  id: string;
  paperSize: PaperSize;
  colorMode: ColorMode;
  pricePerPage: number;
  isActive: boolean;
}

export interface PriceCalculation {
  pages: number;
  copies: number;
  pricePerPage: number;
  subtotal: number;
  total: number;
  currency: string;
  breakdown: string;
}

export interface PrintJob {
  id: string;
  displayId: string;
  sessionId: string;
  fileId: string;
  kioskId: string | null;
  printMethod: PrintMethod;
  status: JobStatus;
  colorMode: ColorMode;
  paperSize: PaperSize;
  sides: Sides;
  copies: number;
  pageRange: string | null;
  totalPages: number;
  totalPrice: number;
  currentPage: number;
  printedPages: number;
  failedAtPage: number | null;
  printAttempts: number;
  errorMessage: string | null;
  errorCode: ErrorCode | null;
  createdAt: string;
  completedAt: string | null;
  file?: FileInfo;
  kiosk?: KioskInfo;
  payment?: PaymentInfo;
  printCode?: PrintCodeInfo;
}

export interface PaymentInfo {
  id: string;
  jobId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  providerRef: string | null;
  verifiedAt: string | null;
}

export interface PrintCodeInfo {
  code?: string; // Only returned on generation, never stored raw
  qrToken?: string;
  jobId: string;
  status: PrintCodeStatus;
  expiresAt: string;
  usedAt: string | null;
  allowedKioskId: string | null;
  remainingSeconds: number;
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  qrData?: string;
  upiLink?: string;
  gpayLink?: string;
  payeeVpa?: string;
  expiresAt: string;
}

export interface PaymentVerification {
  verified: boolean;
  paymentId: string;
  amount: number;
  status: PaymentStatus;
  providerRef: string | null;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  status: 'INITIATED' | 'SUCCESS' | 'FAILED';
}

export interface PrinterInfo {
  id: string;
  name: string;
  isDefault: boolean;
  status: PrinterStatus;
  model?: string;
}

export interface PrintJobRequest {
  filePath: string;
  printerName?: string;
  copies: number;
  colorMode: ColorMode;
  sides: Sides;
  pageRange?: string;
  paperSize: PaperSize;
  totalPages?: number;
}

export interface PrintJobResult {
  jobId: string;
  status: 'SUBMITTED' | 'FAILED';
  error?: string;
}

export interface PrintJobProgress {
  jobId: string;
  status: PrinterStatus;
  currentPage: number;
  totalPages: number;
  error?: string;
}

export interface KioskHeartbeat {
  kioskId: string;
  cpu: number;
  ram: number;
  disk: number;
  internet: boolean;
  appVersion: string;
  printerStatus: PrinterStatus;
  currentJobId: string | null;
  timestamp: string;
}

// ── WebSocket Events ──

// Server → Kiosk
export interface WsNewJobEvent {
  type: 'NEW_JOB';
  job: PrintJob;
  downloadUrl: string;
  downloadExpiresAt: string;
}

export interface WsCancelJobEvent {
  type: 'CANCEL_JOB';
  jobId: string;
}

export interface WsMaintenanceEvent {
  type: 'MAINTENANCE';
  enabled: boolean;
  message?: string;
}

// Kiosk → Server
export interface WsHeartbeatEvent {
  type: 'HEARTBEAT';
  data: KioskHeartbeat;
}

export interface WsJobStatusEvent {
  type: 'JOB_STATUS';
  jobId: string;
  status: JobStatus;
  currentPage?: number;
  totalPages?: number;
  error?: string;
}

export interface WsPrinterStatusEvent {
  type: 'PRINTER_STATUS';
  status: PrinterStatus;
  error?: string;
}

// Server → Customer
export interface WsPaymentVerifiedEvent {
  type: 'PAYMENT_VERIFIED';
  jobId: string;
  paymentId: string;
}

export interface WsJobUpdateEvent {
  type: 'JOB_UPDATE';
  jobId: string;
  status: JobStatus;
  currentPage?: number;
  totalPages?: number;
}

// Union types for WebSocket messages
export type KioskIncomingEvent = WsNewJobEvent | WsCancelJobEvent | WsMaintenanceEvent;
export type KioskOutgoingEvent = WsHeartbeatEvent | WsJobStatusEvent | WsPrinterStatusEvent;
export type CustomerIncomingEvent = WsPaymentVerifiedEvent | WsJobUpdateEvent;

// ── API Response wrapper ──
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ── Session ──
export interface Session {
  id: string;
  kioskId: string | null;
  createdAt: string;
  expiresAt: string;
}
