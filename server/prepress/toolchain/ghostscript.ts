import { exec } from "child_process";
import { promisify } from "util";
import { writeFile as fsWriteFile, readFile as fsReadFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = parseInt(process.env.PREPRESS_TOOL_TIMEOUT_MS || '180000');

/**
 * Ghostscript Wrapper
 * 
 * Normalizes PDFs using Ghostscript's safe rewrite functionality.
 * This is the "safe auto-fix" for check_and_fix mode.
 */

/**
 * Normalize PDF via Ghostscript
 * 
 * Rewrites the PDF to fix common issues:
 * - Normalizes color spaces
 * - Re-embeds fonts if possible
 * - Fixes minor structural issues
 * - Optimizes file structure
 * 
 * @param pdfBuffer - Input PDF as Buffer
 * @returns Normalized PDF as Buffer
 */
export async function normalizeViaGhostscript(pdfBuffer: Buffer): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const tempInput = path.join(tempDir, `gs-input-${timestamp}.pdf`);
  const tempOutput = path.join(tempDir, `gs-output-${timestamp}.pdf`);
  
  try {
    // Write input file
    await fsWriteFile(tempInput, pdfBuffer);
    
    // Ghostscript command for safe normalization
    // -dPDFSETTINGS=/prepress: high quality for print
    // -dCompatibilityLevel=1.4: PDF 1.4 for broad compatibility
    // -dAutoRotatePages=/None: don't auto-rotate
    // -dColorConversionStrategy=/LeaveColorUnchanged: preserve color spaces
    // -dEmbedAllFonts=true: embed all fonts
    const gsCommand = [
      'gs',
      '-dSAFER', // Security: disable file system access
      '-dBATCH', // Exit after processing
      '-dNOPAUSE', // Don't pause between pages
      '-dQUIET', // Suppress info messages
      '-sDEVICE=pdfwrite', // Output device
      '-dPDFSETTINGS=/prepress', // High quality settings
      '-dCompatibilityLevel=1.4',
      '-dAutoRotatePages=/None',
      '-dColorConversionStrategy=/LeaveColorUnchanged',
      '-dEmbedAllFonts=true',
      `-sOutputFile="${tempOutput}"`,
      `"${tempInput}"`,
    ].join(' ');
    
    await execAsync(gsCommand, {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer (Ghostscript can be verbose)
    });
    
    // Read normalized output
    const normalizedBuffer = await fsReadFile(tempOutput);
    
    return normalizedBuffer;
    
  } finally {
    // Clean up temp files
    try {
      const fs = await import('fs/promises');
      await Promise.all([
        fs.unlink(tempInput).catch(() => {}),
        fs.unlink(tempOutput).catch(() => {}),
      ]);
    } catch {
      // Ignore cleanup errors
    }
  }
}
