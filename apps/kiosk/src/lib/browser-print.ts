// ============================================================
// XPOS Kiosk — Universal Browser Printing Pipeline
// Enables ANY PC with ANY printer to print directly from the web
// ============================================================

export interface PrintOptions {
  copies?: number;
  colorMode?: string;
  totalPages?: number;
}

/**
 * Triggers printing of a PDF document directly on the local PC.
 * Works seamlessly with:
 * - Chrome / Edge Kiosk Mode (--kiosk --kiosk-printing for 100% silent zero-click print)
 * - Standard web browser (opens print dialog automatically with local default printer)
 */
export async function triggerBrowserPrint(pdfUrl: string, options?: PrintOptions): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      console.log('🖨️ [BrowserPrint] Starting print stream from:', pdfUrl);

      // 1. Fetch file as Blob to bypass iframe CORS or file display security restrictions
      const response = await fetch(pdfUrl, {
        headers: { 'Accept': 'application/pdf' },
      });

      if (!response.ok) {
        console.error('❌ [BrowserPrint] Failed to download PDF stream:', response.status, response.statusText);
        // Fallback: Attempt opening URL directly
        fallbackWindowPrint(pdfUrl);
        return resolve(false);
      }

      const blob = await response.blob();
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(pdfBlob);

      // 2. Remove any pre-existing print frame
      const existingFrame = document.getElementById('xpos-print-frame');
      if (existingFrame) {
        existingFrame.remove();
      }

      // 3. Create hidden iframe for silent printing
      const printFrame = document.createElement('iframe');
      printFrame.id = 'xpos-print-frame';
      printFrame.style.position = 'fixed';
      printFrame.style.top = '-9999px';
      printFrame.style.left = '-9999px';
      printFrame.style.width = '1px';
      printFrame.style.height = '1px';
      printFrame.style.opacity = '0.01';
      printFrame.style.pointerEvents = 'none';
      printFrame.style.zIndex = '-9999';

      document.body.appendChild(printFrame);

      let printed = false;

      const executePrint = () => {
        if (printed) return;
        printed = true;

        try {
          if (printFrame.contentWindow) {
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
            console.log('✅ [BrowserPrint] Print command sent to local PC printer successfully!');
            resolve(true);
          } else {
            throw new Error('printFrame.contentWindow unavailable');
          }
        } catch (printErr) {
          console.warn('⚠️ [BrowserPrint] Direct iframe print failed, trying window fallback:', printErr);
          fallbackWindowPrint(blobUrl);
          resolve(true);
        }

        // Cleanup blob URL after printing is queued
        setTimeout(() => {
          try {
            URL.revokeObjectURL(blobUrl);
            printFrame.remove();
          } catch {}
        }, 30000);
      };

      printFrame.onload = () => {
        // Short delay to ensure PDF rendering engine is initialized
        setTimeout(executePrint, 600);
      };

      printFrame.src = blobUrl;

      // Timeout fallback in case iframe onload does not fire
      setTimeout(() => {
        if (!printed) {
          console.log('⏱️ [BrowserPrint] Onload timeout reached, triggering print directly');
          executePrint();
        }
      }, 2500);

    } catch (error) {
      console.error('❌ [BrowserPrint] Unexpected error during print pipeline:', error);
      fallbackWindowPrint(pdfUrl);
      resolve(false);
    }
  });
}

/**
 * Fallback to standard window printing if iframe is restricted
 */
function fallbackWindowPrint(url: string) {
  try {
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch {}
      };
    }
  } catch (err) {
    console.error('❌ [BrowserPrint] Window fallback failed:', err);
  }
}
