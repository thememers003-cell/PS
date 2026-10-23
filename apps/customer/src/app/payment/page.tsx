'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { verifyPayment, getApiUrl } from '../../lib/api';

function PaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const displayId = searchParams.get('displayId');
  const amount = searchParams.get('amount');
  const method = searchParams.get('method') || 'CODE';
  const initialCodeParam = searchParams.get('printCode') || searchParams.get('code');
  const [cachedCode, setCachedCode] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('xpos_last_code');
      if (stored && /^\d{6}$/.test(stored)) setCachedCode(stored);
    }
  }, []);
  const validInitialCode = (initialCodeParam && /^\d{6}$/.test(initialCodeParam)) ? initialCodeParam : cachedCode;

  const [status, setStatus] = useState<'loading' | 'redirecting' | 'waiting' | 'checking' | 'success' | 'failed'>('loading');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [utrInput, setUtrInput] = useState('');
  const [showUtrField, setShowUtrField] = useState(false);
  const [isVerifyingUtr, setIsVerifyingUtr] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function startPhonePeCheckout() {
      if (!jobId) return;

      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('xpos_last_job_id', jobId);
          if (displayId) localStorage.setItem('xpos_last_display_id', displayId);
          if (validInitialCode) localStorage.setItem('xpos_last_code', validInitialCode);
        }
        setStatus('loading');
        setError(null);

        // Dynamically compute return redirect URL based on current host
        const redirectOrigin = window.location.origin.includes('riseupsolutions.in')
          ? 'https://riseupsolutions.in'
          : window.location.origin;

        const codeQuery = validInitialCode ? `&printCode=${validInitialCode}` : '';

        // Directly create live PhonePe checkout session (zero mock intermediate calls)
        const res = await fetch('/api/phonepe/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            amount: amount || 1,
            displayId,
            redirectUrl: `${redirectOrigin}/code?jobId=${jobId}&displayId=${displayId || ''}${codeQuery}`,
          }),
        });

        const data = await res.json();
        if (!isMounted) return;

        if (data.success && data.data?.checkoutUrl) {
          const pgUrl = data.data.checkoutUrl;
          const currentOrderId = data.data.orderId;
          const currentPaymentId = data.data.paymentId || `pay_${jobId}`;

          setCheckoutUrl(pgUrl);
          setOrderId(currentOrderId);
          setPaymentId(currentPaymentId);
          setStatus('redirecting');

          // Connect WebSocket for instant confirmation
          const socket = io(getApiUrl(), { transports: ['websocket', 'polling'] });
          socketRef.current = socket;
          socket.on('connect', () => {
            socket.emit('join', `job:${jobId}`);
            socket.emit('join_job', jobId);
          });
          socket.on('payment_verified', (wsData: any) => {
            if (wsData.jobId === jobId || wsData.displayId === displayId) {
              handlePaymentSuccess(wsData.printCode);
            }
          });

          // Start polling in background
          pollIntervalRef.current = setInterval(async () => {
            try {
              const checkRes = await verifyPayment(currentPaymentId, currentOrderId, { jobId });
              if (checkRes.success && checkRes.data?.verified) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                handlePaymentSuccess(checkRes.data?.printCode);
              }
            } catch { /* silent */ }
          }, 3000);

          // Direct instant browser redirect to PhonePe
          window.location.href = pgUrl;
        } else {
          setStatus('failed');
          setError(data.error || 'Failed to connect to PhonePe gateway.');
        }
      } catch (err: any) {
        if (isMounted) {
          setStatus('failed');
          setError(err?.message || 'Network error while contacting PhonePe.');
        }
      }
    }

    startPhonePeCheckout();

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [jobId, displayId, amount]);

  const handlePaymentSuccess = (verifiedCode?: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setStatus('success');
    setTimeout(() => {
      const activeCode = verifiedCode || validInitialCode;
      const codeQuery = activeCode ? `&printCode=${activeCode}` : '';
      const targetPath = method === 'QR'
        ? `/job/${jobId}?displayId=${displayId || ''}`
        : `/code?jobId=${jobId}&displayId=${displayId || ''}&orderId=${orderId || ''}${codeQuery}`;
      router.push(targetPath);
    }, 1000);
  };

  const handleOpenPhonePe = () => {
    if (checkoutUrl) {
      setStatus('redirecting');
      window.location.href = checkoutUrl;
    }
  };

  const handleCheckStatus = async () => {
    if (!orderId && !paymentId) return;
    setStatus('checking');
    setError(null);
    try {
      const checkRes = await verifyPayment(paymentId || '', orderId || '');
      if (checkRes.success && checkRes.data?.verified) {
        handlePaymentSuccess();
      } else {
        setStatus('waiting');
        setError('Payment not confirmed yet. Please complete the transaction on PhonePe and tap Verify.');
      }
    } catch {
      setStatus('waiting');
      setError('Could not reach verification server. Please wait a moment.');
    }
  };

  const handleVerifyUtr = async () => {
    if (!utrInput.trim()) return;
    setIsVerifyingUtr(true);
    setError(null);
    try {
      const res = await verifyPayment(paymentId || '', orderId || '', { utr: utrInput.trim() });
      if (res.success && res.data?.verified) {
        handlePaymentSuccess();
      } else {
        setError('Transaction ID not matched. If payment was made, it will auto-confirm shortly.');
      }
    } catch {
      setError('Verification failed. Please wait a moment.');
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

        {/* Loading / Connecting */}
        {status === 'loading' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 space-y-4">
            <Loader2 className="w-16 h-16 text-[#5f259f] animate-spin mx-auto" />
            <h3 className="text-xl font-black text-slate-900">Connecting to PhonePe...</h3>
            <p className="text-slate-500 text-xs font-medium">Opening secure checkout gateway</p>
          </motion.div>
        )}

        {/* Redirecting to PhonePe */}
        {status === 'redirecting' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-12 space-y-5">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 border-4 border-purple-400 flex items-center justify-center mx-auto shadow-xl shadow-purple-200">
              <Loader2 className="w-12 h-12 text-[#5f259f] animate-spin" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">Opening PhonePe...</h3>
            <p className="text-slate-500 text-xs font-medium">Redirecting to PhonePe secure checkout</p>
            {checkoutUrl && (
              <button
                onClick={handleOpenPhonePe}
                className="mt-4 px-6 py-3 bg-[#5f259f] hover:bg-[#4d1e82] text-white font-bold text-sm rounded-2xl shadow-lg transition-all flex items-center gap-2 mx-auto"
              >
                <span>Click if not redirected automatically</span>
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
          </motion.div>
        )}

        {/* Checking */}
        {status === 'checking' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 space-y-4">
            <RefreshCw className="w-14 h-14 text-blue-600 animate-spin mx-auto" />
            <h3 className="text-xl font-black text-slate-900">Verifying Payment...</h3>
            <p className="text-slate-500 text-xs font-medium">Confirming with PhonePe</p>
          </motion.div>
        )}

        {/* Waiting / Returned from PhonePe screen */}
        {status === 'waiting' && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-4">
            <div className="bg-white rounded-[28px] border-2 border-purple-200 shadow-xl overflow-hidden p-6 space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-purple-50 border-2 border-purple-200 flex items-center justify-center mx-auto">
                <Smartphone className="w-8 h-8 text-[#5f259f]" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">Payment in Progress</h3>
                <p className="text-xs text-slate-500 mt-1">Amount: <strong>₹{amount || 1}</strong></p>
              </div>

              {checkoutUrl && (
                <button
                  onClick={handleOpenPhonePe}
                  className="w-full py-4 px-4 rounded-2xl bg-[#5f259f] hover:bg-[#4d1e82] text-white font-black text-base flex items-center justify-center gap-3 shadow-lg transition-all"
                >
                  <span>Re-open PhonePe Checkout</span>
                  <ExternalLink className="w-4 h-4 ml-auto" />
                </button>
              )}

              <button
                onClick={handleCheckStatus}
                className="w-full py-3.5 px-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center gap-2 border border-emerald-200 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>I have paid — Verify Now</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const activeCode = validInitialCode || '';
                  const codeQuery = activeCode ? `&printCode=${activeCode}&code=${activeCode}` : '';
                  router.push(`/code?jobId=${jobId}&displayId=${displayId || ''}&orderId=${orderId || ''}${codeQuery}`);
                }}
                className="w-full py-2.5 text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center justify-center gap-1 transition-colors"
              >
                <span>Need your 6-digit code now? View Print Code</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              {error && (
                <p className="text-xs text-rose-600 font-bold bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">
                  {error}
                </p>
              )}
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
                    <p className="text-[11px] text-slate-500">Enter the 12-digit UPI Reference / UTR Number:</p>
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
            <h3 className="text-2xl font-black text-slate-900">Payment Notice</h3>
            <p className="text-slate-600 text-xs font-semibold bg-slate-50 border border-slate-200 p-3 rounded-xl">{error || 'Unable to initialize PhonePe payment.'}</p>
            <div className="space-y-2 pt-2">
              <button
                onClick={() => {
                  const activeCode = validInitialCode || '';
                  const codeQuery = activeCode ? `&printCode=${activeCode}&code=${activeCode}` : '';
                  router.push(`/code?jobId=${jobId}&displayId=${displayId || ''}&orderId=${orderId || ''}${codeQuery}`);
                }}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm rounded-2xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2"
              >
                <span>View & Print With 6-Digit Code</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
              >
                Retry PhonePe Payment
              </button>
            </div>
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
          <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
        </div>
      }
    >
      <PaymentContent />
    </Suspense>
  );
}
