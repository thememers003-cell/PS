// ============================================================
// XPOS Printer — Native Windows Printer Service
// Uses pdf-to-printer for direct, silent hardware printing
// ============================================================

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  PrinterInfo,
  PrinterStatus,
  PrintJobRequest,
  PrintJobResult,
  PrintJobProgress,
} from '@xpos/types';
import type { PrinterService } from './index';

const execAsync = promisify(exec);

export class WindowsPrinterService extends EventEmitter implements PrinterService {
  private defaultPrinterName: string | null = null;
  private activeJobs = new Map<string, PrintJobProgress>();
  private jobCounter = 0;

  constructor(defaultPrinterName?: string) {
    super();
    this.defaultPrinterName = defaultPrinterName || process.env.WINDOWS_PRINTER_NAME || null;
  }

  /**
   * Get list of physical & virtual printers installed on Windows.
   * Uses Windows Registry (100% reliable, never blocked by CIM/WMI policies)
   */
  async getPrinters(): Promise<PrinterInfo[]> {
    try {
      const { stdout: regOut } = await execAsync('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices"');
      const lines = regOut.split(/\r?\n/).filter(line => line.includes('REG_SZ'));

      let defaultPrinterName = '';
      try {
        const { stdout: defOut } = await execAsync('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows" /v Device');
        const match = defOut.match(/Device\s+REG_SZ\s+([^,]+)/);
        if (match && match[1]) {
          defaultPrinterName = match[1].trim();
        }
      } catch {}

      if (lines.length > 0) {
        const printers: PrinterInfo[] = [];
        for (const line of lines) {
          const match = line.trim().match(/^([^\t]+|\S.*?)\s+REG_SZ/);
          if (match && match[1]) {
            const name = match[1].trim();
            printers.push({
              id: name,
              name,
              isDefault: defaultPrinterName ? name.toLowerCase() === defaultPrinterName.toLowerCase() : false,
              status: 'READY' as PrinterStatus,
              model: name,
            });
          }
        }

        if (printers.length > 0) {
          // If no default matched or default is generic/virtual, identify primary physical printer
          const physicalPrinter = printers.find(p =>
            !p.name.includes('PDF') &&
            !p.name.includes('XPS') &&
            !p.name.includes('OneNote') &&
            !p.name.includes('Fax') &&
            !p.name.includes('Generic') &&
            !p.name.includes('OrCAD')
          );
          if (physicalPrinter && (!defaultPrinterName || defaultPrinterName.includes('Generic'))) {
            printers.forEach(p => { p.isDefault = false; });
            physicalPrinter.isDefault = true;
          } else if (!printers.some(p => p.isDefault)) {
            printers[0].isDefault = true;
          }
          return printers;
        }
      }
    } catch (regErr) {
      console.warn('⚠️ Registry printer detection fallback, trying pdf-to-printer:', regErr);
    }

    // Secondary fallback: pdf-to-printer library
    try {
      const ptpModule = await import('pdf-to-printer');
      const ptp = (ptpModule as any).default || ptpModule;
      const printers = await ptp.getPrinters();
      const defaultP = await ptp.getDefaultPrinter();

      return printers.map((p: any) => ({
        id: p.name,
        name: p.name,
        isDefault: p.name === defaultP?.name,
        status: 'READY' as PrinterStatus,
        model: p.name,
      }));
    } catch (err) {
      console.warn('⚠️ pdf-to-printer getPrinters failed, trying PowerShell:', err);
      try {
        const { stdout } = await execAsync('powershell -Command "Get-Printer | Select-Object -ExpandProperty Name"');
        const lines = stdout.split('\r\n').map(l => l.trim()).filter(Boolean);
        return lines.map((name, i) => ({
          id: name,
          name,
          isDefault: i === 0,
          status: 'READY' as PrinterStatus,
          model: name,
        }));
      } catch {
        return [{ id: 'auto-printer', name: 'Auto-Detected Printer', isDefault: true, status: 'READY' }];
      }
    }
  }

