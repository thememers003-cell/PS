// ============================================================
// API Client — Centralized API calls for the customer app
// ============================================================

export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    if (hostname.includes('loca.lt')) {
      return 'https://xpos-api-cloud.loca.lt';
    }
    // Only use local port 4000 if explicitly on a private LAN IP (e.g. 192.168.x.x or 10.x.x.x)
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname)) {
      return `http://${hostname}:4000`;
    }
    // All public domains (riseupsolutions.in, vercel.app, onrender.com) connect to Render cloud API
    return process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const baseUrl = getApiUrl();
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        ...options.headers,
      },
    });

    const json = await res.json();
    return json;
  } catch (error) {
    console.error(`API Error [${path}]:`, error);
    return { success: false, error: 'Network error. Please check Wi-Fi connection.' };
  }
}

// ── Sessions ──
export async function createSession(kioskId?: string, printMethod?: string) {
  return apiRequest<any>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ kioskId, printMethod }),
  });
}

// ── Kiosks ──
export async function getKiosks() {
  return apiRequest<any[]>('/api/kiosks');
}

export async function getKiosk(kioskId: string) {
  return apiRequest<any>(`/api/kiosks/${kioskId}`);
}

export async function getKioskQR(kioskId: string) {
  return apiRequest<any>(`/api/kiosks/${kioskId}/qr`);
}

// ── Files with Real-time Progress Tracking ──
export function uploadFile(
  sessionId: string,
  files: File | File[],
  onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void
): Promise<{ success: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    const formData = new FormData();
    const fileArray = Array.isArray(files) ? files : [files];
    fileArray.forEach((f) => formData.append('files', f));
    formData.append('sessionId', sessionId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getApiUrl()}/api/files/upload`, true);
    xhr.setRequestHeader('Bypass-Tunnel-Reminder', 'true');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent, e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        resolve(json);
      } catch {
        resolve({ success: false, error: 'Invalid server response' });
      }
    };

    xhr.onerror = () => {
      resolve({ success: false, error: 'Network upload error' });
    };

    xhr.send(formData);
  });
}
export const uploadFiles = uploadFile;

export async function getFilePreview(fileId: string) {
  return apiRequest<any>(`/api/files/${fileId}/preview`);
}

// ── Pricing ──
export async function getPricing() {
  return apiRequest<any[]>('/api/pricing');
}

export async function calculatePrice(data: {
  fileId: string;
  colorMode: string;
  paperSize: string;
  sides: string;
  copies: number;
  pageRange?: string;
}) {
  return apiRequest<any>('/api/pricing/calculate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Jobs ──
export async function createJob(data: any) {
  return apiRequest<any>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getJob(jobId: string) {
  return apiRequest<any>(`/api/jobs/${jobId}`);
}

// ── Payments ──
export async function createPayment(jobId: string) {
  const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/code` : undefined;
  return apiRequest<any>('/api/payments/create', {
    method: 'POST',
    body: JSON.stringify({ jobId, redirectUrl }),
  });
}

export async function verifyPayment(paymentId: string, orderId: string, paymentData: any = {}) {
  return apiRequest<any>('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify({ paymentId, orderId, paymentData }),
  });
}

// ── Print Codes ──
export async function generatePrintCode(jobId: string, allowedKioskId?: string) {
  return apiRequest<any>('/api/print-codes/generate', {
    method: 'POST',
    body: JSON.stringify({ jobId, allowedKioskId }),
  });
}

export async function verifyPrintCode(code: string, kioskId: string) {
  return apiRequest<any>('/api/print-codes/verify', {
    method: 'POST',
    body: JSON.stringify({ code, kioskId }),
  });
}

export async function pairKioskWithCode(data: {
  code?: string;
  kioskId: string;
  pairToken?: string;
  jobId?: string;
}) {
  return apiRequest<any>('/api/print-codes/pair-kiosk', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Admin ──
export async function getDashboard() {
  return apiRequest<any>('/api/admin/dashboard');
}

export async function getAdminJobs(params?: Record<string, string>) {
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiRequest<any>(`/api/admin/jobs${query}`);
}
