'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  ExternalLink,
  ShieldCheck,
  Zap,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { createPayment, verifyPayment, getApiUrl } from '../../lib/api';

function PaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const displayId = searchParams.get('displayId');
  const amount = searchParams.get('amount');
  const method = searchParams.get('method') || 'CODE';

  const [status, setStatus] = useState<'loading' | 'waiting' | 'checking' | 'redirecting' | 'success' | 'failed'>('loading');
  const [paymentData, setPaymentData] = useState<any>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [pgFailed, setPgFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [utrInput, setUtrInput] = useState('');
  const [showUtrField, setShowUtrField] = useState(false);
  const [isVerifyingUtr, setIsVerifyingUtr] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const socketRef = useRef<Socket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initPayment() {
      if (!jobId) return;
      try {
        const res = await createPayment(jobId);
        if (!isMounted) return;

        if (res.success && res.data) {
          setPaymentData(res.data);

          // Extract PhonePe PG checkout URL
          const pgUrl = res.data.checkoutUrl || res.data.gpayLink || res.data.upiLink || res.data.qrData;
          const isRealPgUrl = Boolean(
            pgUrl &&
            typeof pgUrl === 'string' &&
            pgUrl.startsWith('https://') &&
            pgUrl !== 'https://phonepe.com' &&
            pgUrl !== 'https://phonepe.com/'
          );

          if (isRealPgUrl) {
            setCheckoutUrl(pgUrl);
            setStatus('waiting');
            // Auto-redirect countdown
            let count = 3;
            setCountdown(count);
            countdownRef.current = setInterval(() => {
              count -= 1;
              setCountdown(count);
              if (count <= 0) {
                clearInterval(countdownRef.current!);
                setStatus('redirecting');
                window.location.href = pgUrl;
              }
            }, 1000);
          } else {
            // PhonePe API failed (network/credentials) — show manual fallback
            setPgFailed(true);
            setStatus('waiting');
            console.warn('⚠️ No valid PhonePe PG redirect URL. pgUrl was:', pgUrl);
          }

          // Connect WebSocket for instant payment confirmation
          const socket = io(getApiUrl(), { transports: ['websocket', 'polling'] });
          socketRef.current = socket;
          socket.on('connect', () => {
            socket.emit('join', `job:${jobId}`);
            socket.emit('join_job', jobId);
          });
          socket.on('payment_verified', (data: any) => {
            if (data.jobId === jobId || data.displayId === displayId) {
              handlePaymentSuccess();
            }
          });

          // Poll status every 4s (catches PhonePe webhook redirect back)
          pollIntervalRef.current = setInterval(async () => {
            try {
              const checkRes = await verifyPayment(res.data.paymentId, res.data.orderId);
              if (checkRes.success && checkRes.data?.verified) {
                clearInterval(pollIntervalRef.current!);
                handlePaymentSuccess();
              }
            } catch { /* silent */ }
          }, 4000);

        } else {
          setStatus('failed');
          setError(res.error || 'Failed to create payment order');
        }
      } catch (err: any) {
        if (isMounted) {
          setStatus('failed');
          setError(err.message || 'Network error');
        }
      }
    }

    initPayment();
    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [jobId, displayId]);

  const handlePaymentSuccess = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setStatus('success');
    setTimeout(() => {
      router.push(method === 'QR'
        ? `/job/${jobId}?displayId=${displayId}`
        : `/code?jobId=${jobId}&displayId=${displayId}`);
    }, 1200);
  };

  const handleOpenPhonePe = () => {
    if (checkoutUrl) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setStatus('redirecting');
      window.location.href = checkoutUrl;
    }
  };

  const handleCheckStatus = async () => {
    if (!paymentData) return;
    setStatus('checking');
    setError(null);
    try {
      const checkRes = await verifyPayment(paymentData.paymentId, paymentData.orderId);
      if (checkRes.success && checkRes.data?.verified) {
        handlePaymentSuccess();
      } else {
        setStatus('waiting');
        setError('Payment not confirmed yet. Please complete the payment on PhonePe and try again.');
      }
    } catch {
      setStatus('waiting');
      setError('Could not reach payment server. Please wait a moment.');
    }
  };

  const handleVerifyUtr = async () => {
    if (!utrInput.trim() || !paymentData) return;
    setIsVerifyingUtr(true);
    setError(null);
    try {
      const res = await verifyPayment(paymentData.paymentId, paymentData.orderId, { utr: utrInput.trim() });
      if (res.success && res.data?.verified) {
        handlePaymentSuccess();
      } else {
        setError('Transaction ID not matched. If payment was made, it will auto-confirm shortly.');
      }
    } catch {
      setError('Verification failed. Please wait for auto-confirmation.');
    } finally {
      setIsVerifyingUtr(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col px-4 py-6 bg-[#f8fbff] text-slate-900 font-sans max-w-lg mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-purple-700 hover:text-purple-900 font-bold text-xs bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
        <span className="text-xs font-bold text-slate-500">
          Order: <strong className="text-slate-900 font-mono">{displayId || jobId?.slice(0, 8)}</strong>
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">

        {/* Loading */}
        {status === 'loading' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 space-y-4">
            <Loader2 className="w-16 h-16 text-[#5f259f] animate-spin mx-auto" />
            <h3 className="text-xl font-black text-slate-900">Connecting to PhonePe...</h3>
            <p className="text-slate-500 text-xs font-medium">Creating your secure payment session</p>
          </motion.div>
        )}

        {/* Redirecting */}
        {status === 'redirecting' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-12 space-y-5">
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 border-4 border-purple-400 flex items-center justify-center mx-auto shadow-xl shadow-purple-200">
              <Loader2 className="w-14 h-14 text-[#5f259f] animate-spin" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">Opening PhonePe...</h3>
            <p className="text-slate-500 text-sm font-medium">Redirecting to PhonePe's secure checkout</p>
          </motion.div>
        )}

        {/* Checking */}
        {status === 'checking' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 space-y-4">
            <RefreshCw className="w-14 h-14 text-blue-600 animate-spin mx-auto" />
            <h3 className="text-xl font-black text-slate-900">Verifying Payment...</h3>
            <p className="text-slate-500 text-xs font-medium">Checking with PhonePe PG</p>
          </motion.div>
        )}

        {/* Main Waiting State */}
        {status === 'waiting' && paymentData && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full space-y-4"
          >
            {/* Payment Card */}
            <div className="bg-white rounded-[28px] border-2 border-purple-200 shadow-2xl shadow-purple-100 overflow-hidden">

              {/* Purple header strip */}
              <div className="bg-gradient-to-r from-[#5f259f] to-[#8b3fd8] px-6 py-5 text-center">
                <span className="text-[11px] font-black text-purple-200 uppercase tracking-widest">PhonePe Secure Checkout</span>
                <div className="text-5xl font-black text-white mt-1">₹{amount || paymentData.amount}</div>
                <p className="text-purple-200 text-xs font-medium mt-1">UPI · Cards · Wallets · Net Banking</p>
              </div>

              <div className="p-6 space-y-4">

                {/* PhonePe PG Active — show redirect button */}
                {checkoutUrl && !pgFailed && (
                  <>
                    {/* Auto-redirect badge */}
                    <div className="flex items-center justify-center gap-2 text-xs text-purple-700 font-bold bg-purple-50 py-2.5 px-4 rounded-2xl border border-purple-100">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Auto-redirecting in {countdown}s...</span>
                    </div>

                    {/* Main Pay button */}
                    <button
                      onClick={handleOpenPhonePe}
                      className="w-full py-4 px-4 rounded-2xl bg-[#5f259f] hover:bg-[#4d1e82] text-white font-black text-base flex items-center justify-center gap-3 shadow-lg shadow-purple-900/20 active:scale-95 transition-all"
                    >
                      <Smartphone className="w-5 h-5 text-purple-200" />
                      <span>Pay ₹{amount || paymentData.amount} via PhonePe</span>
                      <ExternalLink className="w-4 h-4 opacity-60 ml-auto" />
                    </button>

                    {/* Check status after returning */}
                    <button
                      onClick={handleCheckStatus}
                      className="w-full py-3 px-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center gap-2 border border-emerald-200 transition-all"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>I have paid — Verify Now</span>
                    </button>
                  </>
                )}

                {/* PhonePe API failed — show helpful fallback */}
                {pgFailed && (
                  <>
                    <div className="flex items-start gap-3 text-xs text-amber-800 font-medium bg-amber-50 px-4 py-3 rounded-2xl border border-amber-200">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>PhonePe gateway is temporarily unreachable. You can still pay by scanning with any UPI app or enter your Transaction ID after paying.</span>
                    </div>

                    {/* Manual check button */}
                    <button
                      onClick={handleCheckStatus}
                      className="w-full py-3.5 px-4 rounded-2xl bg-[#5f259f] hover:bg-[#4d1e82] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Check Payment Status</span>
                    </button>
                  </>
                )}

                {/* Error message */}
                {error && (
                  <p className="text-xs text-rose-600 font-bold bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl text-center">
                    {error}
                  </p>
                )}

                {/* Merchant info */}
                <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400">Payment Gateway: <strong className="text-slate-700">PhonePe PG Live</strong></p>
                    <p className="text-[10px] font-mono text-purple-700 font-bold">MID: M236NFVVSAXD2</p>
                  </div>
                  <span className="text-[10px] bg-purple-50 text-purple-700 font-extrabold px-2.5 py-1 rounded-lg border border-purple-200">
                    ● Live
                  </span>
                </div>
              </div>
            </div>

            {/* UTR manual entry */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => setShowUtrField(!showUtrField)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 hover:text-purple-700 transition-colors"
              >
                <span>Paid but screen didn't update?</span>
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
                    <p className="text-[11px] text-slate-500">Enter the 12-digit UPI Transaction ID from your PhonePe receipt:</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. 428900000000"
                        value={utrInput}
                        onChange={(e) => setUtrInput(e.target.value)}
                        className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:border-purple-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyUtr}
                        disabled={isVerifyingUtr || !utrInput.trim()}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-colors"
                      >
                        {isVerifyingUtr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verify'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Live detection pulse */}
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Auto-detecting payment confirmation in real time
            </div>
          </motion.div>
        )}

        {/* Success */}
        {status === 'success' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-10 space-y-3">
            <div className="w-24 h-24 rounded-full bg-emerald-100 border-4 border-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-200">
              <CheckCircle2 className="w-14 h-14 text-emerald-600 stroke-[2.5]" />
            </div>
            <h3 className="text-3xl font-black text-slate-900">Payment Received! ✓</h3>
            <p className="text-slate-500 text-sm font-medium">Generating your print release code...</p>
          </motion.div>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-10 space-y-4 max-w-sm">
            <div className="w-20 h-20 rounded-full bg-rose-100 border-4 border-rose-300 flex items-center justify-center mx-auto">
              <XCircle className="w-12 h-12 text-rose-600" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">Payment Error</h3>
            <p className="text-rose-600 text-xs font-bold bg-rose-50 border border-rose-200 p-3 rounded-xl">{error || 'Unable to initialize payment.'}</p>
            <button onClick={() => router.push('/remote')} className="w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-black rounded-2xl shadow-lg transition-all">
              Try Again
            </button>
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-4 text-center">
        <p className="text-[11px] font-bold text-slate-400 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          Powered by PhonePe PG · PCI DSS Compliant · NPCI Certified
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
