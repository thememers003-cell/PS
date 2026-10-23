'use client';

import { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Copy,
  ArrowLeft,
  Loader2,
  Camera,
  ShieldCheck,
  Check,
  Printer,
  Sparkles,
  Heart,
  MessageCircleHeart,
  QrCode,
  FileText,
  Layers,
  Smartphone,
  X,
  AlertCircle,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { generatePrintCode, getJob, pairKioskWithCode, getKiosks, createPayment, verifyPayment } from '../../lib/api';
import { getRandomCharmingLine, getRandomCompletionLine } from '../../lib/charming-lines';
import { playKeySound } from '../../lib/sound';

function CodeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const displayId = searchParams.get('displayId');
  const orderIdParam = searchParams.get('orderId') || searchParams.get('merchantOrderId') || searchParams.get('transactionId');
  const rawCodeParam = searchParams.get('printCode') || searchParams.get('code');
  const incomingPrintCode = (rawCodeParam && /^\d{6}$/.test(rawCodeParam)) ? rawCodeParam : null;
  const phonepeStatus = (!incomingPrintCode && rawCodeParam) ? rawCodeParam : (searchParams.get('status') || searchParams.get('state'));
  const pairKioskParam = searchParams.get('pairKiosk') || searchParams.get('kiosk');
  const pairTokenParam = searchParams.get('pairToken') || searchParams.get('token');

  const [code, setCode] = useState<string | null>(incomingPrintCode);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [jobInfo, setJobInfo] = useState<any>(null);
  const [jobStatus, setJobStatus] = useState<string>('QUEUED');
  const [printedKiosk, setPrintedKiosk] = useState<string | null>(null);

  const handleManualReconcile = async () => {
    setIsRetrying(true);
    setError(null);
    try {
      const activeJobId = resolvedJobId || jobId;
      if (activeJobId) {
        const jobRes = await getJob(activeJobId);
        if (jobRes.success && jobRes.data?.printCode?.code) {
          setCode(jobRes.data.printCode.code);
          if (jobRes.data.printCode.expiresAt) setExpiresAt(new Date(jobRes.data.printCode.expiresAt));
          setJobStatus('QUEUED');
          setError(null);
          setIsRetrying(false);
          return;
        }

        const codeRes = await generatePrintCode(activeJobId, undefined, orderIdParam || undefined, incomingPrintCode || undefined);
        if (codeRes.success && codeRes.data?.code) {
          setCode(codeRes.data.code);
          setExpiresAt(new Date(codeRes.data.expiresAt));
          setJobStatus('QUEUED');
          setError(null);
        }
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setIsRetrying(false);
    }
  };

  // Scanner state (Instant Release Pairing)
  const [showScanner, setShowScanner] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairingStatus, setPairingStatus] = useState('');
  const [scannerError, setScannerError] = useState('');
  const [manualKioskId, setManualKioskId] = useState('');
  const [availableKiosks, setAvailableKiosks] = useState<any[]>([]);
  const html5QrCodeRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load available kiosks for quick 1-tap release
  useEffect(() => {
    getKiosks().then(res => {
      if (res.success && Array.isArray(res.data)) {
        setAvailableKiosks(res.data.filter((k: any) => k.status === 'ACTIVE'));
      }
    }).catch(() => {});
  }, []);

  // Random charming line for active code screen
  const [charmingLine, setCharmingLine] = useState<string>('');
  // Random celebration line for completed screen
  const [completionLine, setCompletionLine] = useState<string>('');

  useEffect(() => {
    setCharmingLine(getRandomCharmingLine());
    setCompletionLine(getRandomCompletionLine());
  }, []);

  const [resolvedJobId, setResolvedJobId] = useState<string | null>(jobId || null);

  // ── Auto-Pair if kiosk parameters provided in URL ──
  const autoPairAttemptedRef = useRef(false);
  useEffect(() => {
    if (!code || !pairKioskParam || autoPairAttemptedRef.current || jobStatus === 'COMPLETED' || jobStatus === 'PRINTING') {
      return;
    }
    autoPairAttemptedRef.current = true;
    handlePairWithKiosk(pairKioskParam, pairTokenParam || undefined);
  }, [code, pairKioskParam, pairTokenParam, jobStatus]);

  // ── Core Kiosk Pairing Handler ──
  const handlePairWithKiosk = async (targetKioskId: string, pairToken?: string) => {
    if (!targetKioskId || isPairing) return;
    setIsPairing(true);
    setScannerError('');
    setPairingStatus(`Linking with Station ${targetKioskId}...`);

    try {
      const res = await pairKioskWithCode({
        code: code || '',
        kioskId: targetKioskId.trim(),
        pairToken: pairToken || undefined,
        jobId: resolvedJobId || undefined,
      });

      if (res.success) {
        playKeySound('success');
        setPairingStatus(`✓ Paired with ${targetKioskId}! Starting Print...`);
        setPrintedKiosk(targetKioskId);
        setJobStatus('PRINTING');

        // Stop scanner safely
        if (html5QrCodeRef.current) {
          try {
            await html5QrCodeRef.current.stop();
          } catch {}
        }

        setTimeout(() => {
          setShowScanner(false);
          setIsPairing(false);
        }, 1200);
      } else {
        playKeySound('error');
        setScannerError(res.error || 'Failed to link with kiosk. Please try again.');
        setIsPairing(false);
      }
    } catch (e: any) {
      playKeySound('error');
      setScannerError(e?.message || 'Connection error while pairing with kiosk.');
      setIsPairing(false);
    }
  };

  // ── Process Scanned QR Text ──
  const handleQrScanned = useCallback((decodedText: string) => {
    if (isPairing) return;
    console.log('📷 Scanned QR Data:', decodedText);

    let extractedKioskId = '';
    let extractedToken = '';

    // 1. Try parsing JSON format: { type: 'xpos_kiosk_pair', kioskId: 'XPOS-001', token: '...' }
    try {
      const parsed = JSON.parse(decodedText);
      if (parsed.kioskId) {
        extractedKioskId = parsed.kioskId;
        extractedToken = parsed.token || parsed.pairToken || '';
      }
    } catch {
      // 2. Try parsing URL format: https://.../code?kiosk=XPOS-001&pairToken=...
      try {
        const url = new URL(decodedText);
        extractedKioskId = url.searchParams.get('kiosk') || url.searchParams.get('pairKiosk') || '';
        extractedToken = url.searchParams.get('token') || url.searchParams.get('pairToken') || '';
      } catch {
        // 3. Try string format "XPOS_PAIR:XPOS-001:token" or direct "XPOS-001"
        if (decodedText.startsWith('XPOS_PAIR:')) {
          const parts = decodedText.split(':');
          extractedKioskId = parts[1] || '';
          extractedToken = parts[2] || '';
        } else if (decodedText.startsWith('XPOS-')) {
          extractedKioskId = decodedText.trim();
        }
      }
    }

    if (!extractedKioskId) {
      setScannerError('Could not recognize a valid Print Bro kiosk QR code. Please scan the QR code on the kiosk screen.');
      return;
    }

    handlePairWithKiosk(extractedKioskId, extractedToken);
  }, [isPairing, code, resolvedJobId]);

  // ── Mobile QR Scanner Activation ──
  const handleOpenScanner = () => {
    playKeySound('tap');
    setScannerError('');
    setShowScanner(true);
    setPairingStatus('Opening scanner...');
  };

  // ── Native Mobile Camera Photo Scanner (Works 100% on Mobile / HTTP / Local IP) ──
  const handleMobilePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    playKeySound('tap');
    setScannerError('');
    setPairingStatus('Scanning QR from camera photo...');

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      // Stop live camera if running
      if (html5QrCodeRef.current) {
        try {
          await html5QrCodeRef.current.stop();
        } catch {}
      }

      const scanner = new Html5Qrcode('kiosk-qr-scanner-box');
      const decodedText = await scanner.scanFile(file, true);
      console.log('📷 Decoded QR from mobile photo:', decodedText);
      handleQrScanned(decodedText);
    } catch (err: any) {
      console.warn('Failed to parse QR from photo:', err);
      setScannerError('Could not read QR code from photo. Please ensure the QR on the kiosk screen is clear and well-lit, or type Station ID below.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Camera Scanner Lifecycle using Html5Qrcode ──
  useEffect(() => {
    if (!showScanner) {
      if (html5QrCodeRef.current) {
        try {
          html5QrCodeRef.current.stop().catch(() => {});
        } catch {}
        html5QrCodeRef.current = null;
      }
      return;
    }

    let isCancelled = false;

    async function initScanner() {
      try {
        setScannerError('');
        setPairingStatus('Initializing camera...');
        const { Html5Qrcode } = await import('html5-qrcode');

        if (isCancelled) return;

        const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
        if (!hasMediaDevices) {
          // Non-secure context (e.g. mobile accessing local IP http://192.168.x.x)
          setPairingStatus('Tap "Snap Photo" below to scan with mobile camera');
          return;
        }

        const scannerId = 'kiosk-qr-scanner-box';
        const scanner = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = scanner;

        const config = {
          fps: 15,
          qrbox: { width: 230, height: 230 },
          aspectRatio: 1.0,
        };

        const successCallback = (decodedText: string) => {
          if (!isCancelled) {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate([40, 40, 80]);
            }
            handleQrScanned(decodedText);
          }
        };

        // Try environment camera first
        try {
          await scanner.start(
            { facingMode: { ideal: 'environment' } },
            config,
            successCallback,
            () => {}
          );
          if (!isCancelled) setPairingStatus('Point camera at the kiosk screen QR code');
        } catch (envErr) {
          // Fallback to user/front camera or default
          try {
            await scanner.start(
              { facingMode: 'user' },
              config,
              successCallback,
              () => {}
            );
            if (!isCancelled) setPairingStatus('Point camera at the kiosk screen QR code');
          } catch (fallbackErr) {
            console.warn('Live stream camera start error:', fallbackErr);
            if (!isCancelled) {
              setPairingStatus('Live preview blocked. Tap "Snap Photo" below to scan!');
            }
          }
        }
      } catch (err: any) {
        console.warn('Scanner camera error:', err);
        if (!isCancelled) {
          setScannerError('Camera feed unavailable. Tap "Snap Photo" below or pick your Station!');
        }
      }
    }

    // Small delay to ensure DOM element is mounted
    const timer = setTimeout(initScanner, 200);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        try {
          html5QrCodeRef.current.stop().catch(() => {});
        } catch {}
        html5QrCodeRef.current = null;
      }
    };
  }, [showScanner, handleQrScanned]);

  // ── Load directly from API (Guaranteed code issuance on /code redirect) ──
  useEffect(() => {
    let effectiveJobId = jobId;
    let effectiveDisplayId = displayId;

    if (!effectiveJobId && typeof window !== 'undefined') {
      effectiveJobId = localStorage.getItem('xpos_last_job_id') || localStorage.getItem('xpos_active_job_id');
    }
    if (!effectiveDisplayId && typeof window !== 'undefined') {
      effectiveDisplayId = localStorage.getItem('xpos_last_display_id') || localStorage.getItem('xpos_active_display_id');
    }

    if (!effectiveJobId && !effectiveDisplayId && !orderIdParam && !incomingPrintCode) {
      setLoading(false);
      return;
    }

    const cacheKey = effectiveJobId || effectiveDisplayId || orderIdParam || 'active';
    try {
      const cached = localStorage.getItem(`xpos_code_${cacheKey}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.code) {
          setCode(parsed.code);
          if (parsed.expiresAt) setExpiresAt(new Date(parsed.expiresAt));
          if (parsed.jobInfo) setJobInfo(parsed.jobInfo);
          if (parsed.jobId) setResolvedJobId(parsed.jobId);
          setLoading(false);
        }
      }
    } catch {}

    async function loadCode() {
      try {
        let activeJobId = effectiveJobId;

        // 1. Resolve jobId if only displayId or orderIdParam was provided
        if (!activeJobId && effectiveDisplayId) {
          const jobLookup = await getJob(effectiveDisplayId);
          if (jobLookup.success && jobLookup.data?.id) {
            activeJobId = jobLookup.data.id;
            setResolvedJobId(activeJobId);
            setJobInfo(jobLookup.data);
            if (jobLookup.data.status) setJobStatus(jobLookup.data.status);
          }
        }

        if (!activeJobId && orderIdParam) {
          const jobLookup = await getJob(orderIdParam);
          if (jobLookup.success && jobLookup.data?.id) {
            activeJobId = jobLookup.data.id;
            setResolvedJobId(activeJobId);
            setJobInfo(jobLookup.data);
            if (jobLookup.data.status) setJobStatus(jobLookup.data.status);
          }
        }

        if (!activeJobId) {
          setError('Job not found for this code.');
          setLoading(false);
          return;
        }

        setResolvedJobId(activeJobId);

        // 2. Fetch authoritative job data from backend
        let authoritativeCode: string | null = incomingPrintCode;
        let authoritativeExpires: Date | null = null;

        const jobRes = await getJob(activeJobId, orderIdParam || undefined);
        if (jobRes.success && jobRes.data) {
          setJobInfo(jobRes.data);
          if (jobRes.data.status) setJobStatus(jobRes.data.status === 'CREATED' ? 'QUEUED' : jobRes.data.status);
          if (jobRes.data.kiosk?.displayId) setPrintedKiosk(jobRes.data.kiosk.displayId);
          if (jobRes.data.printCode?.code) {
            authoritativeCode = jobRes.data.printCode.code;
            if (jobRes.data.printCode.expiresAt) authoritativeExpires = new Date(jobRes.data.printCode.expiresAt);
          }
        }

        // 3. Generate or sync print code on backend, ensuring QUEUED status and Admin broadcast
        const res = await generatePrintCode(
          activeJobId,
          undefined,
          orderIdParam || undefined,
          authoritativeCode || undefined
        );

        if (res.success && res.data?.code) {
          const finalCode = res.data.code;
          const finalExpires = new Date(res.data.expiresAt || Date.now() + 24 * 60 * 60 * 1000);

          setCode(finalCode);
          setExpiresAt(finalExpires);
          setJobStatus('QUEUED');
          setError(null);

          const freshJobRes = await getJob(activeJobId, orderIdParam || undefined);
          const freshJobInfo = freshJobRes.success ? freshJobRes.data : jobInfo;
          if (freshJobInfo) {
            setJobInfo(freshJobInfo);
            if (freshJobInfo.kiosk?.displayId) setPrintedKiosk(freshJobInfo.kiosk.displayId);
          }

          const cachePayload = JSON.stringify({
            code: finalCode,
            expiresAt: finalExpires.toISOString(),
            jobId: activeJobId,
            displayId: res.data.displayId || displayId || effectiveDisplayId,
            jobInfo: freshJobInfo,
            savedAt: new Date().toISOString(),
          });

          localStorage.setItem(`xpos_code_${cacheKey}`, cachePayload);
          localStorage.setItem(`xpos_code_${activeJobId}`, cachePayload);
          if (displayId) localStorage.setItem(`xpos_code_${displayId}`, cachePayload);
        } else if (authoritativeCode) {
          setCode(authoritativeCode);
          if (authoritativeExpires) setExpiresAt(authoritativeExpires);
          setJobStatus('QUEUED');
          setError(null);
        }
      } catch (err: any) {
        console.warn('loadCode exception:', err);
      } finally {
        setLoading(false);
      }
    }

    loadCode();
  }, [jobId, displayId, orderIdParam, incomingPrintCode]);

  // ── Real-time Job Status Polling & WebSocket Live Push ──
  useEffect(() => {
    const targetJobId = resolvedJobId || jobId || displayId;
    if (!targetJobId) return;

    let isSubscribed = true;
    const checkStatus = async () => {
      try {
        const res = await getJob(targetJobId);
        if (res.success && res.data && isSubscribed) {
          const currentStatus = res.data.status;
          setJobStatus(currentStatus);
          if (res.data.kiosk?.displayId) {
            setPrintedKiosk(res.data.kiosk.displayId);
          }
          if (res.data.file) {
            setJobInfo(res.data);
          }
          if (res.data.printCode?.code) {
            setCode(res.data.printCode.code);
            if (res.data.printCode.expiresAt) setExpiresAt(new Date(res.data.printCode.expiresAt));
          }
          if (currentStatus === 'COMPLETED') {
            try {
              localStorage.removeItem(`xpos_code_${targetJobId}`);
            } catch {}
          }
        }
      } catch {}
    };

    // Polling every 1 second for ultra-fast customer screen updates
    const interval = setInterval(checkStatus, 1000);
    checkStatus();

    // WebSocket listener for instant zero-latency push
    let socket: any = null;
    try {
      const { connectSocket } = require('../../lib/socket');
      socket = connectSocket();

      const handleUpdate = (data: any) => {
        if (!isSubscribed || !data) return;
        const matches =
          data.jobId === targetJobId ||
          data.id === targetJobId ||
          data.displayId === targetJobId ||
          data.jobId === resolvedJobId ||
          data.id === resolvedJobId;

        if (matches) {
          if (data.status) {
            setJobStatus(data.status);
            if (data.status === 'COMPLETED') {
              playKeySound('success');
            }
          }
          if (data.printCode) {
            setCode(data.printCode);
          }
          if (data.printCodeExpiresAt) {
            setExpiresAt(new Date(data.printCodeExpiresAt));
          }
          if (data.kiosk?.displayId) {
            setPrintedKiosk(data.kiosk.displayId);
          }
        }
      };

      socket.emit('join', `job:${targetJobId}`);
      socket.emit('join_job', targetJobId);
      if (resolvedJobId && resolvedJobId !== targetJobId) {
        socket.emit('join', `job:${resolvedJobId}`);
        socket.emit('join_job', resolvedJobId);
      }

      socket.on('job_update', handleUpdate);
      socket.on('job_updated', handleUpdate);
      socket.on('payment_verified', handleUpdate);
    } catch {}

    return () => {
      isSubscribed = false;
      clearInterval(interval);
      if (socket) {
        socket.off('job_update');
        socket.off('job_updated');
        socket.off('payment_verified');
      }
    };
  }, [resolvedJobId, jobId, displayId]);

  // ── Countdown Timer (24-Hour Handler) ──
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setRemaining(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const formatTime = (seconds: number) => {
    if (seconds <= 0) return 'Expired';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ── Copy Code Function ──
  const copyCode = useCallback(async () => {
    if (!code) return;
    playKeySound('success');
    let copiedSuccess = false;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(code);
        copiedSuccess = true;
      } catch {}
    }

    if (!copiedSuccess) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        copiedSuccess = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (e) {}
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fbff]">
        <Loader2 className="w-14 h-14 text-blue-600 animate-spin mb-4" />
        <p className="text-slate-900 font-extrabold text-lg">Verifying Print Code...</p>
      </div>
    );
  }

  if (error && !code && jobStatus !== 'COMPLETED' && !orderIdParam) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f8fbff] text-center max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-full bg-rose-50 border-2 border-rose-200 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-rose-600" />
        </div>
        <h3 className="text-xl font-black text-slate-900 mb-2">Payment Confirmation</h3>
        <p className="text-slate-500 text-xs mb-6 font-medium">
          If you just completed payment on PhonePe, tap below to confirm and reveal your 6-digit release code.
        </p>
        <button
          onClick={handleManualReconcile}
          disabled={isRetrying}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-sm rounded-2xl shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2 mb-3 disabled:opacity-50"
        >
          {isRetrying ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
          <span>{isRetrying ? 'Confirming...' : 'I Have Paid — Get Release Code'}</span>
        </button>
        <button
          onClick={() => {
            playKeySound('tap');
            router.push('/');
          }}
          className="text-slate-400 font-bold text-xs py-2 hover:text-slate-600"
        >
          Go Back Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-4 py-6 max-w-lg md:max-w-xl mx-auto bg-[#f8fbff] text-slate-900 font-sans">
      {/* Header & Back Button */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => {
          playKeySound('tap');
          router.push('/');
        }} className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold text-sm bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 active:scale-95 transition-transform shadow-sm">
          <ArrowLeft className="w-4 h-4" />
          <span>Home</span>
        </button>
        <span className="text-xs font-bold text-slate-500 font-mono">Job: {displayId || jobInfo?.displayId || 'Active'}</span>
      </div>

      {/* 🌟 Top Print Bro Branding */}
      <motion.div
        initial={{ y: -6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex flex-col items-center justify-center text-center mt-1 mb-3"
      >
        <img src="/printbro_logo.png" alt="PrintBro" className="h-10 md:h-12 object-contain" />
      </motion.div>

      {/* 💖 ENLARGED, HIGH-IMPACT CHARMING & FLIRTY QUOTE BOX */}
      {charmingLine && jobStatus !== 'COMPLETED' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="mb-4 p-4 rounded-3xl bg-gradient-to-r from-blue-50 via-indigo-50/70 to-blue-50 border-2 border-blue-200/90 shadow-md shadow-blue-500/5 text-center flex flex-col items-center justify-center gap-1.5"
        >
          <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-700 bg-white/90 px-3 py-0.5 rounded-full border border-blue-200">
            <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
            <span>A Note For You</span>
            <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
          </div>
          <p className="text-sm md:text-base font-black text-slate-900 leading-snug">
            "{charmingLine}"
          </p>
        </motion.div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center">
        {/* ════════════════════════════════════════════════ */}
        {/* CASE 1: PRINT COMPLETED (CELEBRATORY PAPER OUT ANIMATION) */}
        {/* ════════════════════════════════════════════════ */}
        {jobStatus === 'COMPLETED' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 18 }}
            className="text-center w-full"
          >
            {/* Animated Paper Coming Out of Printer Slot */}
            <div className="relative w-40 h-40 mx-auto mb-3 flex items-center justify-center">
              {/* Printer Base Slot */}
              <div className="absolute bottom-2 w-36 h-9 bg-slate-800 rounded-xl shadow-xl border-2 border-slate-700 flex items-center justify-center">
                <div className="w-28 h-1.5 bg-slate-950 rounded-full" />
              </div>

              {/* Emerging Paper Sheet with Smooth Upward Spring */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: -15, opacity: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 140, damping: 12 }}
                className="w-26 h-32 bg-white border-2 border-blue-200 rounded-xl shadow-2xl flex flex-col items-center justify-between p-2.5 z-10"
              >
                <div className="w-full h-2 bg-blue-600 rounded-full" />
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div className="w-3/4 h-1.5 bg-slate-200 rounded-full" />
              </motion.div>

              {/* Celebratory Sparkles */}
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: 'linear' }} className="absolute -top-1 -right-1 text-amber-500">
                <Sparkles className="w-7 h-7" />
              </motion.div>
            </div>

            <h1 className="text-3xl md:text-4xl font-display font-black text-slate-900 mb-1 tracking-tight">PRINT COMPLETED! 🎉</h1>

            {/* 🎉 High-Impact Celebratory Quote Box on Completion */}
            <div className="my-3 p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-center flex items-center justify-center gap-2 shadow-sm">
              <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse flex-shrink-0" />
              <p className="text-sm md:text-base font-black text-emerald-950">
                "{completionLine || 'Your print is ready, my dear! ✨'}"
              </p>
              <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse flex-shrink-0" />
            </div>

            <p className="text-slate-600 text-sm mb-4">
              Your document is ready in the tray at <strong className="text-blue-700 font-bold">{printedKiosk || 'Print Bro Kiosk'}</strong>.
            </p>

            <div className="bg-white border border-blue-100 p-5 rounded-3xl mb-5 text-left space-y-3 shadow-md shadow-blue-500/5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 font-bold">Job ID</span>
                <span className="text-slate-900 font-mono font-black">{displayId || jobInfo?.displayId}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 font-bold">Document</span>
                <span className="text-slate-900 font-black truncate max-w-[220px]">{jobInfo?.file?.originalName}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 font-bold">Total Pages</span>
                <span className="text-slate-900 font-black">{jobInfo?.totalPages || 1} pages</span>
              </div>
            </div>

            <button
              onClick={() => router.push('/remote')}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-base shadow-md shadow-blue-500/20 transition-all active:scale-[0.98]"
            >
              🖨️ Print Another Document
            </button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center w-full space-y-4"
          >
            {/* ════════════════════════════════════════════════ */}
            {/* DYNAMIC CENTERED BANNER: SCREENSHOT ALERT -> PRINTING IN PROGRESS */}
            {/* ════════════════════════════════════════════════ */}
            {jobStatus === 'PRINTING' ? (
              /* Replaces Screenshot Banner with Printing In-Progress Banner */
              <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-400 text-center shadow-sm flex flex-col items-center justify-center gap-1.5 animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-blue-100 border border-blue-300 flex items-center justify-center text-blue-700 mb-0.5">
                  <Printer className="w-6 h-6" />
                </div>
                <p className="font-black text-slate-900 text-sm uppercase tracking-wider">🖨️ PRINTING IN PROGRESS</p>
                <p className="text-slate-600 text-xs font-medium leading-tight">
                  Your document is printing at the kiosk. Please collect it from the printer tray.
                </p>
              </div>
            ) : (
              /* Centered, Sleek Highlighted Screenshot Alert */
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50/80 border-2 border-amber-300 text-center shadow-sm flex flex-col items-center justify-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-[11px] font-black uppercase tracking-widest text-amber-900 bg-amber-200/90 px-3 py-0.5 rounded-md">
                    ⚠️ IMPORTANT NOTICE
                  </span>
                </div>
                <p className="font-black text-amber-950 text-sm leading-snug">
                  📸 Take a screenshot of this code now
                </p>
                <p className="text-amber-900/90 text-xs mt-0.5 font-medium leading-tight max-w-sm mx-auto">
                  Save this 6-digit code or take a screenshot before leaving. Valid for <strong className="font-black text-amber-950">24 Hours</strong> at any Print Bro kiosk.
                </p>
              </div>
            )}

            {/* ════════════════════════════════════════════════ */}
            {/* 📄 2. UPLOADED FILE & PAGES TO BE PRINTED DETAILS */}
            {/* ════════════════════════════════════════════════ */}
            <div className="bg-white p-4.5 rounded-3xl border-2 border-blue-200 shadow-md shadow-blue-500/5 text-left space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-black text-slate-900 truncate max-w-[210px] md:max-w-[260px]">
                      {jobInfo?.file?.originalName || 'Uploaded Document'}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      Uploaded: <strong className="text-slate-800 font-bold">{jobInfo?.file?.pageCount || jobInfo?.totalPages || 1}</strong> {jobInfo?.file?.pageCount === 1 ? 'Page' : 'Pages'}
                    </p>
                  </div>
                </div>
                <span className="flex-shrink-0 text-xs font-black bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full">
                  {jobInfo?.colorMode === 'COLOR' ? '🎨 Color' : '⬛ B&W'}
                </span>
              </div>

              {/* Exact Pages to Print & Print Settings Badges */}
              <div className="grid grid-cols-3 gap-2 text-center pt-0.5">
                <div className="p-2.5 rounded-2xl bg-gradient-to-b from-blue-50 to-indigo-50/70 border-2 border-blue-200 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-black uppercase text-blue-700 tracking-wider">Pages To Print</span>
                  <span className="text-xl md:text-2xl font-black text-blue-950 font-display">
                    {jobInfo?.totalPages || 1}
                  </span>
                  <span className="text-[10px] text-blue-600 font-bold">
                    {jobInfo?.totalPages === 1 ? 'Total Page' : 'Total Pages'}
                  </span>
                </div>

                <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Copies</span>
                  <span className="text-xl md:text-2xl font-black text-slate-900 font-display">
                    {jobInfo?.copies || 1}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold">
                    {jobInfo?.copies === 1 ? 'Copy' : 'Copies'}
                  </span>
                </div>

                <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Format</span>
                  <span className="text-xs md:text-sm font-black text-slate-900 mt-1">
                    {jobInfo?.sides === 'DOUBLE' ? '2-Sided' : '1-Sided'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold">
                    {jobInfo?.paperSize || 'A4'}
                  </span>
                </div>
              </div>
            </div>

            {/* 6-Digit Code Box */}
            <div className="bg-white p-6 rounded-3xl border-2 border-blue-200 shadow-xl shadow-blue-500/5">
              <p className="text-xs md:text-sm text-blue-700 font-black uppercase tracking-wider mb-4">6-Digit Kiosk Release Code</p>

              <div className="flex items-center justify-center gap-2.5 mb-5 min-h-[64px]">
                {code ? (
                  code.split('').map((digit, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="w-12 md:w-14 h-16 rounded-2xl bg-blue-50 border-2 border-blue-500 flex items-center justify-center text-3xl md:text-4xl font-display font-black text-blue-900 shadow-sm"
                    >
                      {digit}
                    </motion.div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-2 gap-2">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    <p className="text-xs font-bold text-slate-500 animate-pulse">Generating your 6-digit release code...</p>
                  </div>
                )}
              </div>

              {/* Copy Button */}
              <button
                type="button"
                onClick={code ? copyCode : handleManualReconcile}
                className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold text-sm transition-all shadow-md active:scale-98 ${
                  copied
                    ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-5 h-5" />
                    <span>COPIED TO CLIPBOARD ✓</span>
                  </>
                ) : !code ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>REVEALING CODE...</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-5 h-5" />
                    <span>COPY 6-DIGIT CODE</span>
                  </>
                )}
              </button>
            </div>

            {/* ════════════════════════════════════════════════ */}
            {/* ⚡ 1. POINT & PRINT INSTANT SCAN BUTTON */}
            {/* ════════════════════════════════════════════════ */}
            <div className="relative">
              <div className="flex items-center gap-2 my-2 justify-center">
                <span className="h-px bg-slate-200 flex-1" />
                <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider">or print without typing</span>
                <span className="h-px bg-slate-200 flex-1" />
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleOpenScanner}
                className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm md:text-base flex items-center justify-center gap-2.5 shadow-lg shadow-blue-500/25 border-2 border-blue-400 transition-all group"
                id="btn-scan-kiosk-qr"
              >
                <div className="p-1.5 bg-white/20 rounded-xl group-hover:scale-110 transition-transform">
                  <QrCode className="w-5 h-5 text-white" />
                </div>
                <span>SCAN KIOSK QR TO PRINT</span>
                <span className="bg-emerald-400 text-slate-950 text-[10px] font-black uppercase px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                  Instant
                </span>
              </motion.button>
              <p className="text-[11px] text-slate-500 text-center mt-1.5 font-medium">
                ⚡ Point & Print — scan the kiosk screen QR to release your print in 1 second
              </p>
            </div>

            {/* 24-Hour Expiry Timer */}
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-700">
                <Clock className="w-4 h-4 text-blue-600" />
                <span className="text-xs md:text-sm font-bold">Valid For (24 Hours)</span>
              </div>
              <span className="font-mono font-black text-base text-blue-700">
                {formatTime(remaining)}
              </span>
            </div>

            {/* Instructions */}
            <div className="bg-blue-50/80 p-4 rounded-2xl border border-blue-100 text-xs md:text-sm text-slate-700 text-center leading-relaxed">
              Scan the QR on the kiosk screen, or tap <strong className="text-slate-900 font-extrabold">"ENTER CODE"</strong> and enter <strong className="text-blue-700 font-mono font-bold">{code}</strong> to start printing immediately.
            </div>
          </motion.div>
        )}
      </div>

      {/* ════════════════════════════════════════════════ */}
      {/* 📷 ADVANCED HIGH-TECH QR CAMERA SCANNER MODAL */}
      {/* ════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showScanner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl border-2 border-blue-200 flex flex-col text-center"
            >
              {/* Modal Top Bar */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-blue-50/50">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                    <QrCode className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-black text-slate-900 text-sm">Scan Kiosk QR Code</h3>
                    <p className="text-[10px] text-slate-500 font-semibold">Instant Device Pairing</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    playKeySound('tap');
                    setShowScanner(false);
                    setScannerError('');
                  }}
                  className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Viewfinder Area */}
              <div className="p-5 flex flex-col items-center">
                <div className="relative w-64 h-64 rounded-3xl overflow-hidden bg-slate-900 shadow-inner border-2 border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.25)]">
                  {/* Container for html5-qrcode video */}
                  <div id="kiosk-qr-scanner-box" className="w-full h-full" />

                  {/* Top Holographic Live Scanning Pill */}
                  <div className="absolute top-2.5 left-1/2 -translate-x-1/2 bg-slate-950/85 backdrop-blur-md px-3 py-0.5 rounded-full border border-cyan-400/50 text-[9px] font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5 shadow-lg pointer-events-none z-20">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                    <span>POINT AT KIOSK QR</span>
                  </div>

                  {/* Holographic Radar Pulse Animation in Background */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                    <div className="w-40 h-40 rounded-full border border-cyan-400 animate-ping" />
                    <div className="w-24 h-24 rounded-full border border-cyan-300" />
                  </div>

                  {/* Corner Target Highlights */}
                  <div className="absolute top-3 left-3 w-7 h-7 border-t-4 border-l-4 border-cyan-400 rounded-tl-xl pointer-events-none z-10" />
                  <div className="absolute top-3 right-3 w-7 h-7 border-t-4 border-r-4 border-cyan-400 rounded-tr-xl pointer-events-none z-10" />
                  <div className="absolute bottom-3 left-3 w-7 h-7 border-b-4 border-l-4 border-cyan-400 rounded-bl-xl pointer-events-none z-10" />
                  <div className="absolute bottom-3 right-3 w-7 h-7 border-b-4 border-r-4 border-cyan-400 rounded-br-xl pointer-events-none z-10" />

                  {/* Animated Glowing Laser Sweep Line */}
                  <motion.div
                    animate={{ y: [0, 220, 0] }}
                    transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute left-3 right-3 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_16px_#22d3ee,0_0_24px_#38bdf8] pointer-events-none z-10 rounded-full"
                  >
                    <div className="w-full h-10 -mt-5 bg-gradient-to-b from-cyan-400/20 to-transparent blur-sm pointer-events-none" />
                  </motion.div>

                  {/* Pairing Active Overlay */}
                  {isPairing && (
                    <div className="absolute inset-0 bg-blue-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-white p-4 z-30">
                      <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
                      <p className="font-black text-sm">{pairingStatus}</p>
                    </div>
                  )}
                </div>

                {/* Hidden Native Mobile Camera Capture (Works 100% on iOS / Android / HTTP) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleMobilePhotoCapture}
                />

                {/* 📸 Direct Mobile Camera Snap Button */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full mt-3 py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 text-white font-black text-xs md:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 border-2 border-emerald-400 transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4 text-white" />
                  <span>📸 SNAP KIOSK QR (MOBILE CAMERA)</span>
                </motion.button>

                {/* Status or Error Banner */}
                {scannerError ? (
                  <div className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold text-center w-full">
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      <span>{scannerError}</span>
                    </div>
                    {/* Grant Camera Permission Quick Trigger */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1 shadow-sm active:scale-95 transition-all"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Snap Photo with Camera Instead</span>
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {pairingStatus || 'Point camera at kiosk QR or tap "Snap Kiosk QR" above'}
                  </p>
                )}

                {/* 1-Tap Quick Release Station List */}
                {availableKiosks.length > 0 && (
                  <div className="w-full mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                      Or 1-Tap Quick Release Station:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5 max-h-28 overflow-y-auto">
                      {availableKiosks.map((k) => (
                        <button
                          key={k.id}
                          type="button"
                          disabled={isPairing}
                          onClick={() => handlePairWithKiosk(k.displayId)}
                          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-800 hover:text-blue-700 border border-slate-200 text-xs font-mono font-black transition-all active:scale-95 flex items-center gap-1 shadow-xs"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>{k.displayId}</span>
                          <span className="text-[10px] text-slate-400 font-sans font-medium">({k.location || 'Station'})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual Station ID Fallback */}
                <div className="w-full mt-3 pt-3 border-t border-slate-100 space-y-2">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                    Or Enter Station ID Manually
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. XPOS-001"
                      value={manualKioskId}
                      onChange={(e) => setManualKioskId(e.target.value.toUpperCase())}
                      className="flex-1 px-3.5 py-2.5 rounded-xl border-2 border-slate-200 focus:border-blue-500 text-xs font-bold font-mono text-slate-900 outline-none uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (manualKioskId.trim()) {
                          handlePairWithKiosk(manualKioskId.trim());
                        }
                      }}
                      disabled={isPairing || !manualKioskId.trim()}
                      className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all"
                    >
                      Pair
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CodePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f8fbff]">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
      </div>
    }>
      <CodeContent />
    </Suspense>
  );
}
