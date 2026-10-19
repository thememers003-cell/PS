'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  QrCode,
  Smartphone,
  ExternalLink,
  ShieldCheck,
  Zap,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { io, Socket } from 'socket.io-client';
import { createPayment, verifyPayment, getApiUrl } from '../../lib/api';

function PaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const displayId = searchParams.get('displayId');
  const amount = searchParams.get('amount');
  const method = searchParams.get('method') || 'CODE';

  const [status, setStatus] = useState<'loading' | 'waiting' | 'verifying' | 'success' | 'failed'>('loading');
  const [paymentData, setPaymentData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedVpa, setCopiedVpa] = useState(false);
  const [utrInput, setUtrInput] = useState('');
  const [showUtrField, setShowUtrField] = useState(false);
  const [isVerifyingUtr, setIsVerifyingUtr] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initialize Order & Connect to Real-Time Webhook/Socket Stream
  useEffect(() => {
    let isMounted = true;

    async function initPayment() {
      if (!jobId) return;

      try {
        const res = await createPayment(jobId);
        if (res.success && res.data) {
          if (!isMounted) return;
          setPaymentData(res.data);
          setStatus('waiting');

          // Initialize WebSocket to listen for instant Webhook payment confirmation
          const socket = io(getApiUrl(), { transports: ['websocket', 'polling'] });
          socketRef.current = socket;

          socket.on('connect', () => {
            console.log('🔌 Connected to payment notification stream');
            socket.emit('join', `job:${jobId}`);
            socket.emit('join_job', jobId);
          });

          // Listen for Webhook confirmation
          socket.on('payment_verified', (data: any) => {
            console.log('⚡ Webhook Payment Confirmed:', data);
            if (data.jobId === jobId || data.displayId === displayId) {
              handlePaymentSuccess();
            }
          });

          // Polling fallback every 3 seconds to check payment status
          pollIntervalRef.current = setInterval(async () => {
            try {
              const checkRes = await verifyPayment(res.data.paymentId, res.data.orderId);
              if (checkRes.success && checkRes.data?.verified) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                handlePaymentSuccess();
              }
            } catch (pollErr) {
              // Silent retry
            }
          }, 3000);

        } else {
          setStatus('failed');
          setError(res.error || 'Failed to create payment order');
        }
      } catch (err: any) {
        setStatus('failed');
        setError(err.message || 'Network error while initializing payment');
      }
    }

    initPayment();

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [jobId, displayId]);

  const handlePaymentSuccess = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setStatus('success');
    setTimeout(() => {
      if (method === 'QR') {
        router.push(`/job/${jobId}?displayId=${displayId}`);
      } else {
        router.push(`/code?jobId=${jobId}&displayId=${displayId}`);
      }
    }, 1200);
  };

  // 2. Manual UTR Verification
  const handleVerifyUtr = async () => {
    if (!utrInput.trim() || !paymentData) return;
    setIsVerifyingUtr(true);
    setError(null);

    try {
      const res = await verifyPayment(paymentData.paymentId, paymentData.orderId, {
        utr: utrInput.trim(),
      });

      if (res.success && res.data?.verified) {
        handlePaymentSuccess();
      } else {
        setError('Reference number not matched yet. If payment was made, it will auto-confirm shortly.');
      }
    } catch (e) {
      setError('Failed to check reference. Please wait for auto-confirmation.');
    } finally {
      setIsVerifyingUtr(false);
    }
  };

  const copyVpa = (vpa: string) => {
    navigator.clipboard.writeText(vpa);
    setCopiedVpa(true);
    setTimeout(() => setCopiedVpa(false), 2500);
  };

  return (
    <div className="min-h-screen flex flex-col px-4 py-6 bg-[#f8fbff] text-slate-900 font-sans max-w-lg mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-bold text-xs bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
        <span className="text-xs font-bold text-slate-500">
          Order: <strong className="text-slate-900 font-mono">{displayId || jobId?.slice(0, 8)}</strong>
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Loading State */}
        {status === 'loading' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
            <Loader2 className="w-14 h-14 text-blue-600 animate-spin mx-auto mb-4" />
            <h3 className="text-xl font-black text-slate-900">Preparing Secure UPI Order...</h3>
            <p className="text-slate-500 text-xs font-medium mt-1">Generating unique locked UPI QR code</p>
          </motion.div>
        )}

        {/* Waiting for Payment State */}
        {status === 'waiting' && paymentData && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full text-center space-y-4"
          >
            {/* Main Payment Card */}
            <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-blue-200 shadow-xl shadow-blue-500/5 space-y-4">
              <div className="space-y-1">
                <span className="text-[11px] font-black text-purple-700 bg-purple-50 px-3 py-1 rounded-full uppercase tracking-wider border border-purple-200 inline-flex items-center gap-1">
                  <Zap className="w-3 h-3 text-purple-600" /> Instant PhonePe & UPI Verification
                </span>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight pt-1">
                  ₹{amount || paymentData.amount}
                </h2>
                <p className="text-slate-500 text-xs font-medium">
                  Scan QR with <strong>PhonePe</strong>, Google Pay, Paytm, or BHIM
                </p>
              </div>

              {/* Dynamic Locked UPI QR Code */}
              <div className="p-4 bg-white rounded-3xl mx-auto w-fit border-2 border-blue-100 shadow-md flex items-center justify-center">
                <QRCodeSVG
                  value={paymentData.qrData}
                  size={200}
                  level="H"
                  includeMargin={true}
                  imageSettings={{
                    src: '/logo.svg',
                    x: undefined,
                    y: undefined,
                    height: 36,
                    width: 36,
                    excavate: true,
                  }}
                />
              </div>

              {/* Live Webhook Waiting Pulse */}
              <div className="flex items-center justify-center gap-2 text-xs text-purple-700 font-bold bg-purple-50/80 py-2.5 px-4 rounded-2xl border border-purple-200 shadow-xs">
                <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
                <span>Auto-detecting payment in real time...</span>
              </div>

              {/* Mobile Direct Pay Buttons (Auto App Launch) */}
              <div className="pt-2 space-y-2">
                <a
                  href={paymentData.gpayLink || paymentData.upiLink}
                  className="w-full py-3.5 px-4 rounded-2xl bg-[#5f259f] hover:bg-[#4d1e82] text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-900/15 active:scale-95 transition-all text-center no-underline cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 text-purple-200" />
                  <span>Pay with PhonePe / GPay</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-60 ml-auto" />
                </a>

                <a
                  href={paymentData.upiLink}
                  className="w-full py-3 px-4 rounded-2xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center gap-2 border border-blue-200 active:scale-95 transition-all text-center no-underline cursor-pointer"
                >
                  <span>Pay via Paytm / Any UPI App</span>
                </a>
              </div>

              {/* Payee VPA Details */}
              {paymentData.payeeVpa && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
                  <div className="text-left truncate">
                    <p className="text-[11px] text-slate-400">Payee Name: <strong className="text-slate-700">CHAI GPT</strong> (Print Bro)</p>
                    <p className="font-mono text-slate-800 font-bold truncate text-[11px]">{paymentData.payeeVpa}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyVpa(paymentData.payeeVpa)}
                    className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 text-[11px] bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200"
                  >
                    {copiedVpa ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedVpa ? 'Copied' : 'Copy UPI'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Optional Manual UTR Entry Dropdown */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 text-left">
              <button
                type="button"
                onClick={() => setShowUtrField(!showUtrField)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 hover:text-blue-700 transition-colors"
              >
                <span>Paid via QR but screen didn't update?</span>
                {showUtrField ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              <AnimatePresence>
                {showUtrField && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="pt-3 space-y-2 overflow-hidden"
                  >
                    <p className="text-[11px] text-slate-500 leading-tight">
                      Enter the 12-digit UPI Transaction ID (UTR) from your Google Pay receipt for instant verification:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. 4289XXXXXXXX"
                        value={utrInput}
                        onChange={(e) => setUtrInput(e.target.value)}
                        className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600 font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyUtr}
                        disabled={isVerifyingUtr || !utrInput.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                      >
                        {isVerifyingUtr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* Success State */}
        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-10 space-y-3"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-100 border-4 border-emerald-400 flex items-center justify-center mx-auto text-emerald-600 shadow-xl shadow-emerald-500/10">
              <CheckCircle2 className="w-12 h-12 stroke-[2.5]" />
            </div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Payment Received! ✓</h3>
            <p className="text-slate-600 text-xs font-medium">
              Generating your 24-hour self-service print release code...
            </p>
          </motion.div>
        )}

        {/* Failed State */}
        {status === 'failed' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-10 space-y-4 max-w-sm"
          >
            <div className="w-20 h-20 rounded-full bg-rose-100 border-4 border-rose-300 flex items-center justify-center mx-auto text-rose-600">
              <XCircle className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">Payment Issue</h3>
            <p className="text-rose-600 text-xs font-bold bg-rose-50 border border-rose-200 p-3 rounded-xl">
              {error || 'Unable to confirm payment.'}
            </p>
            <button
              onClick={() => router.push('/remote')}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-lg transition-all"
            >
              Try Again
            </button>
          </motion.div>
        )}
      </div>

      {/* Trust Footer */}
      <div className="pt-4 text-center">
        <p className="text-[11px] font-bold text-slate-400 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>NPCI Unified Payments Interface (UPI) Secured</span>
        </p>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f8fbff]">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      }
    >
      <PaymentContent />
    </Suspense>
  );
}
