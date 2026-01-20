import { exec } from "child_process";
import { promisify } from "util";
import { writeFile as fsWriteFile, readFile as fsReadFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = parseInt(process.env.PREPRESS_TOOL_TIMEOUT_MS || '180000');

/**
 * PDF Renderer Wrapper
 * 
 * Renders PDF pages to PNG images for proof/preview.
 * Uses pdftocairo (part of poppler-utils).
 */

export interface RenderOptions {
  page?: number; // Page number to render (1-indexed), default 1
  dpi?: number; // Resolution in DPI, default 150
  format?: 'png' | 'jpeg'; // Output format, default png
}

/**
 * Render PDF page to image
 * 
 * @param pdfBuffer - Input PDF as Buffer
 * @param options - Rendering options
 * @returns Rendered image as Buffer
 */
export async function renderProof(pdfBuffer: Buffer, options: RenderOptions = {}): Promise<Buffer> {
  const { page = 1, dpi = 150, format = 'png' } = options;
  
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const tempInput = path.join(tempDir, `render-input-${timestamp}.pdf`);
  const tempOutputBase = path.join(tempDir, `render-output-${timestamp}`);
  const tempOutput = `${tempOutputBase}.${format}`;
  
  try {
    // Write input file
    await fsWriteFile(tempInput, pdfBuffer);
    
    // pdftocairo command
    // -png or -jpeg: output format
    // -f <page>: first page to convert
    // -l <page>: last page to convert
    // -r <dpi>: resolution
    // -singlefile: output a single file (don't append page numbers)
    const formatFlag = format === 'jpeg' ? '-jpeg' : '-png';
    const pdfToCairoCommand = [
      'pdftocairo',
      formatFlag,
      `-f ${page}`, // First page
      `-l ${page}`, // Last page (same as first = single page)
      `-r ${dpi}`, // DPI
      '-singlefile', // Single output file
      `"${tempInput}"`,
      `"${tempOutputBase}"`,
    ].join(' ');
    
    await execAsync(pdfToCairoCommand, {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });
    
    // Read rendered output
    const renderedBuffer = await fsReadFile(tempOutput);
    
    return renderedBuffer;
    
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

/**
 * Render multiple pages to images
 * 
 * @param pdfBuffer - Input PDF as Buffer
 * @param pages - Array of page numbers to render (1-indexed)
 * @param options - Rendering options
 * @returns Array of rendered images as Buffers
 */
export async function renderPages(
  pdfBuffer: Buffer,
  pages: number[],
  options: Omit<RenderOptions, 'page'> = {}
): Promise<Buffer[]> {
  const results: Buffer[] = [];
  
  for (const page of pages) {
    const rendered = await renderProof(pdfBuffer, { ...options, page });
    results.push(rendered);
  }
  
  return results;
}
