'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Printer,
  DollarSign,
  FileText,
  RefreshCw,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  Plus,
  X,
  MapPin,
  Loader2,
  Trash2,
  Ban,
  RotateCcw,
  Sparkles,
  ShieldAlert,
  Download,
  Eye,
  Layers,
  FileCheck,
  Zap,
  Power,
  ChevronRight,
  TrendingUp,
  Activity,
  ArrowUpRight,
  Sliders,
  Edit3,
  Bell,
  Settings,
  Database,
  Cpu,
  Check,
  Copy,
  ExternalLink,
  Link as LinkIcon,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { getApiUrl } from '../lib/api';

interface KioskStatBreakdown {
  id: string;
  displayId: string;
  name: string;
  location: string;
  status: string;
  printerStatus: string;
  totalJobs: number;
  todayJobs: number;
  totalRevenue: number;
  todayRevenue: number;
  totalPages: number;
  bwPrice: number;
  colorPrice: number;
  isCustomPricing: boolean;
}

interface DashboardStats {
  today: {
    revenue: number;
    allTimeRevenue: number;
    printJobs: number;
    pages: number;
    successful: number;
    failed: number;
    cancelled: number;
    activeCodes: number;
  };
  kiosks: {
    total: number;
    online: number;
  };
  kioskBreakdown?: KioskStatBreakdown[];
}

interface PrintJob {
  id: string;
  displayId: string;
  jobNumber?: number;
  status: string;
  printMethod: string;
  colorMode: string;
  copies: number;
  totalPages: number;
  totalPrice: number;
  sides: string;
  printCode: string | null;
  printCodeStatus: string | null;
  printCodeExpiresAt: string | null;
  fileName: string;
  fileSize?: number;
  kioskId?: string | null;
  kioskDisplayId?: string | null;
  kioskName?: string;
  kioskLocation?: string;
  paymentStatus?: string;
  paymentAmount?: number;
  paymentOrderId?: string;
  createdAt: string;
  completedAt?: string;
}

interface KioskInfo {
  id: string;
  displayId: string;
  name: string;
  location: string;
  status: string;
  printerStatus: string;
  printerName: string;
  totalJobsServed: number;
  lastHeartbeat: string;
  isOnline: boolean;
  paperLevel: number;
  tonerLevel: number;
  cpu: number;
  ram: number;
  disk: number;
  appVersion: string;
  bwPrice?: number;
  colorPrice?: number;
  isCustomPricing?: boolean;
}

interface PricingRule {
  id?: string;
  paperSize: string;
  colorMode: string;
  pricePerPage: number;
  isActive: boolean;
}

