'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  QrCode,
  Hash,
  Printer,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Wifi,
  WifiOff,
  ArrowLeft,
  Sparkles,
  Delete,
  FileText,
  Check,
  Zap,
  Clock,
  Heart,
  Wrench,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { io, Socket } from 'socket.io-client';
import { getRandomCharmingLine, getRandomCompletionLine } from '../lib/charming-lines';
import { playKeySound } from '../lib/sound';
import { triggerBrowserPrint } from '../lib/browser-print';

function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('api') === 'local') {
      return 'http://localhost:4000';
    }
    const saved = localStorage.getItem('xpos_api_url');
    if (saved) return saved;

    const hostname = window.location.hostname;
    if (hostname.includes('loca.lt')) {
      return 'https://xpos-api-cloud.loca.lt';
    }
    // Direct cloud connection to ensure Kiosk and Customer Phone communicate over the same server
    return 'https://xpos-printing-cloud.onrender.com';
  }
  return 'https://xpos-printing-cloud.onrender.com';
}

function getAppUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('loca.lt')) {
      return 'https://xpos-print-customer.loca.lt';
    }
    if (hostname.includes('vercel.app') || hostname.includes('onrender.com')) {
      return 'https://xpos-printing-cloud-customer.vercel.app';
    }
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `http://${hostname}:3000`;
    }
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'https://xpos-printing-cloud-customer.vercel.app';
}

const IDLE_TIMEOUT = 60000;

type Screen = 'idle' | 'qr' | 'code-entry' | 'printing' | 'completed' | 'error' | 'maintenance';

interface PrintJobData {
  jobId: string;
  displayId: string;
  downloadUrl: string;
  totalPages: number;
  currentPage: number;
  fileName: string;
  colorMode: string;
  copies: number;
}