  async getDefaultPrinter(): Promise<PrinterInfo | null> {
    const printers = await this.getPrinters();
    const targetName = process.env.WINDOWS_PRINTER_NAME || this.defaultPrinterName;
    if (targetName && targetName.trim().length > 0 && targetName.toLowerCase() !== 'auto') {
      const match = printers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase()));
      if (match) return match;
    }

    // Dynamic auto-detection: pick first real physical hardware printer installed in Windows
    const physical = printers.find(p =>
      !p.name.includes('PDF') &&
      !p.name.includes('XPS') &&
      !p.name.includes('OneNote') &&
      !p.name.includes('Fax') &&
      !p.name.includes('Generic') &&
      !p.name.includes('OrCAD')
    );
    if (physical) return physical;

    // Check system default printer
    const defaultP = printers.find(p => p.isDefault);
    if (defaultP) return defaultP;

    return printers[0] || null;
  }

  async getPrinterStatus(printerId?: string): Promise<PrinterStatus> {
    return 'READY';
  }

  /**
   * Submit print job directly to Windows printer hardware
   */
  async submitPrintJob(job: PrintJobRequest): Promise<PrintJobResult> {
    const jobId = `win_print_${++this.jobCounter}`;
    const installedPrinters = await this.getPrinters();
    
    // Resolve target printer: if job requested dummy "Default Printer" or "Detecting", pick real detected physical printer
    let targetPrinter = job.printerName;
    if (
      !targetPrinter ||
      targetPrinter.toLowerCase().includes('default printer') ||
      targetPrinter.toLowerCase().includes('detecting')
    ) {
      targetPrinter = (await this.getDefaultPrinter())?.name || undefined;
    } else {
      // Validate that targetPrinter exists in installed printers, or match by substring
      const matched = installedPrinters.find(p => p.name.toLowerCase().includes(targetPrinter!.toLowerCase()));
      if (matched) {
        targetPrinter = matched.name;
      } else {
        console.warn(`⚠️ Target printer "${targetPrinter}" not matched to installed devices. Falling back to default printer.`);
        targetPrinter = (await this.getDefaultPrinter())?.name || undefined;
      }
    }

    console.log(`🖨️ [WindowsPrinterService] Printing "${job.filePath}" to printer: "${targetPrinter}"...`);

    if (!fs.existsSync(job.filePath)) {
      return { jobId, status: 'FAILED', error: `File not found: ${job.filePath}` };
    }

    const totalPages = (job.totalPages && job.totalPages > 0) ? job.totalPages : 1;
    const totalPrintPages = totalPages * (job.copies || 1);

    const progress: PrintJobProgress = {
      jobId,
      status: 'PRINTING',
      currentPage: 1,
      totalPages: totalPrintPages,
    };
    this.activeJobs.set(jobId, progress);
    this.emit('progress', { ...progress });

    // Locate bundled SumatraPDF binary across root and workspace dirs
    const candidates = [
      'C:\\Users\\ADMIN\\Desktop\\OU  - XPOS\\node_modules\\pdf-to-printer\\dist\\SumatraPDF-3.4.6-32.exe',
      path.join(process.cwd(), 'node_modules/pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe'),
      path.join(process.cwd(), '../node_modules/pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe'),
      path.join(process.cwd(), '../../node_modules/pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe'),
      path.join(__dirname, '../../node_modules/pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe'),
      path.join(__dirname, '../../../node_modules/pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe'),
    ];
    const sumatraPdfPath = candidates.find(c => fs.existsSync(c)) || undefined;

    // Execute physical hardware print in background
    (async () => {
      try {
        const ptp = await import('pdf-to-printer');
        
        const printOptions: any = {};
        if (targetPrinter) {
          printOptions.printer = targetPrinter;
        }
        if (sumatraPdfPath) {
          printOptions.sumatraPdfPath = sumatraPdfPath;
        }
        if (job.copies && job.copies > 1) {
          printOptions.copies = job.copies;
        }
        if (job.pageRange) {
          printOptions.pages = job.pageRange;
        }
        if (job.sides === 'DOUBLE') {
          printOptions.side = 'duplex';
        }
        if ((job as any).orientation === 'LANDSCAPE') {
          printOptions.orientation = 'landscape';
        }

        console.log(`🖨️ [WindowsPrinterService] Sending physical print job with options:`, printOptions);
        await ptp.print(job.filePath, printOptions);

        console.log(`✅ [WindowsPrinterService] Successfully sent job ${jobId} to physical hardware printer "${targetPrinter}"!`);

        // Emit real progress completion
        progress.currentPage = totalPrintPages;
        progress.status = 'READY';
        this.emit('progress', { ...progress });
        this.emit('completed', { jobId, status: 'READY', currentPage: totalPrintPages, totalPages: totalPrintPages });
        this.activeJobs.delete(jobId);
      } catch (err: any) {
        console.error(`❌ [WindowsPrinterService] SumatraPDF module printing error on printer "${targetPrinter}":`, err);

        // Fallback 1: Direct silent CLI execution of SumatraPDF.exe (bypasses module and PowerShell CLR)
        try {
          if (sumatraPdfPath && fs.existsSync(sumatraPdfPath)) {
            console.log(`🔄 Attempting direct SumatraPDF CLI print to "${targetPrinter}"...`);
            const copiesSetting = (job.copies && job.copies > 1) ? `-print-settings "${job.copies}x"` : '';
            const cliCmd = `"${sumatraPdfPath}" -print-to "${targetPrinter}" ${copiesSetting} -silent "${job.filePath}"`;
            await execAsync(cliCmd);
            console.log(`✅ [WindowsPrinterService] Direct SumatraPDF CLI printed successfully to "${targetPrinter}"!`);

            progress.currentPage = totalPrintPages;
            this.emit('completed', { jobId, status: 'READY', currentPage: totalPrintPages, totalPages: totalPrintPages });
            this.activeJobs.delete(jobId);
            return;
          }
        } catch (cliErr: any) {
          console.warn(`Direct SumatraPDF CLI fallback error:`, cliErr);
        }

        // Fallback 2: Native Windows print command
        try {
          console.log(`🔄 Attempting native Windows print fallback for printer "${targetPrinter}"...`);
          const nativeCmd = `cmd.exe /c print /D:"${targetPrinter}" "${job.filePath}"`;
          await execAsync(nativeCmd);
          console.log(`✅ [WindowsPrinterService] Native print fallback sent to "${targetPrinter}"!`);

          progress.currentPage = totalPrintPages;
          this.emit('completed', { jobId, status: 'READY', currentPage: totalPrintPages, totalPages: totalPrintPages });
          this.activeJobs.delete(jobId);
        } catch (fallbackErr: any) {
          console.error(`❌ Native print fallback also failed:`, fallbackErr);
          this.emit('failed', { jobId, status: 'FAILED', error: fallbackErr?.message || err?.message || 'Physical print failed' });
          this.activeJobs.delete(jobId);
        }
      }
    })();

    return { jobId, status: 'SUBMITTED' };
  }

  async cancelPrintJob(jobId: string): Promise<void> {
    this.activeJobs.delete(jobId);
    this.emit('cancelled', { jobId });
  }

  async getPrintJobStatus(jobId: string): Promise<PrintJobProgress | null> {
    return this.activeJobs.get(jobId) || null;
  }
}
