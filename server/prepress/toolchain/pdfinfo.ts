import { exec } from "child_process";
import { promisify } from "util";
import { writeFile as fsWriteFile } from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { PageSize, PrepressIssue } from "../types";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = parseInt(process.env.PREPRESS_TOOL_TIMEOUT_MS || '180000');

/**
 * PDFInfo Wrapper
 * 
 * Extracts metadata from PDF files using poppler-utils pdfinfo.
 */

export interface PDFInfoResult {
  pageCount: number;
  pageSizes: PageSize[];
  issues: PrepressIssue[];
}

/**
 * Run pdfinfo to extract metadata
 */
export async function runPDFInfo(pdfBuffer: Buffer): Promise<PDFInfoResult> {
  const tempDir = os.tmpdir();
  const tempInput = path.join(tempDir, `pdfinfo-input-${Date.now()}.pdf`);
  
  try {
    await fsWriteFile(tempInput, pdfBuffer);
    
    const { stdout } = await execAsync(
      `pdfinfo "${tempInput}"`,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
      }
    );
    
    const lines = stdout.split('\n');
    let pageCount = 0;
    const pageSizes: PageSize[] = [];
    const issues: PrepressIssue[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Extract page count
      if (trimmed.startsWith('Pages:')) {
        const match = trimmed.match(/Pages:\s+(\d+)/);
        if (match) {
          pageCount = parseInt(match[1], 10);
        }
      }
      
      // Extract page size (format: "Page size: 612 x 792 pts (letter)")
      if (trimmed.startsWith('Page size:')) {
        const match = trimmed.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/);
        if (match) {
          pageSizes.push({
            width: parseFloat(match[1]),
            height: parseFloat(match[2]),
            unit: 'pt',
          });
        }
      }
    }
    
    // If no page size info, all pages assumed same size
    // pdfinfo only shows size if all pages are uniform
    
    return {
      pageCount,
      pageSizes,
      issues,
    };
    
  } catch (error: any) {
    return {
      pageCount: 0,
      pageSizes: [],
      issues: [{
        severity: 'WARNING',
        code: 'PDFINFO_FAILED',
        message: `pdfinfo failed: ${error.message}`,
      }],
    };
  } finally {
    try {
      const fs = await import('fs/promises');
      await fs.unlink(tempInput);
    } catch {
      // Ignore
    }
  }
}

/**
 * PDFFonts Wrapper
 * 
 * Analyzes font embedding in PDF files.
 */

export interface PDFFontsResult {
  allEmbedded: boolean;
  issues: PrepressIssue[];
}

/**
 * Run pdffonts to check font embedding
 */
export async function runPDFFonts(pdfBuffer: Buffer): Promise<PDFFontsResult> {
  const tempDir = os.tmpdir();
  const tempInput = path.join(tempDir, `pdffonts-input-${Date.now()}.pdf`);
  
  try {
    await fsWriteFile(tempInput, pdfBuffer);
    
    const { stdout } = await execAsync(
      `pdffonts "${tempInput}"`,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
      }
    );
    
    const lines = stdout.split('\n').filter(l => l.trim());
    const issues: PrepressIssue[] = [];
    let allEmbedded = true;
    
    // Skip header lines
    const fontLines = lines.slice(2);
    
    for (const line of fontLines) {
      if (!line.trim()) continue;
      
      // pdffonts output columns include "emb" which is "yes" if embedded
      // Format varies, but typically has columns like: name type emb sub uni object ID
      const parts = line.split(/\s+/);
      
      // Look for "no" in the embedding column (typically column index 3-5)
      if (line.toLowerCase().includes(' no ')) {
        allEmbedded = false;
        const fontName = parts[0] || 'Unknown font';
        issues.push({
          severity: 'WARNING',
          code: 'FONT_NOT_EMBEDDED',
          message: `Font not fully embedded: ${fontName}`,
          meta: { fontName },
        });
      }
    }
    
    return {
      allEmbedded,
      issues,
    };
    
  } catch (error: any) {
    return {
      allEmbedded: false,
      issues: [{
        severity: 'WARNING',
        code: 'PDFFONTS_FAILED',
        message: `pdffonts failed: ${error.message}`,
      }],
    };
  } finally {
    try {
      const fs = await import('fs/promises');
      await fs.unlink(tempInput);
    } catch {
      // Ignore
    }
  }
}