export default function KioskApp() {
  const [mounted, setMounted] = useState(false);
  const [kioskId, setKioskId] = useState<string>('XPOS-001');

  const [screen, setScreen] = useState<Screen>('idle');
  const [kioskInfo, setKioskInfo] = useState<any>(null);
  const [activePrinterName, setActivePrinterName] = useState<string>('Detecting Hardware Printer...');
  const [detectedPrinters, setDetectedPrinters] = useState<any[]>([]);
  const [printerStatus, setPrinterStatus] = useState<string>('READY');
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const [isSwitchingPrinter, setIsSwitchingPrinter] = useState(false);
  const [pricing, setPricing] = useState<{ bw: number; color: number }>({ bw: 2, color: 10 });
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [jobData, setJobData] = useState<PrintJobData | null>(null);
  const [error, setError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  // Sync kiosk ID from URL search parameters on mount (Client-Side Only to avoid hydration mismatch)
  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('kiosk') || params.get('id') || params.get('kioskId');
      if (urlId) {
        const clean = urlId.trim().toUpperCase();
        setKioskId(clean);
        localStorage.setItem('xpos_kiosk_id', clean);
      } else {
        const saved = localStorage.getItem('xpos_kiosk_id');
        if (saved) setKioskId(saved);
      }
    }
  }, []);

  // ── Load Dynamic Pricing Rules (Global or Kiosk-Specific) ──
  useEffect(() => {
    async function loadPricing() {
      try {
        const res = await fetch(`${getApiUrl()}/api/pricing?kiosk=${kioskId}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const bw = json.data.find((r: any) => r.colorMode === 'BW');
          const clr = json.data.find((r: any) => r.colorMode === 'COLOR');
          setPricing({
            bw: bw && typeof bw.pricePerPage === 'number' ? bw.pricePerPage : 2,
            color: clr && typeof clr.pricePerPage === 'number' ? clr.pricePerPage : 10,
          });
        }
      } catch (e) {
        console.warn('Failed to load dynamic pricing on kiosk:', e);
      }
    }
    loadPricing();
  }, [kioskId]);

  // 🔒 Single-Use Dynamic QR Token for Instant Release Pairing
  const [pairToken, setPairToken] = useState<string>(() => {
    return 'XPOS-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString(36);
  });

  const rotatePairToken = useCallback(() => {
    const newToken = 'XPOS-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString(36);
    setPairToken(newToken);
    console.log('🔄 Kiosk single-use QR refreshed:', newToken);
  }, []);

  // 5-Second Auto Return Countdown for Upload Screen
  const [qrCountdown, setQrCountdown] = useState(5);

  // Charming flirty quotes
  const [currentCharmingLine, setCurrentCharmingLine] = useState('');
  const [currentCompletionLine, setCurrentCompletionLine] = useState('');

  // Completed countdown timer (7 Seconds)
  const [countdown, setCountdown] = useState(7);

  const socketRef = useRef<Socket | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── 5-Second Auto Return from Scan QR Upload Screen ──
  useEffect(() => {
    if (screen !== 'qr') return;
    setQrCountdown(5);

    const interval = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setScreen('idle');
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [screen]);

  // ── Reset idle timer ──
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (screen !== 'idle' && screen !== 'printing' && screen !== 'completed') {
      idleTimerRef.current = setTimeout(() => {
        setScreen('idle');
        setCode(['', '', '', '', '', '']);
        setJobData(null);
        setError('');
      }, IDLE_TIMEOUT);
    }
  }, [screen]);

  useEffect(() => { resetIdleTimer(); }, [screen, resetIdleTimer]);

  // ── Fetch Detected Printers from PC ──
  const fetchDetectedPrinters = useCallback(async () => {
    try {
      const pRes = await fetch(`${getApiUrl()}/api/kiosks/${kioskId}/detected-printers`);
      const pData = await pRes.json();
      if (pData.success && pData.data) {
        if (Array.isArray(pData.data.printers)) {
          setDetectedPrinters(pData.data.printers);
        }
        if (pData.data.activePrinter && pData.data.activePrinter !== 'Default Printer') {
          setActivePrinterName(pData.data.activePrinter);
        } else if (pData.data.defaultPrinter?.name) {
          setActivePrinterName(pData.data.defaultPrinter.name);
        }
      }
    } catch (e) {
      console.warn('Printer hardware query notice:', e);
    }
  }, [kioskId]);

  // ── Switch / Assign Printer to this Kiosk ──
  const handleAssignPrinter = async (printerName: string) => {
    setIsSwitchingPrinter(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/kiosks/${kioskId}/assign-printer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerName }),
      });
      const data = await res.json();
      if (data.success) {
        setActivePrinterName(printerName);
        setIsPrinterModalOpen(false);
      }
    } catch (e) {
      console.error('Failed to switch printer:', e);
    } finally {
      setIsSwitchingPrinter(false);
    }
  };

  // ── Load kiosk info & hardware printer ──
  useEffect(() => {
    async function loadKiosk() {
      try {
        const res = await fetch(`${getApiUrl()}/api/kiosks/${kioskId}`);
        const data = await res.json();
        if (data.success && data.data) {
          setKioskInfo(data.data);
          if (data.data.printerName) setActivePrinterName(data.data.printerName);
          if (data.data.printerStatus) setPrinterStatus(data.data.printerStatus);
        }
      } catch (e) { console.error('Failed to load kiosk info:', e); }
      await fetchDetectedPrinters();
    }
    loadKiosk();
  }, [kioskId, fetchDetectedPrinters]);

  // ── WebSocket connection ──
  useEffect(() => {
    const socket = io(getApiUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 Kiosk connected to XPOS Cloud as', kioskId);
      setIsConnected(true);
      socket.emit('join_kiosk', { kioskId });
      // Send immediate heartbeat on connect
      socket.emit('heartbeat', {
        kioskId,
        cpu: 10,
        ram: 35,
        disk: 25,
        appVersion: 'v2.0',
        printerStatus: 'READY',
      });
    });

    // Periodic heartbeat to keep kiosk online in Admin Fleet every 20 seconds
    const hbInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', {
          kioskId,
          cpu: 10,
          ram: 35,
          disk: 25,
          appVersion: 'v2.0',
          printerStatus: 'READY',
        });
      }
    }, 20000);

    socket.on('disconnect', () => {
      console.log('❌ Kiosk disconnected from XPOS Cloud');
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('⚠️ Kiosk socket connect warning:', err?.message);
      setIsConnected(false);
    });

    // Real-time printer sync
    socket.on('printer_assigned', (data: any) => {
      console.log('🖨️ Printer assigned to kiosk:', data);
      if (data.printerName) setActivePrinterName(data.printerName);
      if (data.status) setPrinterStatus(data.status);
    });

    socket.on('printer_detected', (data: any) => {
      console.log('🖨️ Printer detected on host:', data);
      if (data.printerName) setActivePrinterName(data.printerName);
      if (data.status) setPrinterStatus(data.status);
      if (Array.isArray(data.printers)) setDetectedPrinters(data.printers);
    });

    // ⚡ Instant QR Pairing Event from Customer Phone
    socket.on('kiosk_paired_print', async (data: any) => {
      console.log('⚡ Real-Time QR Pairing Triggered:', data);
      if (data.kioskId && data.kioskId !== kioskId && data.targetKioskId && data.targetKioskId !== kioskId) {
        return;
      }

      playKeySound('success');
      const totalPgs = data.totalPages || 1;
      const rawDownloadUrl = data.downloadUrl || `/api/files/download/${data.jobId}`;
      const fullDownloadUrl = rawDownloadUrl.startsWith('http') ? rawDownloadUrl : `${getApiUrl()}${rawDownloadUrl}`;

      setJobData({
        jobId: data.jobId,
        displayId: data.displayId,
        downloadUrl: fullDownloadUrl,
        totalPages: totalPgs,
        currentPage: 0,
        fileName: data.fileName || 'Document.pdf',
        colorMode: data.colorMode || 'BW',
        copies: data.copies || 1,
      });

      setCurrentCharmingLine(getRandomCharmingLine());
      setScreen('printing');
      setIsVerifying(false);
      rotatePairToken(); // Single-use guarantee: Invalidate old QR immediately

      // 🖨️ DIRECT HARDWARE PRINT: Stream print command to physical printer via backend
      if (data.jobId) {
        try {
          const targetPrinter = (activePrinterName && !activePrinterName.toLowerCase().includes('detecting')) ? activePrinterName : undefined;
          const res = await fetch(`${getApiUrl()}/api/jobs/${data.jobId}/print`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kioskId, printerName: targetPrinter }),
          });
          const printRes = await res.json();
          if (!printRes.success) {
            console.warn('⚠️ Physical print request rejected by backend, falling back to local PC browser print:', printRes.error);
            const printedLocally = await triggerBrowserPrint(fullDownloadUrl, { copies: data.copies, colorMode: data.colorMode, totalPages: totalPgs });
            if (!printedLocally) {
              setError(printRes.error || 'Failed to dispatch print job to hardware printer.');
              setScreen('error');
            }
          } else {
            console.log('✅ Physical print job sent to hardware printer:', printRes.data?.printerName);
            if (printRes.data?.printerName) {
              setActivePrinterName(printRes.data.printerName);
            }
          }
        } catch (e: any) {
          console.warn('Physical print dispatch error, falling back to local PC browser print:', e);
          const printedLocally = await triggerBrowserPrint(fullDownloadUrl, { copies: data.copies, colorMode: data.colorMode, totalPages: totalPgs });
          if (!printedLocally) {
            setError('Failed to communicate with physical printer service.');
            setScreen('error');
          }
        }
      }
    });

    // Receive new print job
    socket.on('new_job', async (data: any) => {
      console.log('📥 New print job received:', data);
      const totalPgs = data.job?.totalPages || 1;
      const rawDownloadUrl = data.downloadUrl || `/api/files/download/${data.job.file?.storageKey}`;
      const fullDownloadUrl = rawDownloadUrl.startsWith('http') ? rawDownloadUrl : `${getApiUrl()}${rawDownloadUrl}`;

      setJobData({
        jobId: data.job.id,
        displayId: data.job.displayId,
        downloadUrl: fullDownloadUrl,
        totalPages: totalPgs,
        currentPage: 0,
        fileName: data.job.file?.originalName || 'Document.pdf',
        colorMode: data.job.colorMode,
        copies: data.job.copies,
      });
      setCurrentCharmingLine(getRandomCharmingLine());
      setScreen('printing');
      rotatePairToken();

      if (data.job?.id) {
        try {
          const targetPrinter = (activePrinterName && !activePrinterName.toLowerCase().includes('detecting')) ? activePrinterName : undefined;
          const res = await fetch(`${getApiUrl()}/api/jobs/${data.job?.id}/print`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kioskId, printerName: targetPrinter }),
          });
          const printRes = await res.json();
          if (!printRes.success) {
            console.warn('⚠️ Backend print rejected, falling back to local PC browser print:', printRes.error);
            await triggerBrowserPrint(fullDownloadUrl, { copies: data.job.copies, colorMode: data.job.colorMode, totalPages: totalPgs });
          }
        } catch (e) {
          console.warn('Print trigger error, falling back to local PC browser print:', e);
          await triggerBrowserPrint(fullDownloadUrl, { copies: data.job.copies, colorMode: data.job.colorMode, totalPages: totalPgs });
        }
      }
    });

    // Receive real-time print job progress from physical hardware
    socket.on('job_progress', (data: any) => {
      console.log('🖨️ Physical hardware job progress:', data);
      setJobData((prev) => prev ? {
        ...prev,
        currentPage: typeof data.currentPage === 'number' ? data.currentPage : prev.currentPage,
        totalPages: typeof data.totalPages === 'number' ? data.totalPages : prev.totalPages,
      } : null);
    });

    // Receive job completion from physical hardware
    socket.on('job_completed', (data: any) => {
      console.log('✅ Physical print completed on hardware:', data);
      handleJobCompleted(data?.jobId);
    });

    // Receive job failure
    socket.on('job_failed', (data: any) => {
      console.error('❌ Physical print failed on hardware:', data);
      setError(data.error || 'Physical printer reported an error. Please verify paper and connection.');
      setScreen('error');
    });

    // Receive printer status update
    socket.on('printer_status', (data: any) => {
      setPrinterStatus(data.status || 'READY');
    });

    // Real-time kiosk maintenance / online status sync
    socket.on('status_change', (data: any) => {
      console.log('🔔 Kiosk status changed:', data);
      if (data.status === 'MAINTENANCE' || data.status === 'OFFLINE' || data.status === 'DISABLED') {
        setScreen('maintenance');
      } else if (data.status === 'ACTIVE') {
        setScreen('idle');
      }
    });

    socket.on('kiosks_updated', (data: any) => {
      if ((data.type === 'STATUS_CHANGED' || data.type === 'UPDATED') && (data.kiosk?.id === kioskId || data.kiosk?.displayId === kioskId)) {
        if (data.kiosk.status === 'MAINTENANCE' || data.kiosk.status === 'OFFLINE' || data.kiosk.status === 'DISABLED') {
          setScreen('maintenance');
        } else if (data.kiosk.status === 'ACTIVE') {
          setScreen('idle');
        }
        if (data.kiosk) {
          setKioskInfo(data.kiosk);
        }
      }
    });

    socket.on('kiosk_details_updated', (updated: any) => {
      console.log('🔔 Kiosk details updated:', updated);
      if (updated && (updated.id === kioskId || updated.displayId === kioskId)) {
        setKioskInfo(updated);
        if (updated.status === 'MAINTENANCE' || updated.status === 'OFFLINE' || updated.status === 'DISABLED') {
          setScreen('maintenance');
        } else if (updated.status === 'ACTIVE') {
          setScreen('idle');
        }
      }
    });

    // Real-time remote reboot command
    socket.on('system_reboot', (data: any) => {
      console.log('🔄 Remote reboot triggered by administrator:', data);
      if (!data?.kioskId || data.kioskId === kioskId || data.displayId === kioskId) {
        window.location.reload();
      }
    });

    // Real-time live dynamic pricing updates (Global or Kiosk-Specific)
    socket.on('pricing_updated', (data: any) => {
      console.log('⚡ Dynamic pricing updated on kiosk:', data);
      if (data?.kioskId && data.kioskId !== kioskId && data.kioskDisplayId !== kioskId) {
        return;
      }
      if (typeof data?.bwPrice === 'number' || typeof data?.colorPrice === 'number') {
        setPricing(prev => ({
          bw: typeof data.bwPrice === 'number' ? data.bwPrice : prev.bw,
          color: typeof data.colorPrice === 'number' ? data.colorPrice : prev.color,
        }));
      } else if (data?.rules && Array.isArray(data.rules)) {
        const bw = data.rules.find((r: any) => r.colorMode === 'BW');
        const clr = data.rules.find((r: any) => r.colorMode === 'COLOR');
        setPricing({
          bw: bw && typeof bw.pricePerPage === 'number' ? bw.pricePerPage : 2,
          color: clr && typeof clr.pricePerPage === 'number' ? clr.pricePerPage : 10,
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [kioskId, rotatePairToken, activePrinterName]);

  // Check kiosk initial status from backend on mount or when kioskId updates
  useEffect(() => {
    async function checkKioskStatus() {
      try {
        const res = await fetch(`${getApiUrl()}/api/kiosks`);
        const json = await res.json();
        if (json.success && json.data) {
          const current = json.data.find((k: any) => k.id === kioskId || k.displayId === kioskId);
          if (current) {
            setKioskInfo(current);
            if (current.status === 'MAINTENANCE' || current.status === 'OFFLINE') {
              setScreen('maintenance');
            }
          }
        }
      } catch (e) {}
    }
    checkKioskStatus();
  }, [kioskId]);

  // ── Handle Job Completed (Auto-redirect in 7 Seconds & Sync with Backend) ──
  const handleJobCompleted = (completedJobId?: string) => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    playKeySound('success');
    setCurrentCompletionLine(getRandomCompletionLine());
    setScreen('completed');
    setCountdown(7);

    const activeJobId = completedJobId || jobData?.jobId;
    if (activeJobId) {
      // Sync completion with cloud backend so customer screen instantly transitions to PRINT COMPLETED 🎉
      fetch(`${getApiUrl()}/api/jobs/${activeJobId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      }).catch((e) => console.warn('Completion sync to backend:', e));
    }

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    let currentSeconds = 7;
    countdownTimerRef.current = setInterval(() => {
      currentSeconds -= 1;
      setCountdown(currentSeconds);

      if (currentSeconds <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        setScreen('idle');
        setCode(['', '', '', '', '', '']);
        setJobData(null);
        setError('');
        rotatePairToken();
      }
    }, 1000);
  };

  // ── Verify Code & Direct Print to Physical Printer (Real-Time) ──
  const verifyAndPrintCode = async (fullCode: string) => {
    setIsVerifying(true);
    setError('');

    try {
      const res = await fetch(`${getApiUrl()}/api/print-codes/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fullCode,
          kioskId,
        }),
      });

      const data = await res.json();

      if (data.success && data.data) {
        playKeySound('success');
        const printData = data.data;
        const jobId = printData.jobId || printData.job?.id || '';
        const displayId = printData.displayId || printData.job?.displayId || 'Active';
        const rawDownloadUrl = printData.downloadUrl || `/api/files/download/${printData.file?.storageKey || ''}`;
        const fullDownloadUrl = rawDownloadUrl.startsWith('http') ? rawDownloadUrl : `${getApiUrl()}${rawDownloadUrl}`;
        const totalPages = printData.printSettings?.totalPages || printData.job?.totalPages || 1;
        const fileName = printData.file?.originalName || printData.job?.file?.originalName || 'Document.pdf';
        const colorMode = printData.printSettings?.colorMode || printData.job?.colorMode || 'BW';
        const copies = printData.printSettings?.copies || printData.job?.copies || 1;

        setJobData({
          jobId,
          displayId,
          downloadUrl: fullDownloadUrl,
          totalPages,
          currentPage: 0,
          fileName,
          colorMode,
          copies,
        });

        setCurrentCharmingLine(getRandomCharmingLine());
        setScreen('printing');
        setIsVerifying(false);

        // 🖨️ DIRECT HARDWARE PRINT: Dispatch to physical printer connected to PC
        if (jobId) {
          try {
            const targetPrinter = (activePrinterName && !activePrinterName.toLowerCase().includes('detecting')) ? activePrinterName : undefined;
            const printRes = await fetch(`${getApiUrl()}/api/jobs/${jobId}/print`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kioskId, printerName: targetPrinter }),
            });
            const pData = await printRes.json();
            if (!pData.success) {
              console.warn('⚠️ Physical print request rejected by backend, routing to local PC printer via universal browser print:', pData.error);
              const printedLocally = await triggerBrowserPrint(fullDownloadUrl, { copies, colorMode, totalPages });
              if (!printedLocally) {
                setError(pData.error || 'Failed to dispatch job to physical printer.');
                setScreen('error');
              }
            } else {
              console.log('✅ Print job dispatched to hardware printer:', pData.data?.printerName);
              if (pData.data?.printerName) {
                setActivePrinterName(pData.data.printerName);
              }
            }
          } catch (e: any) {
            console.warn('Physical print trigger error, falling back to local PC printer via universal browser print:', e);
            const printedLocally = await triggerBrowserPrint(fullDownloadUrl, { copies, colorMode, totalPages });
            if (!printedLocally) {
              setError('Failed to communicate with physical printer service.');
              setScreen('error');
            }
          }
        }

      } else {
        playKeySound('error');
        setIsShaking(true);
        setError(data.error || 'Invalid or already used code. Please check and try again.');
        setIsVerifying(false);

        setTimeout(() => {
          setIsShaking(false);
          setCode(['', '', '', '', '', '']);
        }, 1800);
      }
    } catch (e: any) {
      playKeySound('error');
      setIsShaking(true);
      setError('Connection failed. Please verify kiosk network.');
      setIsVerifying(false);
      setTimeout(() => {
        setIsShaking(false);
        setCode(['', '', '', '', '', '']);
      }, 1800);
    }
  };

  // ── Numpad Tap Handler ──
  const handleDigitPress = (digit: string) => {
    if (isVerifying) return;
    resetIdleTimer();

    const emptyIdx = code.findIndex((d) => d === '');
    if (emptyIdx === -1) return;

    playKeySound('tap');
    const newCode = [...code];
    newCode[emptyIdx] = digit;
    setCode(newCode);

    // If 6th digit entered, auto-verify and start printing immediately!
    if (emptyIdx === 5) {
      const fullCode = newCode.join('');
      verifyAndPrintCode(fullCode);
    }
  };

  // ── Backspace Handler ──
  const handleBackspace = () => {
    if (isVerifying) return;
    resetIdleTimer();
    playKeySound('delete');

    const filledIndices = code
      .map((d, i) => (d !== '' ? i : -1))
      .filter((i) => i !== -1);

    if (filledIndices.length === 0) return;
    const lastFilled = filledIndices[filledIndices.length - 1];

    const newCode = [...code];
    newCode[lastFilled] = '';
    setCode(newCode);
    setError('');
  };

  // ── Clear Code Handler ──
  const handleClear = () => {
    if (isVerifying) return;
    resetIdleTimer();
    playKeySound('delete');
    setCode(['', '', '', '', '', '']);
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#f8fbff] text-slate-900 font-sans flex flex-col justify-between select-none overflow-hidden p-6 md:p-10 relative">
      {/* Background Soft Ambient Light Spheres */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-indigo-400/10 rounded-full blur-3xl pointer-events-none" />

      {/* ════════════════════════════════════════════════ */}
      {/* TOP HEADER & BRANDING */}
      {/* ════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3.5">
          <img src="/printbro_logo.png" alt="PrintBro" className="h-12 md:h-14 object-contain" />
        </div>

        {/* Station & Status Badge */}
        <div className="flex items-center gap-3">
          {/* Live Dynamic Pricing Pill in Header */}
          <div className="hidden sm:flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-900 border border-blue-200 px-3.5 py-2 rounded-2xl text-xs font-bold shadow-xs">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span suppressHydrationWarning>Rates: <strong suppressHydrationWarning>B&W ₹{pricing.bw}</strong> • <strong suppressHydrationWarning>Color ₹{pricing.color}</strong></span>
          </div>

          {/* 🖨️ Real Hardware Printer Badge */}
          <button
            type="button"
            onClick={() => {
              playKeySound('tap');
              fetchDetectedPrinters();
              setIsPrinterModalOpen(true);
            }}
            className="flex items-center gap-2 bg-white/90 hover:bg-white border border-blue-200 hover:border-blue-400 text-slate-800 px-3.5 py-2 rounded-2xl text-xs font-bold shadow-xs transition-all active:scale-95"
            title="Click to view detected printers or change assigned printer"
          >
            <Printer className="w-4 h-4 text-blue-600" />
            <span className="max-w-[130px] md:max-w-[200px] truncate" suppressHydrationWarning>{activePrinterName || 'Auto-Detected Printer'}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </button>

          <div className={`flex items-center gap-2 backdrop-blur-md px-4 py-2 rounded-2xl border shadow-sm text-xs font-bold ${
            screen === 'maintenance'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-white/80 border-slate-200 text-slate-700'
          }`}>
            <span className={`w-2.5 h-2.5 rounded-full ${
              screen === 'maintenance' ? 'bg-amber-500 animate-bounce' : 'bg-emerald-500 animate-pulse'
            }`} />
            <span suppressHydrationWarning>Station: <strong className="text-slate-900" suppressHydrationWarning>{mounted ? kioskId : 'XPOS-001'}</strong></span>
            {screen === 'maintenance' && (
              <span className="text-[10px] uppercase font-black bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md">
                Maintenance
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 px-3.5 py-2 rounded-2xl text-xs font-bold shadow-sm">
            {isConnected ? <Wifi className="w-4 h-4 text-emerald-600" /> : <WifiOff className="w-4 h-4 text-rose-500" />}
            <span>{isConnected ? 'Online' : 'Reconnecting'}</span>
          </div>
        </div>
      </header>

      {/* ════════════════════════════════════════════════ */}
      {/* MAIN SCREEN BODY */}
      {/* ════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col items-center justify-center py-6 relative z-10 max-w-4xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {/* ──────────────────────────────────────── */}
          {/* 1. IDLE / HOME SCREEN */}
          {/* ──────────────────────────────────────── */}
          {screen === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center text-center space-y-6"
            >
              <div className="space-y-1.5">
                <span className="text-xs md:text-sm font-black text-blue-700 bg-blue-100 px-4 py-1 rounded-full uppercase tracking-wider">
                  ⚡ Self-Service Print Station
                </span>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                  Welcome to Print Bro
                </h2>
                <p className="text-slate-600 font-medium text-xs md:text-sm max-w-lg mx-auto">
                  Scan the single-use QR from your phone, enter your 6-digit code, or scan to upload documents.
                </p>
              </div>

              {/* ⚡ Live Dynamic Pricing Matrix Bar */}
              <div className="flex flex-wrap items-center justify-center gap-3 bg-gradient-to-r from-blue-500/10 via-sky-500/15 to-indigo-500/10 border-2 border-blue-200/80 backdrop-blur-md px-5 py-2.5 rounded-2xl shadow-sm">
                <span className="text-xs font-black text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-blue-600 animate-pulse" /> Live Dynamic Pricing:
                </span>
                <span className="text-xs font-black text-slate-800 bg-white px-3 py-1 rounded-xl border border-blue-200 shadow-xs">
                  B&W: <strong className="text-blue-700 font-black">₹{pricing.bw}</strong>/page
                </span>
                <span className="text-xs font-black text-slate-800 bg-white px-3 py-1 rounded-xl border border-indigo-200 shadow-xs">
                  Full Color: <strong className="text-indigo-700 font-black">₹{pricing.color}</strong>/page
                </span>
                <span className="text-[11px] font-bold text-slate-500 hidden md:inline">
                  • Double-Sided Duplex Savings Auto-Applied
                </span>
              </div>

              {/* Action Cards Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-4xl text-left items-stretch">
                {/* ⚡ 1. INSTANT PRINT RELEASE QR CARD */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-white p-6 md:p-7 rounded-[32px] border-2 border-blue-300 shadow-xl shadow-blue-500/10 flex flex-col items-center text-center justify-between space-y-4"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Live • Single Use</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playKeySound('tap');
                        rotatePairToken();
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-200 transition-colors"
                      title="Refresh single-use pairing token"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Refresh</span>
                    </button>
                  </div>

                  <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                      SCAN TO PRINT INSTANTLY
                    </h3>
                    <p className="text-slate-600 text-xs md:text-sm font-medium mt-1 leading-snug max-w-xs">
                      Open your code screen on phone & tap <strong>"Scan Kiosk QR"</strong>. Document prints in 1 second!
                    </p>
                  </div>

                  {/* Dynamic Single-Use QR Code */}
                  <div className="p-4 bg-white rounded-3xl border-2 border-blue-200 shadow-md flex items-center justify-center">
                    <QRCodeSVG
                      value={JSON.stringify({
                        type: 'xpos_kiosk_pair',
                        kioskId: kioskId,
                        token: pairToken,
                        pairKiosk: kioskId,
                      })}
                      size={180}
                      level="H"
                      includeMargin={true}
                      imageSettings={{
                        src: '/logo.svg',
                        x: undefined,
                        y: undefined,
                        height: 28,
                        width: 28,
                        excavate: true,
                      }}
                    />
                  </div>

                  <div className="w-full bg-blue-50 rounded-2xl py-2.5 px-3 border border-blue-200 flex items-center justify-center gap-2 text-xs font-bold text-blue-900">
                    <Zap className="w-4 h-4 text-blue-600 animate-pulse" />
                    <span>Instant QR Release • Zero Typing</span>
                  </div>
                </motion.div>

                {/* RIGHT COLUMN: MANUAL CODE ENTRY & UPLOAD */}
                <div className="flex flex-col gap-5 justify-between">
                  {/* ENTER 6-DIGIT CODE CARD */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      playKeySound('tap');
                      setScreen('code-entry');
                    }}
                    className="flex-1 p-6 md:p-7 rounded-[28px] bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex flex-col justify-between items-start space-y-4 shadow-xl shadow-blue-500/25 border-2 border-blue-400 group transition-all text-left"
                    id="btn-kiosk-enter-code"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20 shadow-inner group-hover:scale-110 transition-transform">
                        <Hash className="w-7 h-7" />
                      </div>
                      <span className="bg-white text-blue-700 font-black text-xs px-3.5 py-1.5 rounded-full shadow-sm">
                        Touchscreen 🔢
                      </span>
                    </div>
                    <div>
                      <h3 className="text-xl md:text-2xl font-black tracking-tight mb-1">ENTER 6-DIGIT CODE</h3>
                      <p className="text-blue-100 text-xs md:text-sm font-medium leading-snug">
                        Prefer typing? Enter your release code manually on the touchscreen keypad.
                      </p>
                    </div>
                  </motion.button>

                  {/* SCAN QR TO UPLOAD CARD */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      playKeySound('tap');
                      setScreen('qr');
                    }}
                    className="flex-1 p-6 md:p-7 rounded-[28px] bg-white text-slate-900 flex flex-col justify-between items-start space-y-4 shadow-xl shadow-slate-200/50 border-2 border-slate-200 hover:border-blue-300 group transition-all text-left"
                    id="btn-kiosk-scan-qr"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 group-hover:scale-110 transition-transform">
                        <QrCode className="w-7 h-7" />
                      </div>
                      <span className="bg-blue-50 text-blue-700 font-black text-xs px-3.5 py-1.5 rounded-full border border-blue-200">
                        Upload from Phone 📲
                      </span>
                    </div>
                    <div>
                      <h3 className="text-xl md:text-2xl font-black tracking-tight mb-1 text-slate-900">SCAN QR TO UPLOAD</h3>
                      <p className="text-slate-600 text-xs md:text-sm font-medium leading-snug">
                        Don't have a document uploaded yet? Scan to upload and pay from your phone.
                      </p>
                    </div>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ──────────────────────────────────────── */}
          {/* 2. QR CODE DISPLAY SCREEN */}
          {/* ──────────────────────────────────────── */}
          {screen === 'qr' && (
            <motion.div
              key="qr"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-md flex flex-col items-center text-center space-y-5"
            >
              <div className="space-y-1">
                <h2 className="text-3xl font-black text-slate-900">Scan QR with Phone</h2>
                <p className="text-slate-600 text-sm font-medium">Point your camera to upload documents directly</p>
              </div>

              {/* ⏱️ 5-Second Auto-Return Countdown Badge & Progress Bar */}
              <div className="flex flex-col items-center gap-1.5 w-full">
                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-900 px-4 py-1.5 rounded-full text-xs font-bold shadow-sm">
                  <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                  <span>Returning to Home in {qrCountdown}s</span>
                </div>
                <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden mt-0.5">
                  <motion.div
                    animate={{ width: `${(qrCountdown / 5) * 100}%` }}
                    transition={{ duration: 0.3 }}
                    className="h-full bg-blue-600 rounded-full"
                  />
                </div>
              </div>

              <div className="p-6 bg-white rounded-3xl border-2 border-blue-200 shadow-2xl shadow-blue-500/10">
                <QRCodeSVG
                  value={`${getAppUrl()}/remote?kiosk=${kioskId}`}
                  size={230}
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

              <p className="font-mono text-xs text-blue-600 font-bold bg-blue-50 px-4 py-1.5 rounded-full border border-blue-100">
                {getAppUrl()}/remote
              </p>

              <button
                onClick={() => {
                  playKeySound('tap');
                  setScreen('idle');
                }}
                className="py-3 px-6 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center gap-2 transition-all active:scale-95"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Home Now
              </button>
            </motion.div>
          )}

          {/* ──────────────────────────────────────── */}
          {/* 3. CODE ENTRY SCREEN (FROSTED GLASS ROUND NUMPAD) */}
          {/* ──────────────────────────────────────── */}
          {screen === 'code-entry' && (
            <motion.div
              key="code-entry"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-lg flex flex-col items-center text-center space-y-6"
            >
              {/* Top Title & Back Button */}
              <div className="w-full flex items-center justify-between">
                <button
                  onClick={() => {
                    playKeySound('tap');
                    setScreen('idle');
                  }}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold text-sm bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 active:scale-95 transition-all shadow-sm"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <span className="text-xs font-black uppercase text-blue-700 tracking-wider bg-blue-100 px-3 py-1 rounded-full">
                  6-Digit Release
                </span>
              </div>

              <div>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                  Enter Print Code
                </h2>
                <p className="text-slate-600 text-xs md:text-sm font-medium mt-1">
                  Type your 6-digit code. Printing starts automatically!
                </p>
              </div>

              {/* 6 Digit Input Display Boxes */}
              <motion.div
                animate={isShaking ? { x: [-10, 10, -10, 10, -5, 5, 0] } : {}}
                transition={{ duration: 0.4 }}
                className="flex items-center justify-center gap-2.5 md:gap-3.5 my-2"
              >
                {code.map((digit, i) => (
                  <div
                    key={i}
                    className={`w-12 h-16 md:w-14 md:h-18 rounded-2xl flex items-center justify-center text-3xl md:text-4xl font-display font-black transition-all duration-200 border-2 ${
                      digit
                        ? 'bg-blue-50 text-blue-900 border-blue-600 shadow-md shadow-blue-500/10 scale-105'
                        : i === code.findIndex((d) => d === '')
                        ? 'bg-white text-blue-600 border-blue-400 ring-2 ring-blue-300 animate-pulse'
                        : 'bg-white text-slate-300 border-slate-200'
                    }`}
                  >
                    {digit}
                  </div>
                ))}
              </motion.div>

              {/* Status or Error Banner */}
              {isVerifying ? (
                <div className="flex items-center gap-2 text-blue-700 bg-blue-50 border border-blue-200 px-4 py-2 rounded-xl text-xs md:text-sm font-black">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying code & preparing printer...</span>
                </div>
              ) : error ? (
                <div className="text-rose-600 bg-rose-50 border border-rose-200 px-4 py-2 rounded-xl text-xs md:text-sm font-bold animate-fade-in">
                  {error}
                </div>
              ) : (
                <p className="text-slate-400 text-xs font-medium">Valid for 24 hours from creation</p>
              )}

              {/* 🌟 ULTRA-PREMIUM FROSTED GLASS ROUND NUMPAD */}
              <div className="grid grid-cols-3 gap-3.5 md:gap-4.5 pt-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                  <motion.button
                    key={num}
                    type="button"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.88 }}
                    onClick={() => handleDigitPress(num)}
                    disabled={isVerifying}
                    className="w-18 h-18 md:w-20 md:h-20 rounded-full bg-white/70 backdrop-blur-2xl hover:bg-gradient-to-tr hover:from-blue-600 hover:to-indigo-600 hover:text-white border-2 border-white/90 hover:border-transparent text-slate-900 font-display font-black text-2xl md:text-3xl shadow-[0_10px_25px_rgba(0,0,0,0.06)] hover:shadow-blue-500/25 flex items-center justify-center transition-all duration-150 active:scale-90 ring-1 ring-blue-200/50"
                  >
                    {num}
                  </motion.button>
                ))}

                {/* CLEAR BUTTON */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.88 }}
                  onClick={handleClear}
                  disabled={isVerifying}
                  className="w-18 h-18 md:w-20 md:h-20 rounded-full bg-slate-100/80 backdrop-blur-xl hover:bg-rose-50 hover:text-rose-600 border-2 border-slate-200/80 text-slate-600 font-black text-xs uppercase flex items-center justify-center transition-all duration-150 active:scale-90 shadow-sm"
                >
                  Clear
                </motion.button>

                {/* DIGIT 0 */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => handleDigitPress('0')}
                  disabled={isVerifying}
                  className="w-18 h-18 md:w-20 md:h-20 rounded-full bg-white/70 backdrop-blur-2xl hover:bg-gradient-to-tr hover:from-blue-600 hover:to-indigo-600 hover:text-white border-2 border-white/90 hover:border-transparent text-slate-900 font-display font-black text-2xl md:text-3xl shadow-[0_10px_25px_rgba(0,0,0,0.06)] hover:shadow-blue-500/25 flex items-center justify-center transition-all duration-150 active:scale-90 ring-1 ring-blue-200/50"
                >
                  0
                </motion.button>

                {/* BACKSPACE BUTTON */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.88 }}
                  onClick={handleBackspace}
                  disabled={isVerifying}
                  className="w-18 h-18 md:w-20 md:h-20 rounded-full bg-slate-100/80 backdrop-blur-xl hover:bg-slate-200 text-slate-700 border-2 border-slate-200/80 flex items-center justify-center transition-all duration-150 active:scale-90 shadow-sm"
                >
                  <Delete className="w-6 h-6" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ──────────────────────────────────────── */}
          {/* 4. PRINTING IN PROGRESS SCREEN */}
          {/* ──────────────────────────────────────── */}
          {screen === 'printing' && (
            <motion.div
              key="printing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md flex flex-col items-center text-center space-y-6"
            >
              {/* 💖 Charming Flirty Line Card */}
              {currentCharmingLine && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full p-4 rounded-3xl bg-gradient-to-r from-blue-50 via-indigo-50/70 to-blue-50 border-2 border-blue-200 shadow-md text-center flex flex-col items-center gap-1.5"
                >
                  <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-700 bg-white px-3 py-0.5 rounded-full border border-blue-200">
                    <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                    <span>A Note For You</span>
                    <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                  </div>
                  <p className="text-slate-900 font-black text-sm md:text-base leading-snug">
                    "{currentCharmingLine}"
                  </p>
                </motion.div>
              )}

              {/* 🖨️ High-Impact Animated Paper Ejection & Laser Feed Card */}
              <div className="w-full bg-white p-8 rounded-3xl border-2 border-blue-300 shadow-2xl shadow-blue-500/10 flex flex-col items-center relative overflow-hidden space-y-4">
                {/* Printer Top Slot */}
                <div className="w-48 h-4 bg-slate-800 rounded-full shadow-inner relative z-10" />

                {/* Animated Sliding Paper Sheet */}
                <div className="relative w-44 h-56 bg-gradient-to-b from-blue-50 to-white rounded-2xl border-2 border-slate-300 shadow-lg p-3 flex flex-col justify-between overflow-hidden">
                  {/* Laser Scanning Line */}
                  <motion.div
                    animate={{ y: [0, 180, 0] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                    className="absolute left-0 right-0 h-1.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent shadow-sm shadow-blue-500"
                  />

                  <div className="space-y-1.5 opacity-60">
                    <div className="h-2 bg-blue-600 rounded-full w-3/4" />
                    <div className="h-1.5 bg-slate-300 rounded-full w-full" />
                    <div className="h-1.5 bg-slate-200 rounded-full w-5/6" />
                    <div className="h-1.5 bg-slate-200 rounded-full w-4/5" />
                  </div>

                  <div className="flex items-center justify-center my-auto">
                    <Printer className="w-9 h-9 text-blue-600 animate-bounce" />
                  </div>

                  <div className="h-1.5 bg-slate-300 rounded-full w-2/3 opacity-60" />
                </div>

                <div className="w-full space-y-2">
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                    🖨️ PRINTING IN PROGRESS
                  </h3>

                  {/* 🖨️ Active Hardware Printer Card */}
                  <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-700 bg-white border border-blue-200 py-2 px-4 rounded-xl shadow-xs">
                    <Printer className="w-4 h-4 text-blue-600 animate-pulse" />
                    <span>Hardware Printer: <strong className="text-blue-900 font-extrabold">{activePrinterName || 'Auto-Detected Printer'}</strong></span>
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                  </div>

                  {/* 📊 REAL-TIME PAGE-BY-PAGE COUNTER: e.g. "1/10 pages printed" */}
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-black">
                      <span className="text-slate-700">Hardware Spooler Progress</span>
                      <span className="text-blue-700">
                        {jobData?.currentPage || 0} / {jobData?.totalPages || 1} Pages Spooled
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full"
                        initial={{ width: '5%' }}
                        animate={{
                          width: `${Math.max(5, Math.min(100, Math.round(((jobData?.currentPage || 0) / (jobData?.totalPages || 1)) * 100)))}%`
                        }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>

                  <p className="text-slate-500 text-xs font-medium">
                    Please collect your pages as they emerge from the printer tray.
                  </p>

                  {/* Manual print trigger button for browser fallback */}
                  {jobData?.downloadUrl && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          playKeySound('tap');
                          triggerBrowserPrint(jobData.downloadUrl, {
                            copies: jobData.copies,
                            colorMode: jobData.colorMode,
                            totalPages: jobData.totalPages,
                          });
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200 transition-colors shadow-sm active:scale-95"
                      >
                        <Printer className="w-3.5 h-3.5 text-blue-600" />
                        <span>Re-send to Local Printer</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ──────────────────────────────────────── */}
          {/* 5. ORDER COMPLETED SCREEN (5-SECOND AUTO REDIRECT) */}
          {/* ──────────────────────────────────────── */}
          {screen === 'completed' && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              className="w-full max-w-md flex flex-col items-center text-center space-y-6"
            >
              {/* Success Badge */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                className="w-24 h-24 rounded-full bg-emerald-50 border-4 border-emerald-500 flex items-center justify-center text-emerald-600 shadow-2xl shadow-emerald-500/20"
              >
                <Check className="w-12 h-12 stroke-[3]" />
              </motion.div>

              <div>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                  Printing Completed!
                </h2>
                <p className="text-slate-600 text-sm font-medium mt-1">
                  Please collect your pages from the printer tray below.
                </p>
              </div>

              {/* 💖 Warm / Flirty Completion Quote Card */}
              {currentCompletionLine && (
                <div className="w-full p-5 rounded-3xl bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border-2 border-emerald-300 shadow-md text-center flex flex-col items-center gap-1.5">
                  <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-white px-3 py-0.5 rounded-full border border-emerald-200">
                    <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
                    <span>Thank You!</span>
                    <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
                  </div>
                  <p className="text-emerald-950 font-black text-base md:text-lg leading-snug">
                    "{currentCompletionLine}"
                  </p>
                </div>
              )}

              {/* ⏱️ Auto-Redirect 5s Countdown Notice */}
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-500 bg-slate-100 px-5 py-2.5 rounded-full">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>Returning to home screen in <strong className="text-slate-900 font-black">{countdown}s</strong>...</span>
              </div>
            </motion.div>
          )}

          {/* ──────────────────────────────────────── */}
          {/* 6. ERROR SCREEN */}
          {/* ──────────────────────────────────────── */}
          {screen === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md flex flex-col items-center text-center space-y-5"
            >
              <div className="w-20 h-20 rounded-full bg-rose-50 border-4 border-rose-500 flex items-center justify-center text-rose-600 shadow-lg">
                <XCircle className="w-10 h-10" />
              </div>

              <div>
                <h2 className="text-2xl font-black text-slate-900">Printing Issue</h2>
                <p className="text-rose-600 font-bold text-sm mt-1">{error || 'Something went wrong.'}</p>
              </div>

              <button
                onClick={() => {
                  playKeySound('tap');
                  setScreen('idle');
                }}
                className="py-3.5 px-8 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-base shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
              >
                Back to Home
              </button>
            </motion.div>
          )}

          {/* ──────────────────────────────────────── */}
          {/* 7. MAINTENANCE / OUT OF SERVICE SCREEN */}
          {/* ──────────────────────────────────────── */}
          {screen === 'maintenance' && (
            <motion.div
              key="maintenance"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-white border-2 border-amber-300 p-8 rounded-[32px] text-center space-y-6 shadow-2xl shadow-amber-500/10"
            >
              <div className="w-20 h-20 rounded-full bg-amber-50 border-4 border-amber-400 flex items-center justify-center text-amber-600 shadow-md mx-auto">
                <Wrench className="w-10 h-10" />
              </div>

              <div className="space-y-2">
                <span className="text-[11px] font-black uppercase text-amber-800 bg-amber-100 px-3.5 py-1 rounded-full">
                  Temporary Service Notice
                </span>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight">Station Under Maintenance</h2>
                <p className="text-slate-600 text-sm font-medium leading-relaxed">
                  Station <strong className="text-slate-900 font-bold">{kioskId}</strong> is currently paused for paper refilling or hardware check. Your 6-digit release code can be printed at any active station.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 font-bold flex items-center justify-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
                <span>Station will automatically activate when admin resumes service</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ════════════════════════════════════════════════ */}
      {/* FOOTER */}
      {/* ════════════════════════════════════════════════ */}
      {/* ════════════════════════════════════════════════ */}
      {/* FOOTER */}
      {/* ════════════════════════════════════════════════ */}
      <footer className="flex items-center justify-between text-xs font-bold text-slate-500 relative z-10 pt-4 border-t border-slate-200">
        <div className="flex items-center gap-3">
          <span>Print Bro Cloud v2.0</span>
          <span>•</span>
          <button
            type="button"
            onClick={() => {
              playKeySound('tap');
              fetchDetectedPrinters();
              setIsPrinterModalOpen(true);
            }}
            className="text-slate-700 hover:text-blue-700 font-bold flex items-center gap-1.5 bg-slate-100 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 px-3 py-1 rounded-xl transition-all"
            title="Click to check or switch hardware printer"
          >
            <Printer className="w-3.5 h-3.5 text-blue-600" />
            <span>Hardware Printer: <strong className="text-slate-900">{activePrinterName || 'Auto-Detected Printer'}</strong></span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-700 font-extrabold uppercase text-[10px]">({printerStatus})</span>
          </button>
        </div>
        <p className="text-slate-400">Powered by Print Bro Self-Service</p>
      </footer>

      {/* ════════════════════════════════════════════════ */}
      {/* HARDWARE PRINTER DETECTION & SWITCHER MODAL */}
      {/* ════════════════════════════════════════════════ */}
      <AnimatePresence>
        {isPrinterModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-lg bg-white rounded-3xl border-2 border-blue-200 shadow-2xl p-6 md:p-8 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                    <Printer className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Hardware Printer Setup</h3>
                    <p className="text-xs text-slate-500 font-medium">Auto-detected printers connected to this PC</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPrinterModalOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Current Active Printer Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase text-blue-700 tracking-wider">Active Printing Device</span>
                  <p className="text-base font-black text-slate-900 mt-0.5">{activePrinterName}</p>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>ONLINE READY</span>
                </div>
              </div>

              {/* Detected Printers List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                  <span>Detected Printers on this Machine ({detectedPrinters.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      playKeySound('tap');
                      fetchDetectedPrinters();
                    }}
                    className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs font-bold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Rescan</span>
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {detectedPrinters.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                      Scanning PC for connected USB & Network printers...
                    </div>
                  ) : (
                    detectedPrinters.map((p) => {
                      const isSelected = p.name.toLowerCase() === activePrinterName.toLowerCase();
                      return (
                        <div
                          key={p.name}
                          onClick={() => handleAssignPrinter(p.name)}
                          className={`p-3.5 rounded-2xl border-2 cursor-pointer flex items-center justify-between transition-all ${
                            isSelected
                              ? 'bg-blue-50/60 border-blue-500 shadow-sm'
                              : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Printer className={`w-5 h-5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                            <div>
                              <p className="text-sm font-black text-slate-900">{p.name}</p>
                              <span className="text-[11px] text-slate-500 font-medium">
                                {p.isDefault ? 'System Default • ' : ''}Hardware Spooler Ready
                              </span>
                            </div>
                          </div>
                          {isSelected ? (
                            <span className="px-2.5 py-1 rounded-xl bg-blue-600 text-white text-xs font-black flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> Selected
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isSwitchingPrinter}
                              className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 text-xs font-bold transition-all"
                            >
                              Use This
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsPrinterModalOpen(false)}
                  className="py-2.5 px-6 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-all shadow-md"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
