'use client';

import { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileText,
  Image as ImageIcon,
  X,
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  DollarSign,
  Files,
  Sparkles,
  Eye,
  RotateCw,
  Printer,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Plus,
  Bot,
  Zap,
  Check,
  Search,
  MapPin,
  Radio,
} from 'lucide-react';
import { io } from 'socket.io-client';
import { createSession, uploadFile, calculatePrice, getKiosks, getPricing, createJob, getApiUrl } from '../../lib/api';
import { renderPdfPages } from '../../lib/pdf-preview';
import { playKeySound } from '../../lib/sound';

type Step = 'kiosk' | 'upload' | 'settings' | 'demo' | 'summary';

interface FileSettingsState {
  file: File;
  name: string;
  size: number;
  pageCount: number;
  selectedPages: number[];
  pageRange: string;
  previewUrl?: string;
  pageThumbnails?: string[];
  fileType: 'image' | 'pdf' | 'docx' | 'other';
}

function RemotePrintContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedKiosk = searchParams.get('kiosk');

  const [step, setStep] = useState<Step>(preselectedKiosk ? 'upload' : 'kiosk');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInfo, setFileInfo] = useState<{
    id: string;
    originalName: string;
    pageCount: number;
    sizeBytes: number;
    mimeType: string;
    filesCount?: number;
    filesBreakdown?: Array<{ name: string; pageCount: number; sizeBytes: number }>;
    downloadUrl?: string;
  } | null>(null);

  // Real-time Upload Progress State
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadLoadedBytes, setUploadLoadedBytes] = useState(0);
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);

  // Per-file detailed settings
  const [perFileSettings, setPerFileSettings] = useState<FileSettingsState[]>([]);

  // Global Settings state
  const [colorMode, setColorMode] = useState<'BW' | 'COLOR'>('BW');
  const [sides, setSides] = useState<'SINGLE' | 'DOUBLE'>('SINGLE');
  const [orientation, setOrientation] = useState<'PORTRAIT' | 'LANDSCAPE'>('PORTRAIT');
  const [copies, setCopies] = useState(1);
  const [pageRange, setPageRange] = useState<string>('');

  // Gallery Swiper / Slider state
  const [activeGalleryIdx, setActiveGalleryIdx] = useState(0);
  const [activeDocPageNum, setActiveDocPageNum] = useState(1);
  const [slideDirection, setSlideDirection] = useState<number>(0);

  // Kiosk state
  const [kiosks, setKiosks] = useState<any[]>([]);
  const [selectedKiosk, setSelectedKiosk] = useState<string | null>(preselectedKiosk);
  const [anyKiosk, setAnyKiosk] = useState(!preselectedKiosk);
  const [kioskSearch, setKioskSearch] = useState('');

  // Live dynamic pricing rules
  const [pricingRules, setPricingRules] = useState<{ BW: number; COLOR: number }>({ BW: 2, COLOR: 10 });

  // Price state
  const [price, setPrice] = useState<{
    pages: number;
    totalPages: number;
    copies: number;
    sheets: number;
    sheetsPerCopy: number;
    pricePerPage: number;
    subtotal: number;
    total: number;
    currency: string;
    breakdown: string;
  } | null>(null);

  const loadKiosksList = useCallback(async () => {
    try {
      const res = await getKiosks();
      if (res.success && res.data) {
        setKiosks(res.data);
      }
    } catch (e) {}
  }, []);

  // Init session on mount
  useEffect(() => {
    async function init() {
      try {
        const res = await createSession(undefined, 'CODE');
        if (res.success && res.data?.id) {
          setSessionId(res.data.id);
        }
      } catch (e) {}
    }
    init();
  }, []);

  // Load kiosks and live dynamic pricing rules
  useEffect(() => {
    async function loadData() {
      try {
        const [kioskRes, priceRes] = await Promise.all([getKiosks(), getPricing()]);
        if (kioskRes.success && kioskRes.data) setKiosks(kioskRes.data);
        if (priceRes.success && priceRes.data) {
          const bw = priceRes.data.find((r: any) => r.colorMode === 'BW' && r.paperSize === 'A4');
          const color = priceRes.data.find((r: any) => r.colorMode === 'COLOR' && r.paperSize === 'A4');
          setPricingRules({
            BW: bw ? bw.pricePerPage : 2,
            COLOR: color ? color.pricePerPage : 10,
          });
        }
      } catch (e) {}
    }
    loadData();
  }, []);

  // When selected kiosk changes, update pricing rules specifically for that kiosk
  useEffect(() => {
    async function loadKioskPricing() {
      try {
        const url = selectedKiosk ? `${getApiUrl()}/api/pricing?kiosk=${selectedKiosk}` : `${getApiUrl()}/api/pricing`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const bw = json.data.find((r: any) => r.colorMode === 'BW' && r.paperSize === 'A4');
          const color = json.data.find((r: any) => r.colorMode === 'COLOR' && r.paperSize === 'A4');
          setPricingRules({
            BW: bw ? bw.pricePerPage : 2,
            COLOR: color ? color.pricePerPage : 10,
          });
        }
      } catch (e) {}
    }
    loadKioskPricing();
  }, [selectedKiosk]);

  // Live WebSocket sync when admin creates, modifies, or deletes kiosks, or updates pricing
  useEffect(() => {
    const socket = io(getApiUrl(), { transports: ['websocket', 'polling'] });
    socket.on('kiosks_updated', () => {
      console.log('⚡ Live kiosk fleet updated from admin');
      loadKiosksList();
    });
    socket.on('kiosk_updated', () => {
      loadKiosksList();
    });
    socket.on('pricing_updated', (data: any) => {
      console.log('⚡ Live dynamic pricing updated from admin:', data);
      if (data?.kioskId && selectedKiosk && data.kioskId !== selectedKiosk && data.kioskDisplayId !== selectedKiosk) {
        return;
      }
      if (typeof data?.bwPrice === 'number' || typeof data?.colorPrice === 'number') {
        setPricingRules(prev => ({
          BW: typeof data.bwPrice === 'number' ? data.bwPrice : prev.BW,
          COLOR: typeof data.colorPrice === 'number' ? data.colorPrice : prev.COLOR,
        }));
      } else if (data?.rules && Array.isArray(data.rules)) {
        const bw = data.rules.find((r: any) => r.colorMode === 'BW' && r.paperSize === 'A4');
        const color = data.rules.find((r: any) => r.colorMode === 'COLOR' && r.paperSize === 'A4');
        setPricingRules({
          BW: bw && typeof bw.pricePerPage === 'number' ? bw.pricePerPage : 2,
          COLOR: color && typeof color.pricePerPage === 'number' ? color.pricePerPage : 10,
        });
      }
    });
    return () => {
      socket.disconnect();
    };
  }, [loadKiosksList, selectedKiosk]);

  // Total selected pages calculation across all documents
  const totalCalculatedPages = perFileSettings.length > 0
    ? perFileSettings.reduce((sum, f) => sum + f.selectedPages.length, 0)
    : (fileInfo?.pageCount || 1);

  // Calculate dynamic real-time price
  const calculateDynamicTotal = useCallback(() => {
    const rate = colorMode === 'BW' ? pricingRules.BW : pricingRules.COLOR;
    const baseTotal = totalCalculatedPages * rate * copies;
    return Math.max(1, baseTotal);
  }, [totalCalculatedPages, colorMode, pricingRules, copies]);

  // Real-time price calculation helper
  const updatePrice = useCallback(async (
    targetFileId: string,
    targetColor: 'BW' | 'COLOR',
    targetSides: 'SINGLE' | 'DOUBLE',
    targetCopies: number,
    targetRange: string
  ) => {
    if (!targetFileId) return;
    try {
      const res = await calculatePrice({
        fileId: targetFileId,
        colorMode: targetColor,
        paperSize: 'A4',
        sides: targetSides,
        copies: targetCopies,
        pageRange: targetRange.trim() || undefined,
      });
      if (res.success && res.data) {
        setPrice(res.data);
      }
    } catch (e) {}
  }, []);

  // Recalculate price whenever settings change
  useEffect(() => {
    if (fileInfo?.id) {
      updatePrice(fileInfo.id, colorMode, sides, copies, pageRange);
    }
  }, [fileInfo?.id, colorMode, sides, copies, pageRange, updatePrice]);

  // Real-time Upload Handler with Live Progress & Preview Generation
  const handleFiles = useCallback(async (files: FileList | File[], isAppend = false) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const fileArray = isAppend ? [...selectedFiles, ...incoming].slice(0, 10) : incoming.slice(0, 10);
    setSelectedFiles(fileArray);
    setError(null);
    setUploading(true);
    setUploadPercent(0);
    setUploadLoadedBytes(0);
    setUploadTotalBytes(0);

    // Generate local preview URLs for images & PDFs
    const initialPerFile: FileSettingsState[] = fileArray.map((f) => {
      let fType: 'image' | 'pdf' | 'docx' | 'other' = 'other';
      if (f.type.startsWith('image/') || f.name.match(/\.(jpg|jpeg|png)$/i)) fType = 'image';
      else if (f.type === 'application/pdf' || f.name.endsWith('.pdf')) fType = 'pdf';
      else if (f.name.match(/\.(doc|docx)$/i)) fType = 'docx';

      return {
        file: f,
        name: f.name,
        size: f.size,
        pageCount: 1,
        selectedPages: [1],
        pageRange: '',
        previewUrl: fType === 'image' || fType === 'pdf' ? URL.createObjectURL(f) : undefined,
        fileType: fType,
      };
    });
    setPerFileSettings(initialPerFile);

    // Client-side instant PDF rendering
    fileArray.forEach(async (f, idx) => {
      if (f.type === 'application/pdf' || f.name.endsWith('.pdf')) {
        try {
          const thumbnails = await renderPdfPages(f);
          if (thumbnails && thumbnails.length > 0) {
            setPerFileSettings((prev) => {
              const copy = [...prev];
              if (copy[idx]) {
                copy[idx] = { ...copy[idx], pageThumbnails: thumbnails };
              }
              return copy;
            });
          }
        } catch {}
      }
    });

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const sessionRes = await createSession(undefined, 'CODE');
        if (sessionRes.success && sessionRes.data?.id) {
          activeSessionId = sessionRes.data.id;
          setSessionId(activeSessionId);
        } else if (sessionRes.error) {
          setError(sessionRes.error);
          setUploading(false);
          return;
        } else {
          activeSessionId = `sess_${Date.now()}`;
          setSessionId(activeSessionId);
        }
      }

      const res = await uploadFile(
        activeSessionId || `sess_${Date.now()}`,
        fileArray,
        (percent, loaded, total) => {
          setUploadPercent(percent);
          setUploadLoadedBytes(loaded);
          setUploadTotalBytes(total);
        }
      );

      if (res.success && res.data) {
        setFileInfo(res.data);
        setUploading(false);

        // Update per-file state with accurate server page counts
        if (res.data.filesBreakdown && res.data.filesBreakdown.length > 0) {
          setPerFileSettings((prev) =>
            prev.map((item, idx) => {
              const serverInfo = res.data.filesBreakdown[idx];
              const count = serverInfo ? serverInfo.pageCount : 1;
              return {
                ...item,
                pageCount: count,
                selectedPages: Array.from({ length: count }, (_, i) => i + 1),
              };
            })
          );
        }

        // Render converted DOCX / PDF from backend stream URL
        if (res.data.downloadUrl) {
          try {
            const convertedThumbnails = await renderPdfPages(res.data.downloadUrl);
            if (convertedThumbnails && convertedThumbnails.length > 0) {
              setPerFileSettings((prev) =>
                prev.map((item, idx) => {
                  if (item.fileType === 'docx' || (item.fileType === 'pdf' && (!item.pageThumbnails || item.pageThumbnails.length === 0))) {
                    return { ...item, pageThumbnails: convertedThumbnails };
                  }
                  return item;
                })
              );
            }
          } catch {}
        }

        updatePrice(res.data.id, colorMode, sides, copies, pageRange);
      } else {
        setError(res.error || 'Upload failed. Please try again.');
        setUploading(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
      setUploading(false);
    }
  }, [sessionId, selectedFiles, colorMode, sides, copies, pageRange, updatePrice]);

  // Remove a document from the job
  const removeDocument = (removeIdx: number) => {
    playKeySound('delete');
    const updatedFiles = selectedFiles.filter((_, idx) => idx !== removeIdx);
    if (updatedFiles.length === 0) {
      setSelectedFiles([]);
      setFileInfo(null);
      setPerFileSettings([]);
      setActiveGalleryIdx(0);
      setStep('upload');
      return;
    }

    if (activeGalleryIdx >= updatedFiles.length) {
      setActiveGalleryIdx(updatedFiles.length - 1);
    }
    handleFiles(updatedFiles);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      playKeySound('tap');
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  // Gallery Navigation (Swipe / Arrow Navigation)
  const nextSlide = () => {
    if (perFileSettings.length <= 1) return;
    playKeySound('tap');
    setSlideDirection(1);
    setActiveGalleryIdx((prev) => (prev + 1) % perFileSettings.length);
    setActiveDocPageNum(1);
  };

  const prevSlide = () => {
    if (perFileSettings.length <= 1) return;
    playKeySound('tap');
    setSlideDirection(-1);
    setActiveGalleryIdx((prev) => (prev - 1 + perFileSettings.length) % perFileSettings.length);
    setActiveDocPageNum(1);
  };

  // Per-file page toggle & add/remove
  const toggleFilePage = (fileIdx: number, pageNum: number) => {
    playKeySound('tap');
    setPerFileSettings((prev) => {
      const updated = [...prev];
      const target = updated[fileIdx];
      if (!target) return prev;

      let list = target.selectedPages.includes(pageNum)
        ? target.selectedPages.filter((p) => p !== pageNum)
        : [...target.selectedPages, pageNum];

      if (list.length === 0) list = [pageNum];
      list.sort((a, b) => a - b);

      target.selectedPages = list;
      target.pageRange = list.length === target.pageCount ? '' : list.join(', ');
      return updated;
    });
    setActiveDocPageNum(pageNum);
  };

  // Create job and navigate to payment
  const handleCreateJob = async () => {
    if (!fileInfo) return;
    playKeySound('success');
    setLoading(true);
    setError(null);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const sessionRes = await createSession(undefined, 'CODE');
        if (sessionRes.success && sessionRes.data?.id) {
          activeSessionId = sessionRes.data.id;
          setSessionId(activeSessionId);
        } else if (sessionRes.error) {
          setError(sessionRes.error);
          setLoading(false);
          return;
        } else {
          activeSessionId = `sess_${Date.now()}`;
          setSessionId(activeSessionId);
        }
      }

      const totalAmount = calculateDynamicTotal();
      const totalPagesCount = totalCalculatedPages * copies;

      const jobRes = await createJob({
        sessionId: activeSessionId,
        fileId: fileInfo.id,
        kioskId: anyKiosk ? null : selectedKiosk,
        printMethod: 'CODE',
        colorMode,
        paperSize: 'A4',
        sides,
        orientation,
        copies,
        pageRange: pageRange.trim() || null,
        totalPages: totalPagesCount,
        totalPrice: totalAmount,
      });

      if (!jobRes.success || !jobRes.data) {
        playKeySound('error');
        setError(jobRes.error || 'Failed to create print job');
        setLoading(false);
        return;
      }

      const initialCode = jobRes.data.printCode?.code;
      if (initialCode && typeof window !== 'undefined') {
        const payload = JSON.stringify({
          code: initialCode,
          expiresAt: jobRes.data.printCode?.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          jobId: jobRes.data.id,
          displayId: jobRes.data.displayId,
          savedAt: new Date().toISOString(),
        });
        try {
          localStorage.setItem(`xpos_code_${jobRes.data.id}`, payload);
          localStorage.setItem(`xpos_code_${jobRes.data.displayId}`, payload);
          localStorage.setItem('xpos_last_code', initialCode);
          localStorage.setItem('xpos_last_job_id', jobRes.data.id);
          localStorage.setItem('xpos_last_display_id', jobRes.data.displayId);
        } catch {}
      }

      // Navigate to payment
      const codeQuery = initialCode ? `&code=${initialCode}` : '';
      router.push(`/payment?jobId=${jobRes.data.id}&displayId=${jobRes.data.displayId}&amount=${totalAmount}&method=CODE${codeQuery}`);
    } catch (err: any) {
      playKeySound('error');
      setError(err?.message || 'Failed to proceed to payment');
      setLoading(false);
    }
  };

  // Mascot Guide Message helper
  const getMascotMessage = () => {
    if (step === 'kiosk') return "Choose your preferred station or pick 'Universal Pickup' to print at any active kiosk!";
    if (step === 'upload') return "Drop up to 10 files or photos & I'll merge them instantly!";
    if (step === 'settings') return "Customize color, double side & tap pages to customize!";
    if (step === 'demo') return "Swipe through your real document gallery & tap pages to toggle!";
    return "Review your order summary & pay securely via UPI!";
  };

  return (
    <div className="min-h-screen flex flex-col justify-between px-4 py-5 max-w-lg md:max-w-xl mx-auto bg-[#f8fbff] text-slate-900 antialiased selection:bg-blue-600 selection:text-white font-sans scroll-smooth">
      {/* Top Bar */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => {
              if (step === 'kiosk') router.back();
              else if (step === 'upload') setStep(preselectedKiosk ? 'upload' : 'kiosk');
              else if (step === 'settings') setStep('upload');
              else if (step === 'demo') setStep('settings');
              else if (step === 'summary') setStep('demo');
            }}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 transition-all font-bold text-sm bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 shadow-sm active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            {['kiosk', 'upload', 'settings', 'demo', 'summary'].map((s, i) => (
              <div
                key={s}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  step === s
                    ? 'bg-blue-600 scale-125 shadow-sm shadow-blue-500'
                    : i < ['kiosk', 'upload', 'settings', 'demo', 'summary'].indexOf(step)
                    ? 'bg-blue-300'
                    : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* 🤖 Animated Companion Mascot Badge ("Printy") */}
        <motion.div
          layout
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center gap-3"
        >
          <motion.div
            animate={{ y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
            className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white flex-shrink-0 shadow-sm"
          >
            <Bot className="w-4 h-4" />
          </motion.div>
          <p className="text-xs md:text-sm font-semibold text-slate-700 leading-tight">
            <strong className="text-blue-700 font-extrabold">Printy:</strong> {getMascotMessage()}
          </p>
        </motion.div>
      </div>

      <AnimatePresence mode="wait">
        {/* ════════════════════════════════════════════════ */}
        {/* STEP 1: PROMINENT, BOLD UPLOAD SECTION */}
        {/* ════════════════════════════════════════════════ */}
        {step === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
            className="flex-1 flex flex-col space-y-4 my-auto"
          >
            {/* Prominent, Big & Bold Headline */}
            <div>
              <span className="text-xs font-black text-blue-700 bg-blue-100 px-3.5 py-1 rounded-full uppercase tracking-wider">⚡ 3-Second Fast Upload</span>
              <h1 className="text-3xl md:text-4xl font-black text-slate-900 mt-2 mb-1 tracking-tight">Upload Documents</h1>
              <p className="text-slate-600 text-sm md:text-base font-medium">Select single or multiple files (PDF, DOCX, Word, JPG, PNG)</p>
            </div>

            {/* Hidden Add More Input */}
            <input
              ref={addMoreInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files, true)}
            />

            {!fileInfo ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !uploading && fileInputRef.current?.click()}
                className="flex-1 flex flex-col items-center justify-center cursor-pointer bg-white hover:bg-blue-50/40 transition-all duration-300 border-2 border-dashed border-blue-300 hover:border-blue-600 min-h-[320px] p-8 rounded-3xl text-center shadow-xl shadow-blue-500/5 group active:scale-[0.99]"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />

                {uploading ? (
                  <div className="flex flex-col items-center gap-4 w-full max-w-sm px-2">
                    <div className="relative flex items-center justify-center">
                      <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                      <span className="absolute font-mono font-black text-sm text-blue-700">{uploadPercent}%</span>
                    </div>

                    <div className="w-full space-y-2 text-center">
                      <p className="text-slate-900 font-extrabold text-lg">
                        Uploading {selectedFiles.length > 1 ? `${selectedFiles.length} Files` : selectedFiles[0]?.name || 'Document'}
                      </p>

                      {/* Real-time Percentage Progress Bar */}
                      <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden border border-blue-100 shadow-inner">
                        <motion.div
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadPercent}%` }}
                          transition={{ duration: 0.12, ease: 'easeOut' }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-1">
                        <span>{uploadPercent}% uploaded</span>
                        <span>
                          {uploadTotalBytes > 0
                            ? `${(uploadLoadedBytes / 1024 / 1024).toFixed(1)} / ${(uploadTotalBytes / 1024 / 1024).toFixed(1)} MB`
                            : 'Preparing...'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <motion.div
                      whileHover={{ scale: 1.08 }}
                      className="w-20 h-20 p-4.5 rounded-3xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center mb-4 text-blue-600 shadow-lg shadow-blue-500/10 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300"
                    >
                      <Upload className="w-10 h-10" />
                    </motion.div>
                    <p className="text-slate-900 font-black text-2xl mb-1">Tap to select or drop files</p>

                    <div className="my-2 py-1.5 px-4 rounded-full bg-blue-100/80 border border-blue-300 text-blue-900 font-black text-sm inline-flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-blue-700" />
                      <span>UPLOAD UP TO 10 PHOTOS OR DOCUMENTS</span>
                    </div>

                    <p className="text-xs text-slate-500 font-mono mt-2">
                      PDF • Word DOCX • JPG • PNG (Auto-Merged)
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-white border-2 border-blue-200 p-5 rounded-3xl shadow-lg shadow-blue-500/5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center flex-shrink-0 text-blue-600">
                      {selectedFiles.length > 1 ? <Files className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="text-slate-900 font-black text-base truncate max-w-[200px]">{fileInfo.originalName}</p>
                      <p className="text-blue-600 text-xs font-bold">
                        {totalCalculatedPages} pages • {perFileSettings.length} files • {(fileInfo.sizeBytes / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => addMoreInputRef.current?.click()}
                    className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-black text-xs px-3.5 py-2 rounded-xl border border-blue-200 transition-all active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add More</span>
                  </button>
                </div>

                {/* Per-File Interactive Card List with Delete Button */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <p className="text-xs font-black text-slate-700 uppercase tracking-wider">Uploaded Documents ({perFileSettings.length}):</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {perFileSettings.map((f, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-blue-50/70 border border-blue-100 px-3.5 py-2 rounded-2xl text-xs">
                        <div className="flex items-center gap-2.5 truncate max-w-[200px]">
                          {f.fileType === 'image' ? <ImageIcon className="w-4 h-4 text-blue-600 flex-shrink-0" /> : <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                          <span className="font-bold text-slate-800 truncate">{idx + 1}. {f.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-200">{f.pageCount} {f.pageCount === 1 ? 'pg' : 'pgs'}</span>
                          <button
                            onClick={() => removeDocument(idx)}
                            className="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center transition-colors active:scale-90"
                            title="Remove file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error && <p className="mt-2 text-rose-600 text-sm font-bold text-center bg-rose-50 border border-rose-200 p-3 rounded-xl">{error}</p>}
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* STEP 2: SETTINGS (PER-FILE CUSTOM SELECTION & LIVE PRICE) */}
        {/* ════════════════════════════════════════════════ */}
        {step === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
            className="flex-1 flex flex-col space-y-4 my-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Print Settings</h1>
                <p className="text-blue-600 text-xs font-bold mt-0.5">{totalCalculatedPages} total pages selected • {perFileSettings.length} files</p>
              </div>
              <div className="bg-blue-600 text-white px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-md shadow-blue-500/20">
                <span className="font-black text-base">₹{calculateDynamicTotal()}</span>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              {/* Color Mode */}
              <div>
                <label className="text-slate-800 text-xs font-black uppercase tracking-wider mb-2 block">Color Mode</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { v: 'BW', l: 'Black & White', p: `₹${pricingRules.BW} / page` },
                    { v: 'COLOR', l: 'Full Color', p: `₹${pricingRules.COLOR} / page` }
                  ].map(({ v, l, p }) => (
                    <motion.button
                      key={v}
                      type="button"
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => setColorMode(v as any)}
                      className={`p-4 rounded-2xl border-2 transition-all text-left ${
                        colorMode === v
                          ? 'border-blue-600 bg-blue-50 shadow-md shadow-blue-500/10'
                          : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <p className={`font-black text-base ${colorMode === v ? 'text-blue-700' : 'text-slate-900'}`}>{l}</p>
                      <p className="text-slate-600 text-xs mt-0.5 font-bold">{p}</p>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Sides */}
              <div>
                <label className="text-slate-800 text-xs font-black uppercase tracking-wider mb-2 block">Sides (Paper Usage)</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { v: 'SINGLE', l: 'Single Side', p: '1 page per sheet' },
                    { v: 'DOUBLE', l: 'Double Side (Duplex)', p: colorMode === 'BW' ? `₹${Math.round(pricingRules.BW * 1.5)} / sheet (Save 25%)` : `₹${Math.round(pricingRules.COLOR * 1.8)} / sheet` }
                  ].map(({ v, l, p }) => (
                    <motion.button
                      key={v}
                      type="button"
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => setSides(v as any)}
                      className={`p-4 rounded-2xl border-2 transition-all text-left ${
                        sides === v
                          ? 'border-blue-600 bg-blue-50 shadow-md shadow-blue-500/10'
                          : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <p className={`font-black text-base ${sides === v ? 'text-blue-700' : 'text-slate-900'}`}>{l}</p>
                      <p className="text-slate-600 text-xs mt-0.5 font-bold">{p}</p>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Orientation */}
              <div>
                <label className="text-slate-800 text-xs font-black uppercase tracking-wider mb-2 block">Paper Orientation</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { v: 'PORTRAIT', l: 'Portrait (Vertical)', desc: 'Standard upright', isLandscape: false },
                    { v: 'LANDSCAPE', l: 'Landscape (Horizontal)', desc: 'Wide horizontal', isLandscape: true }
                  ].map(({ v, l, desc, isLandscape }) => (
                    <motion.button
                      key={v}
                      type="button"
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => setOrientation(v as any)}
                      className={`p-4 rounded-2xl border-2 transition-all text-left flex items-start gap-3 ${
                        orientation === v
                          ? 'border-blue-600 bg-blue-50 shadow-md shadow-blue-500/10'
                          : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                        orientation === v ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-slate-200 bg-slate-100 text-slate-600'
                      }`}>
                        {isLandscape ? (
                          <div className="w-5 h-3.5 rounded-sm border-2 border-current flex items-center justify-center">
                            <div className="w-2.5 h-0.5 bg-current rounded-full" />
                          </div>
                        ) : (
                          <div className="w-3.5 h-5 rounded-sm border-2 border-current flex items-center justify-center">
                            <div className="w-1.5 h-0.5 bg-current rounded-full" />
                          </div>
                        )}
                      </div>
                      <div>
                        <p className={`font-black text-sm ${orientation === v ? 'text-blue-700' : 'text-slate-900'}`}>{l}</p>
                        <p className="text-slate-500 text-xs mt-0.5 font-medium">{desc}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Copies */}
              <div>
                <label className="text-slate-800 text-xs font-black uppercase tracking-wider mb-2 block">Copies</label>
                <div className="flex items-center gap-4 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setCopies(Math.max(1, copies - 1))}
                    className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-2xl font-black flex items-center justify-center transition-colors border border-slate-300"
                  >
                    −
                  </button>
                  <span className="text-2xl font-black text-slate-900 w-10 text-center font-display">{copies}</span>
                  <button
                    type="button"
                    onClick={() => setCopies(Math.min(20, copies + 1))}
                    className="w-11 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-2xl font-black flex items-center justify-center transition-colors shadow-sm"
                  >
                    +
                  </button>
                  <span className="text-slate-600 text-xs font-bold ml-auto">
                    Total: {totalCalculatedPages * copies} printed pages
                  </span>
                </div>
              </div>

              {/* Price Calculation Card */}
              <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs text-blue-700 uppercase tracking-wider font-extrabold">Live Total Price</p>
                  <p className="text-xs text-slate-700 mt-0.5 font-bold">
                    {totalCalculatedPages} pages × ₹{colorMode === 'BW' ? pricingRules.BW : pricingRules.COLOR} × {copies} {copies === 1 ? 'copy' : 'copies'}
                  </p>
                </div>
                <span className="text-3xl font-black text-blue-700 font-display">
                  ₹{calculateDynamicTotal()}
                </span>
              </div>
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* STEP 3: SWIPEABLE GALLERY PREVIEW WITH IN-PLACE PAGE SELECTION */}
        {/* ════════════════════════════════════════════════ */}
        {step === 'demo' && (
          <motion.div
            key="demo"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
            className="flex-1 flex flex-col space-y-3 my-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-black text-blue-600 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">Slide & Inspect</span>
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 mt-1 tracking-tight">Gallery Print Preview</h1>
              </div>
              <div className="bg-blue-600 text-white px-3.5 py-1 rounded-full font-black text-sm shadow-sm">
                ₹{calculateDynamicTotal()}
              </div>
            </div>
            <p className="text-slate-600 text-xs font-medium">Swipe or tap arrows to slide through documents & tap page pills to toggle:</p>

            {/* Document / Photo Gallery Slider Sheet */}
            <div className="relative flex-1 flex flex-col items-center justify-center py-2">
              {/* Left Arrow Button */}
              {perFileSettings.length > 1 && (
                <button
                  onClick={prevSlide}
                  className="absolute left-1 z-20 w-9 h-9 rounded-full bg-white/90 shadow-md border border-slate-200 text-slate-800 flex items-center justify-center hover:bg-blue-50 active:scale-95 transition-all"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}

              {/* Right Arrow Button */}
              {perFileSettings.length > 1 && (
                <button
                  onClick={nextSlide}
                  className="absolute right-1 z-20 w-9 h-9 rounded-full bg-white/90 shadow-md border border-slate-200 text-slate-800 flex items-center justify-center hover:bg-blue-50 active:scale-95 transition-all"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}

              {/* Main Swipable Paper Card */}
              <div className="w-full max-w-sm flex items-center justify-center overflow-hidden py-1">
                <AnimatePresence mode="wait" custom={slideDirection}>
                  <motion.div
                    key={`${activeGalleryIdx}_${activeDocPageNum}`}
                    custom={slideDirection}
                    initial={{ opacity: 0, x: slideDirection > 0 ? 60 : -60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: slideDirection > 0 ? -60 : 60 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    className={`bg-white border-2 border-slate-300 rounded-3xl shadow-2xl shadow-blue-900/10 p-5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${
                      orientation === 'LANDSCAPE' ? 'w-84 h-64' : 'w-72 h-92'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="font-mono text-xs font-bold text-slate-600 truncate max-w-[140px]">
                        {perFileSettings[activeGalleryIdx]?.name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                          colorMode === 'COLOR' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {colorMode === 'COLOR' ? 'Color' : 'B&W'}
                        </span>
                        <button
                          onClick={() => removeDocument(activeGalleryIdx)}
                          className="w-6 h-6 rounded-md bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-100"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Content: Real Render depending on file type */}
                    {perFileSettings[activeGalleryIdx]?.fileType === 'image' && perFileSettings[activeGalleryIdx]?.previewUrl ? (
                      /* 1. ACTUAL Uploaded High-Res Image */
                      <div className={`my-auto w-full h-48 rounded-2xl overflow-hidden flex items-center justify-center bg-slate-50 border border-slate-200 ${
                        colorMode === 'BW' ? 'grayscale contrast-125' : ''
                      }`}>
                        <img
                          src={perFileSettings[activeGalleryIdx].previewUrl}
                          alt="Uploaded Preview"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    ) : perFileSettings[activeGalleryIdx]?.pageThumbnails && perFileSettings[activeGalleryIdx].pageThumbnails!.length > 0 ? (
                      /* 2. ACTUAL High-Res Rendered PDF / DOCX Page Image (100% visible on all mobile phones!) */
                      <div className={`my-auto w-full h-48 rounded-2xl overflow-hidden flex items-center justify-center bg-white border border-slate-200 shadow-inner ${
                        colorMode === 'BW' ? 'grayscale contrast-125' : ''
                      }`}>
                        <img
                          src={perFileSettings[activeGalleryIdx].pageThumbnails![activeDocPageNum - 1] || perFileSettings[activeGalleryIdx].pageThumbnails![0]}
                          alt="Document Page Preview"
                          className="max-h-full max-w-full object-contain shadow-xs"
                        />
                      </div>
                    ) : (
                      /* 3. Document Formatted Visual Sheet */
                      <div className={`my-auto w-full p-4 rounded-2xl bg-blue-50/50 border border-blue-100 space-y-2.5 ${
                        colorMode === 'BW' ? 'grayscale' : ''
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-blue-700 font-bold text-xs truncate max-w-[140px]">
                            <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                            <span className="truncate">{perFileSettings[activeGalleryIdx]?.name || 'Document'}</span>
                          </div>
                          <span className="text-[10px] font-black bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-mono">
                            {perFileSettings[activeGalleryIdx]?.pageCount} Pgs
                          </span>
                        </div>

                        <div className="h-2.5 bg-blue-600/80 rounded-full w-4/5" />
                        <div className="h-2 bg-slate-300 rounded-full w-full" />
                        <div className="h-2 bg-slate-200 rounded-full w-11/12" />
                        <div className="h-2 bg-slate-200 rounded-full w-4/5" />
                        <div className="h-2 bg-slate-300 rounded-full w-2/3" />
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-bold">
                      <span>{sides === 'DOUBLE' ? 'Duplex (2-Sided)' : 'Single Sided'}</span>
                      <span>Item {activeGalleryIdx + 1} of {perFileSettings.length}</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* In-Place Page Selection Controls for Active Document */}
              {perFileSettings[activeGalleryIdx] && perFileSettings[activeGalleryIdx].pageCount > 1 && (
                <div className="w-full max-w-sm bg-white p-3 rounded-2xl border border-blue-200 mt-2 shadow-sm space-y-1.5 text-center">
                  <div className="flex justify-between items-center text-xs px-1">
                    <span className="font-bold text-slate-700">Tap to Toggle / View Page:</span>
                    <span className="font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200">
                      {perFileSettings[activeGalleryIdx].selectedPages.length} of {perFileSettings[activeGalleryIdx].pageCount} selected
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                    {Array.from({ length: perFileSettings[activeGalleryIdx].pageCount }, (_, i) => i + 1).map((pNum) => {
                      const isIncluded = perFileSettings[activeGalleryIdx].selectedPages.includes(pNum);
                      const isCurrentViewing = activeDocPageNum === pNum;
                      return (
                        <button
                          key={pNum}
                          type="button"
                          onClick={() => toggleFilePage(activeGalleryIdx, pNum)}
                          className={`w-8 h-8 rounded-xl font-mono text-xs font-bold transition-all ${
                            isIncluded
                              ? 'bg-blue-600 text-white shadow-sm scale-105 border border-blue-600'
                              : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                          } ${isCurrentViewing ? 'ring-2 ring-blue-400' : ''}`}
                        >
                          {pNum}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Demo Info Cards */}
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] text-slate-500 font-bold uppercase">Color Mode</p>
                <p className="text-xs font-black text-slate-900 mt-0.5">{colorMode === 'BW' ? 'Black & White' : 'Color'}</p>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] text-slate-500 font-bold uppercase">Total Sheets</p>
                <p className="text-xs font-black text-slate-900 mt-0.5">{sides === 'DOUBLE' ? Math.ceil((totalCalculatedPages * copies) / 2) : totalCalculatedPages * copies} sheets</p>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] text-slate-500 font-bold uppercase">Live Total</p>
                <p className="text-xs font-black text-blue-700 mt-0.5">₹{calculateDynamicTotal()}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* ════════════════════════════════════════════════ */}
        {/* STEP 1: CHOOSE PRINTING LOCATION & KIOSK */}
        {/* ════════════════════════════════════════════════ */}
        {step === 'kiosk' && (
          <motion.div
            key="kiosk"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
            className="flex-1 flex flex-col space-y-4 my-auto"
          >
            <div>
              <span className="text-xs font-black text-blue-700 bg-blue-100 px-3.5 py-1 rounded-full uppercase tracking-wider inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-blue-600" />
                <span>Step 1: Choose Station</span>
              </span>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 mt-2 mb-1 tracking-tight">
                Where will you pick up?
              </h1>
              <p className="text-slate-600 text-xs md:text-sm font-medium">
                Choose a specific station location or select Universal Pickup to print anywhere
              </p>
            </div>

            {/* 🔍 Search Input Bar */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={kioskSearch}
                onChange={(e) => setKioskSearch(e.target.value)}
                placeholder="Search by campus, building, room or kiosk ID..."
                className="w-full pl-10 pr-9 py-3 bg-white border-2 border-slate-200 rounded-2xl text-xs md:text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
              {kioskSearch && (
                <button
                  type="button"
                  onClick={() => setKioskSearch('')}
                  className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-[10px] font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Stations List Container */}
            <div className="space-y-3 overflow-y-auto max-h-[380px] pr-1 scrollbar-thin">
              {/* Option 1: Universal Pickup */}
              <motion.div
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => {
                  playKeySound('tap');
                  setAnyKiosk(true);
                  setSelectedKiosk(null);
                }}
                className={`w-full p-4 md:p-5 rounded-2xl border-2 transition-all cursor-pointer text-left space-y-2 ${
                  anyKiosk
                    ? 'border-blue-600 bg-blue-50/70 shadow-md shadow-blue-500/10'
                    : 'border-slate-200 bg-white hover:border-blue-300 shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      anyKiosk ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-600'
                    }`}>
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-black text-slate-900 text-sm md:text-base">Any Available Kiosk</h4>
                        <span className="text-[10px] font-black uppercase text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                          Universal
                        </span>
                      </div>
                      <p className="text-slate-500 text-xs font-medium">Walk up to any active Print Bro kiosk and enter code</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    anyKiosk ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                  }`}>
                    {anyKiosk && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              </motion.div>

              {/* Physical Kiosks from Fleet */}
              {kiosks
                .filter((k) => {
                  if (!kioskSearch.trim()) return true;
                  const q = kioskSearch.toLowerCase();
                  return (
                    k.name?.toLowerCase().includes(q) ||
                    k.location?.toLowerCase().includes(q) ||
                    k.displayId?.toLowerCase().includes(q)
                  );
                })
                .map((kiosk) => {
                  const isSelected = !anyKiosk && (selectedKiosk === kiosk.displayId || selectedKiosk === kiosk.id);
                  const isOnline = kiosk.status === 'ACTIVE';

                  return (
                    <motion.div
                      key={kiosk.id || kiosk.displayId}
                      whileHover={isOnline ? { scale: 1.01 } : {}}
                      whileTap={isOnline ? { scale: 0.99 } : {}}
                      onClick={() => {
                        if (!isOnline) return;
                        playKeySound('tap');
                        setAnyKiosk(false);
                        setSelectedKiosk(kiosk.displayId);
                      }}
                      className={`w-full p-4 rounded-2xl border-2 transition-all text-left space-y-2 ${
                        !isOnline
                          ? 'border-amber-200 bg-amber-50/40 opacity-70 cursor-not-allowed'
                          : isSelected
                          ? 'border-blue-600 bg-blue-50/70 shadow-md shadow-blue-500/10 cursor-pointer'
                          : 'border-slate-200 bg-white hover:border-blue-300 shadow-sm cursor-pointer'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isSelected ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-600'
                          }`}>
                            <MapPin className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-black text-slate-900 text-sm md:text-base leading-tight">
                                {kiosk.name}
                              </h4>
                              <span className="font-mono text-[10px] font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                                {kiosk.displayId}
                              </span>
                            </div>
                            <p className="text-slate-600 text-xs font-bold mt-0.5 flex items-center gap-1">
                              <span>📍 {kiosk.location}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                            isOnline
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                            <span>{isOnline ? 'Ready' : 'Maintenance'}</span>
                          </span>

                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}

              {kiosks.length > 0 && kiosks.filter(k => {
                if (!kioskSearch.trim()) return true;
                const q = kioskSearch.toLowerCase();
                return k.name?.toLowerCase().includes(q) || k.location?.toLowerCase().includes(q) || k.displayId?.toLowerCase().includes(q);
              }).length === 0 && (
                <div className="p-6 rounded-2xl bg-white border border-slate-200 text-center space-y-1">
                  <p className="font-black text-slate-700 text-xs">No matching stations found</p>
                  <p className="text-slate-400 text-xs">Try searching for a different building, campus, or room name.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* STEP 5: SUMMARY & PROCEED TO PAYMENT */}
        {/* ════════════════════════════════════════════════ */}
        {step === 'summary' && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
            className="flex-1 flex flex-col space-y-4 my-2"
          >
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Order Summary</h1>
              <p className="text-slate-600 text-xs md:text-sm font-medium mt-0.5">Review your print configuration and proceed to payment</p>
            </div>

            <div className="p-5 space-y-3.5 flex-1 rounded-3xl border border-slate-200 bg-white shadow-lg shadow-blue-500/5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Total Documents</span>
                <span className="text-slate-900 font-black">{perFileSettings.length} files combined</span>
              </div>
              <div className="h-px bg-slate-100" />
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Total Selected Pages</span>
                <span className="text-slate-900 font-bold">{totalCalculatedPages} pages</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Orientation</span>
                <span className="text-slate-900 font-bold">{orientation === 'PORTRAIT' ? 'Portrait (Vertical)' : 'Landscape (Horizontal)'}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Copies</span>
                <span className="text-slate-900 font-bold">{copies}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Total Pages Printed</span>
                <span className="text-blue-700 font-black">{totalCalculatedPages * copies} pages</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Color Mode</span>
                <span className="text-slate-900 font-bold">{colorMode === 'BW' ? `Black & White (₹${pricingRules.BW}/pg)` : `Color (₹${pricingRules.COLOR}/pg)`}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Sides</span>
                <span className="text-slate-900 font-bold">{sides === 'SINGLE' ? 'Single Side' : 'Double Side (Duplex)'}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Pickup Station</span>
                <span className="text-slate-900 font-bold text-right">
                  {anyKiosk
                    ? 'Any Available Print Bro Kiosk'
                    : `${kiosks.find((k) => k.displayId === selectedKiosk)?.name || selectedKiosk} (${kiosks.find((k) => k.displayId === selectedKiosk)?.location || selectedKiosk})`}
                </span>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex justify-between items-baseline pt-2">
                <span className="text-slate-900 font-black text-lg">Total Amount</span>
                <span className="text-3xl md:text-4xl font-black text-blue-700 font-display">
                  ₹{calculateDynamicTotal()}
                </span>
              </div>
            </div>

            {error && <p className="mt-2 text-rose-600 text-sm font-bold text-center bg-rose-50 border border-rose-200 p-3 rounded-xl">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🌟 Curvey & Lifted Bottom Action Button Area */}
      <div className="pt-4 pb-2">
        {step === 'kiosk' && (
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => {
              playKeySound('tap');
              setStep('upload');
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-[20px] font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all"
          >
            Confirm Location & Upload Files <ArrowRight className="w-4 h-4" />
          </motion.button>
        )}

        {step === 'upload' && fileInfo && (
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => {
              playKeySound('tap');
              setStep('settings');
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-[20px] font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all"
          >
            Configure Print Settings <ArrowRight className="w-4 h-4" />
          </motion.button>
        )}

        {step === 'settings' && (
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => {
              playKeySound('tap');
              setStep('demo');
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-[20px] font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all"
          >
            Preview Live Gallery Demo <Eye className="w-4 h-4" />
          </motion.button>
        )}

        {step === 'demo' && (
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => {
              playKeySound('tap');
              setStep('summary');
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-[20px] font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all"
          >
            Review Order Summary <ArrowRight className="w-4 h-4" />
          </motion.button>
        )}

        {step === 'summary' && (
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={handleCreateJob}
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-[20px] font-black text-base md:text-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {loading ? 'Creating Order...' : `PAY ₹${calculateDynamicTotal()} & GET CODE`}
          </motion.button>
        )}
      </div>
    </div>
  );
}

export default function RemotePrintPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fbff]">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-3" />
          <p className="text-slate-700 font-black text-sm">Loading Print Setup...</p>
        </div>
      }
    >
      <RemotePrintContent />
    </Suspense>
  );
}