export default function SuperAdminRootPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'jobs' | 'kiosks' | 'pricing' | 'logs'>('overview');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [kiosks, setKiosks] = useState<KioskInfo[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Real-time second clock for live countdowns
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [kioskFilter, setKioskFilter] = useState('ALL');
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals & Forms
  const [selectedJob, setSelectedJob] = useState<PrintJob | null>(null);
  const [showAddKioskModal, setShowAddKioskModal] = useState(false);
  const [newKioskDisplayId, setNewKioskDisplayId] = useState('');
  const [newKioskName, setNewKioskName] = useState('');
  const [newKioskLocation, setNewKioskLocation] = useState('');
  const [newKioskBwPrice, setNewKioskBwPrice] = useState<string>('');
  const [newKioskColorPrice, setNewKioskColorPrice] = useState<string>('');
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  // Dynamic Pricing State (Controlled Inputs)
  const [bwPrice, setBwPrice] = useState<number>(2);
  const [colorPrice, setColorPrice] = useState<number>(10);
  const [savingPrice, setSavingPrice] = useState(false);

  // Edit Kiosk Station Modal State
  const [editingKiosk, setEditingKiosk] = useState<KioskInfo | null>(null);
  const [editKioskName, setEditKioskName] = useState('');
  const [editKioskLocation, setEditKioskLocation] = useState('');
  const [editKioskPrinterName, setEditKioskPrinterName] = useState('');
  const [editKioskStatus, setEditKioskStatus] = useState('ACTIVE');
  const [editKioskBwPrice, setEditKioskBwPrice] = useState<string>('');
  const [editKioskColorPrice, setEditKioskColorPrice] = useState<string>('');

  const socketRef = useRef<Socket | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ type, text });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const getRemainingCountdown = (expiresAtStr: string | null) => {
    if (!expiresAtStr) return null;
    const diff = Math.floor((new Date(expiresAtStr).getTime() - now) / 1000);
    if (diff <= 0) return 'Expired';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s left`;
  };

  const fetchData = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const [statsRes, jobsRes, kiosksRes, pricingRes, logsRes] = await Promise.all([
        fetch(`${baseUrl}/api/admin/dashboard`).then(r => r.json()).catch(() => ({})),
        fetch(`${baseUrl}/api/admin/jobs?status=${statusFilter}&kioskId=${kioskFilter}&search=${encodeURIComponent(searchQuery)}`).then(r => r.json()).catch(() => ({})),
        fetch(`${baseUrl}/api/admin/kiosks`).then(r => r.json()).catch(() => ({})),
        fetch(`${baseUrl}/api/pricing`).then(r => r.json()).catch(() => ({})),
        fetch(`${baseUrl}/api/admin/audit-logs`).then(r => r.json()).catch(() => ({})),
      ]);

      if (statsRes.success) setStats(statsRes.data);
      if (jobsRes.success) setJobs(jobsRes.data?.jobs || []);
      if (kiosksRes.success) setKiosks(kiosksRes.data || []);
      if (pricingRes.success && Array.isArray(pricingRes.data)) {
        setPricingRules(pricingRes.data);
        const bw = pricingRes.data.find((r: any) => r.colorMode === 'BW');
        const clr = pricingRes.data.find((r: any) => r.colorMode === 'COLOR');
        if (bw && typeof bw.pricePerPage === 'number') setBwPrice(bw.pricePerPage);
        if (clr && typeof clr.pricePerPage === 'number') setColorPrice(clr.pricePerPage);
      }
      if (logsRes.success) setAuditLogs(logsRes.data || []);
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, kioskFilter]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const socket = io(getApiUrl(), { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsLiveConnected(true);
      socket.emit('join_admin');
    });

    socket.on('disconnect', () => setIsLiveConnected(false));
    socket.on('job_updated', () => fetchData());
    socket.on('job_update', () => fetchData());
    socket.on('new_job', () => fetchData());
    socket.on('payment_verified', () => fetchData());
    socket.on('kiosks_updated', () => fetchData());
    socket.on('kiosk_updated', () => fetchData());
    socket.on('pricing_updated', (data: any) => {
      if (data?.rules && Array.isArray(data.rules)) {
        setPricingRules(data.rules);
        const bw = data.rules.find((r: any) => r.colorMode === 'BW');
        const clr = data.rules.find((r: any) => r.colorMode === 'COLOR');
        if (bw) setBwPrice(bw.pricePerPage);
        if (clr) setColorPrice(clr.pricePerPage);
      }
      fetchData();
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchData]);

  // ── Action Handlers ──
  const handleCancelJob = async (jobId: string) => {
    if (!confirm('Cancel this print job and deactivate its 6-digit release code? The customer will be informed immediately.')) return;
    setActionLoading(jobId);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Job cancelled successfully');
        fetchData();
        setSelectedJob(null);
      } else {
        showToast(data.error || 'Failed to cancel job', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestoreJob = async (jobId: string, displayId: string) => {
    setActionLoading(`restore-${jobId}`);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/jobs/${jobId}/restore`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Job ${displayId} restored to active queue!`);
        fetchData();
        setSelectedJob(null);
      } else {
        showToast(data.error || 'Failed to restore job', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExtendCode = async (code: string) => {
    setActionLoading(code);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/codes/${code}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Code ${code} extended by +24 Hours`);
        fetchData();
      } else {
        showToast(data.error || 'Failed to extend code', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteJob = async (jobId: string, displayId: string) => {
    if (!confirm(`Are you sure you want to permanently delete job ${displayId}?`)) return;
    setActionLoading(`delete-${jobId}`);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/jobs/${jobId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`Job ${displayId} permanently deleted`);
        fetchData();
        setSelectedJob(null);
      } else {
        showToast(data.error || 'Failed to delete job', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleKioskStatus = async (kioskId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'MAINTENANCE' : 'ACTIVE';
    setActionLoading(kioskId);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/kiosks/${kioskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Kiosk status set to ${nextStatus}`);
        fetchData();
      } else {
        showToast(data.error || 'Failed to update kiosk status', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRebootKiosk = async (kioskId: string, displayId: string) => {
    if (!confirm(`Send remote reboot signal to Station ${displayId}?`)) return;
    setActionLoading(kioskId);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/kiosks/${kioskId}/reboot`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Reboot signal sent to Station ${displayId}`);
      } else {
        showToast(data.error || 'Failed to reboot kiosk', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const getKioskUrl = (displayId: string) => {
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    if (origin.includes(':3001')) {
      return origin.replace(':3001', ':3002') + `/?kiosk=${displayId}`;
    }
    return `${origin}/?kiosk=${displayId}`;
  };

  const handleCopyKioskLink = (displayId: string) => {
    const url = getKioskUrl(displayId);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      showToast(`Copied link for ${displayId}! Open on kiosk PC.`);
    } else {
      prompt('Copy kiosk link:', url);
    }
  };

  const handleDeleteKiosk = async (kioskId: string, displayId: string) => {
    if (!confirm(`Are you sure you want to delete Kiosk Station "${displayId}"?`)) return;
    setActionLoading(kioskId);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/kiosks/${kioskId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || `Kiosk ${displayId} deleted`);
        fetchData();
      } else {
        showToast(data.error || 'Failed to delete kiosk', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddKiosk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKioskDisplayId.trim()) return;
    setActionLoading('add-kiosk');
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/kiosks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayId: newKioskDisplayId.trim().toUpperCase(),
          name: newKioskName.trim() || `XPOS Station ${newKioskDisplayId.trim().toUpperCase()}`,
          location: newKioskLocation.trim() || 'Main Campus',
          bwPrice: newKioskBwPrice !== '' ? Number(newKioskBwPrice) : undefined,
          colorPrice: newKioskColorPrice !== '' ? Number(newKioskColorPrice) : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Kiosk ${newKioskDisplayId.toUpperCase()} registered!`);
        setShowAddKioskModal(false);
        setNewKioskDisplayId('');
        setNewKioskName('');
        setNewKioskLocation('');
        setNewKioskBwPrice('');
        setNewKioskColorPrice('');
        fetchData();
      } else {
        showToast(data.error || 'Failed to add kiosk', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenEditKiosk = (kiosk: KioskInfo) => {
    setEditingKiosk(kiosk);
    setEditKioskName(kiosk.name);
    setEditKioskLocation(kiosk.location);
    setEditKioskPrinterName(kiosk.printerName || 'Default Printer');
    setEditKioskStatus(kiosk.status);
    setEditKioskBwPrice(kiosk.bwPrice !== undefined ? String(kiosk.bwPrice) : '');
    setEditKioskColorPrice(kiosk.colorPrice !== undefined ? String(kiosk.colorPrice) : '');
  };

  const handleSaveEditKiosk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKiosk) return;
    setActionLoading(`edit-${editingKiosk.id}`);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/kiosks/${editingKiosk.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editKioskName.trim(),
          location: editKioskLocation.trim(),
          printerName: editKioskPrinterName.trim(),
          status: editKioskStatus,
          bwPrice: editKioskBwPrice !== '' ? Number(editKioskBwPrice) : null,
          colorPrice: editKioskColorPrice !== '' ? Number(editKioskColorPrice) : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Kiosk ${editingKiosk.displayId} configuration and pricing updated!`);
        setEditingKiosk(null);
        fetchData();
      } else {
        showToast(data.error || 'Failed to update kiosk', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdatePrice = async (paperSize: string, colorMode: string, newPrice: number) => {
    if (newPrice <= 0 || isNaN(newPrice)) {
      showToast('Price must be greater than ₹0', 'error');
      return;
    }
    setSavingPrice(true);
    if (colorMode === 'BW') setBwPrice(newPrice);
    if (colorMode === 'COLOR') setColorPrice(newPrice);

    try {
      const res = await fetch(`${getApiUrl()}/api/admin/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperSize, colorMode, pricePerPage: newPrice }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Dynamic pricing updated: ₹${newPrice}/page for ${colorMode === 'BW' ? 'Black & White' : 'Color'}`);
        fetchData();
      } else {
        showToast(data.error || 'Failed to update pricing', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setSavingPrice(false);
    }
  };

  const handleEmergencyFlush = async () => {
    setActionLoading('emergency-flush');
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/queue/flush`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'All print queues flushed!', 'success');
        setShowEmergencyModal(false);
        fetchData();
      } else {
        showToast(data.error || 'Failed to flush queue', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const exportJobsCSV = () => {
    if (jobs.length === 0) return;
    const headers = ['Display ID', 'Status', 'Kiosk Station', 'Kiosk Location', 'File Name', 'Pages', 'Price (INR)', 'Code', 'Created At', 'Completed At'];
    const rows = jobs.map(j => [
      j.displayId,
      j.status,
      `"${(j.kioskDisplayId || j.kioskName || 'Unassigned').replace(/"/g, '""')}"`,
      `"${(j.kioskLocation || 'N/A').replace(/"/g, '""')}"`,
      `"${j.fileName.replace(/"/g, '""')}"`,
      j.totalPages,
      j.totalPrice,
      j.printCode || 'N/A',
      j.createdAt,
      j.completedAt || 'In Queue',
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `XPOS_Jobs_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> COMPLETED</span>;
      case 'PRINTING':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-sky-50 text-sky-700 border border-sky-300 animate-pulse shadow-sm"><Printer className="w-3.5 h-3.5 text-sky-600" /> PRINTING</span>;
      case 'QUEUED':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-300 shadow-sm"><Clock className="w-3.5 h-3.5 text-amber-600" /> CODE ACTIVE</span>;
      case 'CANCELLED':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200"><Ban className="w-3.5 h-3.5 text-rose-500" /> CANCELLED</span>;
      case 'FAILED':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200"><XCircle className="w-3.5 h-3.5 text-rose-600" /> FAILED</span>;
      default:
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50/40 to-blue-50/30 text-slate-800 font-sans antialiased selection:bg-sky-500 selection:text-white flex">
      {/* ── DESKTOP SLEEK SIDEBAR ── */}
      <aside className="w-64 bg-white/80 backdrop-blur-2xl border-r border-sky-100/80 p-5 flex flex-col justify-between hidden lg:flex shrink-0 shadow-sm sticky top-0 h-screen z-30">
        <div className="space-y-6">
          {/* Logo & Brand Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <img src="/printbro_logo.png" alt="PrintBro" className="h-10 object-contain" />
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {[
              { id: 'overview', label: 'Dashboard Overview', icon: LayoutDashboard },
              { id: 'jobs', label: 'Live Print Queue & Codes', icon: Printer },
              { id: 'kiosks', label: 'Kiosk Fleet & Hardware', icon: Radio },
              { id: 'pricing', label: 'Pricing Matrix Engine', icon: DollarSign },
              { id: 'logs', label: 'Audit Trail & Telemetry', icon: Activity },
            ].map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-xs transition-all ${
                    isActive
                      ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-sky-50/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer / System Pulse */}
        <div className="bg-sky-50/70 border border-sky-100 p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-bold">Cloud WebSockets</span>
            <span className={`flex items-center gap-1.5 font-bold ${isLiveConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
              <span className={`w-2 h-2 rounded-full ${isLiveConnected ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'}`} />
              {isLiveConnected ? 'Online' : 'Connecting'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 font-medium truncate">
            Neon PostgreSQL Active
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT AREA (Spacious Desktop First) ── */}
      <div className="flex-1 flex flex-col min-w-0 pb-16">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-xl border-b border-sky-100/80 px-6 lg:px-10 py-4 flex items-center justify-between gap-4 shadow-sm">
          <div>
            <h1 className="text-xl font-black text-slate-900 capitalize tracking-tight">
              {activeTab === 'overview' && 'Executive Fleet Dashboard'}
              {activeTab === 'jobs' && 'Live Print Queue & 6-Digit Codes'}
              {activeTab === 'kiosks' && 'Kiosk Stations & Hardware Fleet'}
              {activeTab === 'pricing' && 'Dynamic Pricing Matrix'}
              {activeTab === 'logs' && 'Security & System Audit Trail'}
            </h1>
            <p className="text-xs text-slate-400">Live time synchronization with Render cloud backend</p>
          </div>

          <div className="flex items-center gap-3">
            {/* API Backend Switcher */}
            <button
              onClick={() => {
                const current = getApiUrl();
                const isCloud = current.includes('onrender.com');
                const next = isCloud ? 'http://localhost:4000' : 'https://xpos-printing-cloud.onrender.com';
                localStorage.setItem('xpos_admin_api', next);
                window.location.reload();
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white hover:bg-sky-50 text-slate-700 border border-sky-100 shadow-sm text-xs font-bold transition-all active:scale-95"
              title="Click to toggle between Render Cloud backend and Localhost:4000 backend"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${getApiUrl().includes('onrender.com') ? 'bg-sky-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span>{getApiUrl().includes('onrender.com') ? 'Cloud API' : 'Local API'}</span>
            </button>

            {/* Quick Refresh */}
            <button
              onClick={fetchData}
              className="p-2.5 rounded-2xl bg-white hover:bg-sky-50 text-slate-600 border border-sky-100 shadow-sm transition-all active:scale-95"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* Emergency Stop Button */}
            <button
              onClick={() => setShowEmergencyModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black transition-all active:scale-95 shadow-sm"
            >
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>EMERGENCY STOP</span>
            </button>
          </div>
        </header>

        {/* ── Toast Notification ── */}
        <AnimatePresence>
          {actionMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`fixed top-20 right-8 z-50 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border text-sm font-bold ${
                actionMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-rose-50 border-rose-300 text-rose-800'
              }`}
            >
              {actionMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-rose-600" />}
              <span>{actionMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Body */}
        <main className="p-6 lg:p-10 max-w-[1700px] w-full mx-auto space-y-8">
          {/* ── METRIC CARDS ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {/* Revenue */}
            <div className="bg-white border border-sky-100 p-6 rounded-3xl shadow-xl shadow-sky-950/5 relative overflow-hidden transition-all hover:border-sky-300">
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Today's Revenue</span>
                <div className="p-3 rounded-2xl bg-sky-50 text-sky-600 border border-sky-100">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900 mb-1">
                ₹{stats?.today.revenue || 0}
              </div>
              <div className="text-xs font-bold text-sky-600 flex items-center gap-1">
                <span>All-Time Total: ₹{stats?.today.allTimeRevenue || 0}</span>
              </div>
              <div className="absolute -bottom-8 -right-8 w-28 h-28 bg-sky-400/10 rounded-full blur-2xl pointer-events-none" />
            </div>

            {/* Active 6-Digit Codes */}
            <div className="bg-white border border-sky-100 p-6 rounded-3xl shadow-xl shadow-sky-950/5 relative overflow-hidden transition-all hover:border-sky-300">
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Active Release Codes</span>
                <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
              <div className="text-3xl font-black text-amber-600 mb-1">
                {stats?.today.activeCodes || 0} <span className="text-sm font-bold text-slate-400">Ready</span>
              </div>
              <div className="text-xs font-medium text-slate-400">Active 24h validity for kiosk pickup</div>
              <div className="absolute -bottom-8 -right-8 w-28 h-28 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />
            </div>

            {/* Total Prints Delivered */}
            <div className="bg-white border border-sky-100 p-6 rounded-3xl shadow-xl shadow-sky-950/5 relative overflow-hidden transition-all hover:border-sky-300">
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Prints Delivered</span>
                <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                  <FileCheck className="w-5 h-5" />
                </div>
              </div>
              <div className="text-3xl font-black text-emerald-600 mb-1">
                {stats?.today.successful || 0} <span className="text-sm font-bold text-slate-400">({stats?.today.pages || 0} pgs)</span>
              </div>
              <div className="text-xs font-medium text-slate-400">{stats?.today.printJobs || 0} total jobs submitted today</div>
              <div className="absolute -bottom-8 -right-8 w-28 h-28 bg-emerald-400/10 rounded-full blur-2xl pointer-events-none" />
            </div>

            {/* Active Kiosks */}
            <div className="bg-white border border-sky-100 p-6 rounded-3xl shadow-xl shadow-sky-950/5 relative overflow-hidden transition-all hover:border-sky-300">
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Kiosk Stations Fleet</span>
                <div className="p-3 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
                  <Radio className="w-5 h-5" />
                </div>
              </div>
              <div className="text-3xl font-black text-blue-600 mb-1">
                {kiosks.filter(k => k.status === 'ACTIVE').length} / {kiosks.length}
              </div>
              <div className="text-xs font-medium text-slate-400">Hardware Touchpoints Active</div>
              <div className="absolute -bottom-8 -right-8 w-28 h-28 bg-blue-400/10 rounded-full blur-2xl pointer-events-none" />
            </div>
          </div>

          {/* ── REVENUE PER KIOSK BREAKDOWN SECTION (Executive Fleet Dashboard) ── */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-600" />
                    <span>Revenue Per Kiosk Station</span>
                  </h2>
                  <p className="text-xs text-slate-400">Real-time revenue, print volume, and dynamic rate engine per station</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">Filter View:</span>
                  <select
                    value={kioskFilter}
                    onChange={(e) => setKioskFilter(e.target.value)}
                    className="text-xs font-bold bg-white border border-sky-200 rounded-xl px-3 py-1.5 text-slate-700 shadow-sm focus:outline-none focus:border-sky-500"
                  >
                    <option value="ALL">All Stations Combined ({stats?.kioskBreakdown?.length || kiosks.length})</option>
                    {(stats?.kioskBreakdown || kiosks).map((k: any) => (
                      <option key={k.id} value={k.displayId}>
                        {k.displayId} - {k.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(stats?.kioskBreakdown || []).map((k) => (
                  <div
                    key={k.id}
                    className={`bg-white border rounded-3xl p-5 space-y-4 shadow-lg shadow-sky-950/5 transition-all hover:border-sky-300 ${
                      kioskFilter === k.displayId ? 'ring-2 ring-sky-500 border-sky-400' : 'border-sky-100'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-slate-900 text-base">{k.displayId}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                            k.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {k.status}
                          </span>
                          {k.isCustomPricing && (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                              Custom Rates
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">{k.name} • {k.location}</p>
                      </div>
                      <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                        <DollarSign className="w-5 h-5" />
                      </div>
                    </div>

                    {/* Revenue Figures */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Today's Revenue</span>
                        <span className="text-lg font-black text-emerald-600">₹{k.todayRevenue}</span>
                        <span className="text-[11px] text-slate-400 block font-medium">{k.todayJobs} prints today</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Earnings</span>
                        <span className="text-lg font-black text-slate-900">₹{k.totalRevenue}</span>
                        <span className="text-[11px] text-slate-400 block font-medium">{k.totalJobs} jobs ({k.totalPages} pgs)</span>
                      </div>
                    </div>

                    {/* Station Pricing & Quick Filter */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                      <div className="font-mono font-bold text-slate-600">
                        <span className="text-[10px] uppercase text-slate-400 font-bold block">Current Station Rate</span>
                        B&W ₹{k.bwPrice}/pg • Color ₹{k.colorPrice}/pg
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            const targetKiosk = kiosks.find(x => x.id === k.id || x.displayId === k.displayId);
                            if (targetKiosk) handleOpenEditKiosk(targetKiosk);
                          }}
                          className="px-2.5 py-1 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 font-bold text-[11px] transition-all"
                        >
                          Set Price
                        </button>
                        <button
                          onClick={() => setKioskFilter(kioskFilter === k.displayId ? 'ALL' : k.displayId)}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all ${
                            kioskFilter === k.displayId
                              ? 'bg-sky-500 text-white border-sky-600 shadow-sm'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {kioskFilter === k.displayId ? 'Active Filter' : 'Filter Prints'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB 1 & 2: JOBS & CODES MANAGEMENT ── */}
          {(activeTab === 'overview' || activeTab === 'jobs') && (
            <div className="space-y-4">
              {/* Action Toolbar */}
              <div className="bg-white border border-sky-100 p-4 rounded-3xl shadow-sm flex flex-wrap items-center justify-between gap-4">
                <div className="relative flex-1 min-w-[280px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by Job ID (XP-000001), Document Name, or 6-Digit Code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs md:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:bg-white transition-all"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-400">Filter:</span>
                  {['ALL', 'QUEUED', 'PRINTING', 'COMPLETED', 'CANCELLED'].map(st => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
                        statusFilter === st
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {st}
                    </button>
                  ))}

                  {/* Kiosk Dropdown Filter */}
                  <select
                    value={kioskFilter}
                    onChange={(e) => setKioskFilter(e.target.value)}
                    className="text-xs font-bold bg-white border border-sky-200 rounded-xl px-3 py-1.5 text-slate-700 shadow-sm focus:outline-none focus:border-sky-500 ml-1"
                  >
                    <option value="ALL">All Stations</option>
                    {kiosks.map(k => (
                      <option key={k.id} value={k.displayId}>{k.displayId} ({k.name})</option>
                    ))}
                  </select>

                  <button
                    onClick={exportJobsCSV}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-sky-50 text-slate-700 border border-sky-200 rounded-xl text-xs font-bold transition-all ml-2 active:scale-95 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-sky-600" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-sky-100 rounded-3xl overflow-hidden shadow-xl shadow-sky-950/5">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs md:text-sm">
                    <thead className="bg-sky-50/60 text-slate-600 font-bold border-b border-sky-100 text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="p-4">Job ID / File</th>
                        <th className="p-4">6-Digit Code & Expiry</th>
                        <th className="p-4">Specs & Amount</th>
                        <th className="p-4">Printed At / Station</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Exact Timeline</th>
                        <th className="p-4 text-right">Super Admin Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sky-100/80">
                      {loading ? (
                        <tr>
                          <td colSpan={7} className="p-12 text-center text-slate-400">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-sky-500 mb-2" />
                            <span>Loading print queue & live codes...</span>
                          </td>
                        </tr>
                      ) : jobs.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-12 text-center text-slate-400">
                            No print jobs found matching filters.
                          </td>
                        </tr>
                      ) : (
                        jobs.map(job => (
                          <tr key={job.id} className="hover:bg-sky-50/40 transition-colors">
                            {/* Job ID & File */}
                            <td className="p-4">
                              <div className="font-mono font-black text-slate-900 text-sm">{job.displayId}</div>
                              <div className="text-slate-500 text-xs truncate max-w-[200px] font-medium" title={job.fileName}>
                                {job.fileName}
                              </div>
                            </td>

                            {/* 6-Digit Code & Live Remaining Time */}
                            <td className="p-4">
                              {(() => {
                                const num = job.jobNumber || parseInt(String(job.displayId).replace(/\D/g, '')) || 100;
                                const fallbackCode = String(100000 + ((num * 104729) % 900000));
                                const displayCode = job.printCode || fallbackCode;
                                return (
                                  <div className="space-y-1">
                                    <span className="font-mono font-black text-base text-amber-700 bg-amber-50 px-3 py-1 rounded-xl border border-amber-200 shadow-sm inline-block">
                                      {displayCode}
                                    </span>
                                    {(job.status === 'QUEUED' || job.status === 'PAID' || job.status === 'CREATED') && (
                                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-600">
                                        <Clock className="w-3 h-3 text-sky-500" />
                                        <span>{getRemainingCountdown(job.printCodeExpiresAt) || '24h remaining'}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>

                            {/* Specs & Price */}
                            <td className="p-4">
                              <div className="font-black text-slate-900 text-sm">₹{job.totalPrice}</div>
                              <div className="text-slate-500 text-xs">{job.totalPages} pgs • {job.colorMode} ({job.copies} copy)</div>
                            </td>

                            {/* Station / Kiosk Where Print Is Taken */}
                            <td className="p-4">
                              {job.kioskDisplayId || job.kioskName ? (
                                <div>
                                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                    <MapPin className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                    <span className="font-mono font-black text-slate-900">{job.kioskDisplayId || job.kioskName}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-400 truncate max-w-[130px]">
                                    {job.kioskLocation || 'Campus Hub'}
                                  </div>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200">
                                  <Clock className="w-3 h-3 text-amber-500" />
                                  {job.status === 'COMPLETED' ? 'Web Direct' : 'Pending Pickup'}
                                </span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="p-4">
                              {getStatusBadge(job.status)}
                            </td>

                            {/* Exact Timeline (Created & Completed Timestamps) */}
                            <td className="p-4 text-xs font-mono space-y-1">
                              <div className="text-slate-700">
                                <span className="text-slate-400 font-bold uppercase text-[10px]">Created: </span>
                                {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ({new Date(job.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                              </div>
                              {job.completedAt ? (
                                <div className="text-emerald-700 font-bold">
                                  <span className="text-emerald-500 font-bold uppercase text-[10px]">Printed: </span>
                                  {new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </div>
                              ) : (
                                <div className="text-slate-400 italic text-[11px]">
                                  {job.status === 'CANCELLED' ? 'Deactivated' : 'In Queue / Awaiting Kiosk'}
                                </div>
                              )}
                            </td>

                            {/* Actions Column with Restore, Cancel, Extend, Delete */}
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Inspect */}
                                <button
                                  onClick={() => setSelectedJob(job)}
                                  className="p-2 rounded-xl bg-slate-100 hover:bg-sky-100 text-sky-700 transition-all shadow-sm"
                                  title="Inspect Job Details"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>

                                {/* 🔄 Restore / Reactivate Cancelled Job */}
                                {job.status === 'CANCELLED' && (
                                  <button
                                    onClick={() => handleRestoreJob(job.id, job.displayId)}
                                    disabled={actionLoading === `restore-${job.id}`}
                                    className="p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-all active:scale-95 shadow-sm"
                                    title="Restore / Reactivate Job & Code"
                                  >
                                    {actionLoading === `restore-${job.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                  </button>
                                )}

                                {/* ⏳ Extend 6-digit Code (+24 Hours) */}
                                {job.printCode && (job.status === 'QUEUED' || job.status === 'PAID') && (
                                  <button
                                    onClick={() => handleExtendCode(job.printCode!)}
                                    disabled={actionLoading === job.printCode}
                                    className="p-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-all active:scale-95 shadow-sm"
                                    title="Add +24 Hours to Code"
                                  >
                                    <Clock className="w-4 h-4" />
                                  </button>
                                )}

                                {/* 🚫 Stop / Cancel Active Job */}
                                {job.status !== 'COMPLETED' && job.status !== 'CANCELLED' && (
                                  <button
                                    onClick={() => handleCancelJob(job.id)}
                                    disabled={actionLoading === job.id}
                                    className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-all active:scale-95 shadow-sm"
                                    title="Stop & Cancel Job (Informs Customer)"
                                  >
                                    {actionLoading === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                                  </button>
                                )}

                                {/* 🗑️ Permanent Delete Option */}
                                <button
                                  onClick={() => handleDeleteJob(job.id, job.displayId)}
                                  disabled={actionLoading === `delete-${job.id}`}
                                  className="p-2 rounded-xl bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-700 transition-all active:scale-95 shadow-sm"
                                  title="Delete Record Permanently"
                                >
                                  {actionLoading === `delete-${job.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 3: KIOSK FLEET MANAGEMENT ── */}
          {activeTab === 'kiosks' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Kiosk Stations & Hardware Fleet</h2>
                  <p className="text-slate-400 text-xs">Monitor paper trays, toner cartridges, printer hardware, and station pricing</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Live Dynamic Pricing Matrix Pill */}
                  <div className="flex items-center gap-2.5 bg-sky-50 border border-sky-200 px-4 py-2 rounded-2xl text-xs shadow-xs">
                    <span className="font-extrabold text-sky-900 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-sky-600 animate-pulse" /> Live Pricing:
                    </span>
                    <span className="bg-white border border-sky-200 px-2.5 py-0.5 rounded-lg font-black text-slate-800">
                      B&W ₹{bwPrice}/pg
                    </span>
                    <span className="bg-white border border-sky-200 px-2.5 py-0.5 rounded-lg font-black text-slate-800">
                      Color ₹{colorPrice}/pg
                    </span>
                    <button
                      onClick={() => setActiveTab('pricing')}
                      className="text-sky-600 hover:text-sky-800 font-bold underline ml-1"
                    >
                      Update
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      const nextNum = kiosks.length + 1;
                      const padded = nextNum < 10 ? `00${nextNum}` : nextNum < 100 ? `0${nextNum}` : `${nextNum}`;
                      setNewKioskDisplayId(`XPOS-${padded}`);
                      setNewKioskName(`Station ${nextNum} - Express Print`);
                      setNewKioskLocation('Main Campus');
                      setShowAddKioskModal(true);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-2xl font-bold text-xs md:text-sm shadow-lg shadow-sky-500/25 transition-all active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Register Kiosk Station</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {kiosks.map(kiosk => (
                  <div
                    key={kiosk.id}
                    className={`bg-white border rounded-3xl p-6 space-y-5 transition-all shadow-xl shadow-sky-950/5 ${
                      kiosk.status === 'ACTIVE' ? 'border-sky-100' : 'border-amber-300 bg-amber-50/20'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-slate-900">{kiosk.displayId}</h3>
                          <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${
                            kiosk.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {kiosk.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{kiosk.name} • {kiosk.location}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenEditKiosk(kiosk)}
                          className="p-2.5 rounded-2xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 transition-all active:scale-95"
                          title="Edit Station Details"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <div className="p-3 rounded-2xl bg-sky-50 text-sky-600 border border-sky-100">
                          <Printer className="w-6 h-6" />
                        </div>
                      </div>
                    </div>

                    {/* Dedicated Web Link Box */}
                    <div className="bg-sky-50/60 border border-sky-100 rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-extrabold text-sky-900 flex items-center gap-1.5">
                          <LinkIcon className="w-3.5 h-3.5 text-sky-600" /> Dedicated Web Link
                        </span>
                        <span className="text-[10px] font-mono font-bold text-sky-600 bg-white px-2 py-0.5 rounded-full border border-sky-200">
                          Live Endpoint
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={getKioskUrl(kiosk.displayId)}
                          className="w-full text-[11px] font-mono bg-white border border-sky-200 rounded-xl px-2.5 py-1.5 text-slate-700 truncate select-all focus:outline-none"
                        />
                        <button
                          onClick={() => handleCopyKioskLink(kiosk.displayId)}
                          className="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all active:scale-95 flex items-center gap-1 flex-shrink-0 shadow-sm"
                          title="Copy Link to Clipboard"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </button>
                        <a
                          href={getKioskUrl(kiosk.displayId)}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-xl bg-white hover:bg-sky-100 border border-sky-200 text-sky-700 transition-all active:scale-95 flex-shrink-0"
                          title="Launch Kiosk UI in New Tab"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>

                    {/* Station Live Rates Chip */}
                    <div className="flex items-center justify-between text-xs bg-slate-50 p-3 rounded-2xl border border-slate-100">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-slate-400 font-bold uppercase text-[10px]">Station Rates</span>
                          {kiosk.isCustomPricing ? (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">Custom</span>
                          ) : (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Global</span>
                          )}
                        </div>
                        <span className="font-mono font-black text-slate-800 text-sm">
                          B&W ₹{kiosk.bwPrice ?? bwPrice}/pg • Color ₹{kiosk.colorPrice ?? colorPrice}/pg
                        </span>
                      </div>
                      <button
                        onClick={() => handleOpenEditKiosk(kiosk)}
                        className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-sky-50 border border-sky-200 text-sky-700 text-xs font-bold transition-all shadow-xs"
                      >
                        Change Rate
                      </button>
                    </div>

                    {/* Printer Telemetry */}
                    <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <div>
                        <span className="text-slate-400 font-bold block text-[10px] uppercase">Printer Engine</span>
                        <span className="text-slate-800 font-black truncate block">{kiosk.printerName}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold block text-[10px] uppercase">Engine Status</span>
                        <span className="text-emerald-700 font-black flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> {kiosk.printerStatus}
                        </span>
                      </div>
                    </div>

                    {/* Gauges (Paper & Toner) */}
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs font-bold mb-1">
                          <span className="text-slate-500">Paper Tray</span>
                          <span className="text-sky-600">{kiosk.paperLevel}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-sky-500 rounded-full" style={{ width: `${kiosk.paperLevel}%` }} />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-bold mb-1">
                          <span className="text-slate-500">Toner Cartridge</span>
                          <span className="text-indigo-600">{kiosk.tonerLevel}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${kiosk.tonerLevel}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                      <button
                        onClick={() => handleToggleKioskStatus(kiosk.id, kiosk.status)}
                        disabled={actionLoading === kiosk.id}
                        className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm ${
                          kiosk.status === 'ACTIVE'
                            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{kiosk.status === 'ACTIVE' ? 'Set Maintenance' : 'Set Active'}</span>
                      </button>

                      <button
                        onClick={() => handleOpenEditKiosk(kiosk)}
                        className="p-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 transition-all active:scale-95 shadow-sm"
                        title="Edit Station Details"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleRebootKiosk(kiosk.id, kiosk.displayId)}
                        disabled={actionLoading === kiosk.id}
                        className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all active:scale-95 shadow-sm"
                        title="Remote Reboot"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDeleteKiosk(kiosk.id, kiosk.displayId)}
                        disabled={actionLoading === kiosk.id}
                        className="p-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-all active:scale-95 shadow-sm"
                        title="Delete Station"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB 4: DYNAMIC PRICING MATRIX ── */}
          {activeTab === 'pricing' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-white border border-sky-100 p-8 rounded-3xl space-y-6 shadow-xl shadow-sky-950/5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-xl font-black text-slate-900">Dynamic Pricing Matrix</h2>
                    <p className="text-slate-400 text-xs mt-1">
                      Set per-page printing fees. New prices apply immediately across all kiosks and customer mobile phones via real-time WebSocket.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Real-Time Sync Active</span>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Black & White A4 */}
                  <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-slate-800 text-white flex items-center justify-center font-black text-sm shadow-md">
                        B&W
                      </div>
                      <div>
                        <h4 className="font-black text-slate-900 text-base">Black & White (A4)</h4>
                        <p className="text-xs text-slate-400">Standard monochrome document print</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-slate-400">₹</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={bwPrice}
                        onChange={(e) => setBwPrice(Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdatePrice('A4', 'BW', bwPrice);
                        }}
                        className="w-24 bg-white border-2 border-sky-500 rounded-xl px-3 py-2 text-center text-lg font-black text-slate-900 focus:outline-none shadow-sm"
                      />
                      <span className="text-xs text-slate-400 font-bold">/ page</span>
                      <button
                        onClick={() => handleUpdatePrice('A4', 'BW', bwPrice)}
                        disabled={savingPrice}
                        className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
                      >
                        {savingPrice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        <span>Save</span>
                      </button>
                    </div>
                  </div>

                  {/* Color A4 */}
                  <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-sky-500 text-white flex items-center justify-center font-black text-sm shadow-md">
                        CLR
                      </div>
                      <div>
                        <h4 className="font-black text-slate-900 text-base">Full Color (A4)</h4>
                        <p className="text-xs text-slate-400">High-resolution vibrant color print</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-slate-400">₹</span>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={colorPrice}
                        onChange={(e) => setColorPrice(Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdatePrice('A4', 'COLOR', colorPrice);
                        }}
                        className="w-24 bg-white border-2 border-sky-500 rounded-xl px-3 py-2 text-center text-lg font-black text-slate-900 focus:outline-none shadow-sm"
                      />
                      <span className="text-xs text-slate-400 font-bold">/ page</span>
                      <button
                        onClick={() => handleUpdatePrice('A4', 'COLOR', colorPrice)}
                        disabled={savingPrice}
                        className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
                      >
                        {savingPrice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        <span>Save</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 5: AUDIT LOGS ── */}
          {activeTab === 'logs' && (
            <div className="bg-white border border-sky-100 rounded-3xl p-8 shadow-xl shadow-sky-950/5 space-y-4">
              <h2 className="text-lg font-black text-slate-900">System & Security Audit Trail</h2>
              <div className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <p className="text-slate-400 text-xs py-8 text-center">No recent audit events logged.</p>
                ) : (
                  auditLogs.map((log: any) => (
                    <div key={log.id} className="py-3.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-black text-sky-700 uppercase bg-sky-50 px-3 py-1 rounded-md border border-sky-200">
                          {log.action}
                        </span>
                        <span className="text-slate-700 font-semibold">{log.entityType} ({log.entityId || 'Global'})</span>
                      </div>
                      <span className="text-slate-400 font-mono">
                        {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── MODAL: INSPECT JOB DETAILS & REAL-TIME CONTROLS ── */}
      <AnimatePresence>
        {selectedJob && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-sky-100 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-black text-slate-900">{selectedJob.displayId}</h3>
                  <p className="text-xs text-slate-400">Detailed Print Job Telemetry & Timing</p>
                </div>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <span className="text-slate-400 font-bold">Document Name</span>
                  <span className="text-slate-900 font-black">{selectedJob.fileName}</span>
                </div>
                <div className="flex justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <span className="text-slate-400 font-bold">6-Digit Release Code</span>
                  <div className="text-right">
                    <span className="text-amber-700 font-mono font-black text-sm block">{selectedJob.printCode || 'None'}</span>
                    {(selectedJob.status === 'QUEUED' || selectedJob.status === 'PAID') && (
                      <span className="text-[11px] text-sky-600 font-bold">
                        {getRemainingCountdown(selectedJob.printCodeExpiresAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <span className="text-slate-400 font-bold">Created Timestamp</span>
                  <span className="text-slate-900 font-mono font-bold">
                    {new Date(selectedJob.createdAt).toLocaleString()}
                  </span>
                </div>
                {selectedJob.completedAt && (
                  <div className="flex justify-between bg-emerald-50 p-3.5 rounded-xl border border-emerald-100">
                    <span className="text-emerald-700 font-bold">Completed / Printed Timestamp</span>
                    <span className="text-emerald-950 font-mono font-bold">
                      {new Date(selectedJob.completedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <span className="text-slate-400 font-bold">Total Pages / Amount</span>
                  <span className="text-slate-900 font-bold">{selectedJob.totalPages} pages • ₹{selectedJob.totalPrice} ({selectedJob.paymentStatus || 'PAID'})</span>
                </div>
              </div>

              <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* 🔄 Restore / Reactivate Cancelled Job */}
                {selectedJob.status === 'CANCELLED' && (
                  <button
                    onClick={() => handleRestoreJob(selectedJob.id, selectedJob.displayId)}
                    className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-md shadow-emerald-500/20"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restore Job to Normal</span>
                  </button>
                )}

                {/* ⏳ Extend Code (+24h) */}
                {selectedJob.printCode && (selectedJob.status === 'QUEUED' || selectedJob.status === 'PAID') && (
                  <button
                    onClick={() => handleExtendCode(selectedJob.printCode!)}
                    className="py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-sm"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Extend Code (+24h)</span>
                  </button>
                )}

                {/* 🚫 Stop Job */}
                {selectedJob.status !== 'COMPLETED' && selectedJob.status !== 'CANCELLED' && (
                  <button
                    onClick={() => handleCancelJob(selectedJob.id)}
                    className="py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-rose-500/20"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Stop & Cancel Job</span>
                  </button>
                )}

                {/* 🗑️ Delete Record */}
                <button
                  onClick={() => handleDeleteJob(selectedJob.id, selectedJob.displayId)}
                  className="py-2.5 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Record</span>
                </button>

                <button
                  onClick={() => setSelectedJob(null)}
                  className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── MODAL: ADD KIOSK STATION ── */}
      <AnimatePresence>
        {showAddKioskModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-sky-100 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Register Kiosk Station</h3>
                  <p className="text-xs text-slate-400">Add physical touchpoint to cloud fleet</p>
                </div>
                <button
                  onClick={() => setShowAddKioskModal(false)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddKiosk} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Kiosk ID (e.g. XPOS-002)</label>
                  <input
                    type="text"
                    required
                    placeholder="XPOS-002"
                    value={newKioskDisplayId}
                    onChange={(e) => setNewKioskDisplayId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono font-bold focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Station Name</label>
                  <input
                    type="text"
                    placeholder="Library Lobby Kiosk"
                    value={newKioskName}
                    onChange={(e) => setNewKioskName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Physical Location</label>
                  <input
                    type="text"
                    placeholder="Building B, Floor 1"
                    value={newKioskLocation}
                    onChange={(e) => setNewKioskLocation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                {/* Per-Kiosk Custom Pricing */}
                <div className="bg-sky-50/70 border border-sky-200/80 rounded-2xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-800 font-bold flex items-center gap-1.5 text-xs">
                      <DollarSign className="w-3.5 h-3.5 text-sky-600" />
                      <span>Custom Kiosk Pricing (Optional)</span>
                    </label>
                    <span className="text-[10px] text-slate-400">Blank = Global Rates</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-500 font-bold mb-1 text-[11px]">B&W (₹/pg)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        placeholder={`Global: ₹${bwPrice}`}
                        value={newKioskBwPrice}
                        onChange={(e) => setNewKioskBwPrice(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 font-bold mb-1 text-[11px]">Color (₹/pg)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        placeholder={`Global: ₹${colorPrice}`}
                        value={newKioskColorPrice}
                        onChange={(e) => setNewKioskColorPrice(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    disabled={actionLoading === 'add-kiosk'}
                    className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-sky-500/20"
                  >
                    {actionLoading === 'add-kiosk' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>Save & Register Kiosk</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddKioskModal(false)}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── MODAL: EDIT KIOSK STATION ── */}
      <AnimatePresence>
        {editingKiosk && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-sky-100 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Edit Kiosk Station</h3>
                  <p className="text-xs text-slate-400">Update configuration for {editingKiosk.displayId}</p>
                </div>
                <button
                  onClick={() => setEditingKiosk(null)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEditKiosk} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Station ID (Fixed)</label>
                  <input
                    type="text"
                    disabled
                    value={editingKiosk.displayId}
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-500 font-mono font-bold cursor-not-allowed select-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Station Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Express Print Hub"
                    value={editKioskName}
                    onChange={(e) => setEditKioskName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Physical Location</label>
                  <input
                    type="text"
                    required
                    placeholder="Floor 1, West Wing"
                    value={editKioskLocation}
                    onChange={(e) => setEditKioskLocation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Hardware Printer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Epson L3250 Series or Auto"
                    value={editKioskPrinterName}
                    onChange={(e) => setEditKioskPrinterName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Operational Status</label>
                  <select
                    value={editKioskStatus}
                    onChange={(e) => setEditKioskStatus(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 font-bold focus:outline-none focus:border-sky-500 focus:bg-white"
                  >
                    <option value="ACTIVE">ACTIVE (Ready for customer prints)</option>
                    <option value="MAINTENANCE">MAINTENANCE (Temporarily paused)</option>
                    <option value="DISABLED">DISABLED (Offline / shutdown)</option>
                  </select>
                </div>

                {/* Per-Kiosk Custom Pricing */}
                <div className="bg-sky-50/70 border border-sky-200/80 rounded-2xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-800 font-bold flex items-center gap-1.5 text-xs">
                      <DollarSign className="w-3.5 h-3.5 text-sky-600" />
                      <span>Station Custom Pricing</span>
                    </label>
                    <span className="text-[10px] text-slate-400">Blank = Reset to Global</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-500 font-bold mb-1 text-[11px]">B&W (₹/pg)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        placeholder={`Global: ₹${bwPrice}`}
                        value={editKioskBwPrice}
                        onChange={(e) => setEditKioskBwPrice(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 font-bold mb-1 text-[11px]">Color (₹/pg)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        placeholder={`Global: ₹${colorPrice}`}
                        value={editKioskColorPrice}
                        onChange={(e) => setEditKioskColorPrice(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono font-bold focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    disabled={actionLoading === `edit-${editingKiosk.id}`}
                    className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-sky-500/20"
                  >
                    {actionLoading === `edit-${editingKiosk.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>Save Changes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingKiosk(null)}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── MODAL: EMERGENCY STOP & FLUSH QUEUE ── */}
      <AnimatePresence>
        {showEmergencyModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-rose-200 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-rose-700">EMERGENCY FLUSH</h3>
                  <p className="text-xs text-slate-400">Halt all active printing jobs immediately</p>
                </div>
              </div>

              <p className="text-slate-600 text-xs leading-relaxed">
                This will immediately cancel all queued and in-progress print jobs across all kiosks and invalidate all active release codes. Use in case of paper jams, hardware emergencies, or maintenance shutdowns.
              </p>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={handleEmergencyFlush}
                  disabled={actionLoading === 'emergency-flush'}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25"
                >
                  {actionLoading === 'emergency-flush' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  <span>CONFIRM FLUSH ALL JOBS</span>
                </button>
                <button
                  onClick={() => setShowEmergencyModal(false)}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
