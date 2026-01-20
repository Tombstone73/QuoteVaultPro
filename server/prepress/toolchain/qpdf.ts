import { exec } from "child_process";
import { promisify } from "util";
import { writeFile as fsWriteFile } from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { PrepressIssue } from "../types";

const execAsync = promisify(exec);

/**
 * QPDF Wrapper
 * 
 * Performs sanity checks and basic validation on PDF files.
 * Timeout: configurable, default 180s
 */

const DEFAULT_TIMEOUT_MS = parseInt(process.env.PREPRESS_TOOL_TIMEOUT_MS || '180000');

export interface QPDFResult {
  valid: boolean;
  issues: PrepressIssue[];
}

/**
 * Run QPDF sanity check on a PDF
 * 
 * @param pdfBuffer - PDF file as Buffer
 * @returns Validation result with any issues found
 */
export async function runQPDF(pdfBuffer: Buffer): Promise<QPDFResult> {
  const result: QPDFResult = {
    valid: true,
    issues: [],
  };
  
  // Create temp file for qpdf to analyze
  const tempDir = os.tmpdir();
  const tempInput = path.join(tempDir, `qpdf-input-${Date.now()}.pdf`);
  
  try {
    await fsWriteFile(tempInput, pdfBuffer);
    
    // Run qpdf --check
    // This validates PDF structure and reports issues
    const { stdout, stderr } = await execAsync(
      `qpdf --check "${tempInput}"`,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for output
      }
    );
    
    // qpdf outputs warnings/errors to stderr even on success
    if (stderr) {
      const lines = stderr.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.toLowerCase().includes('error')) {
          result.valid = false;
          result.issues.push({
            severity: 'BLOCKER',
            code: 'QPDF_ERROR',
            message: line.trim(),
          });
        } else if (line.toLowerCase().includes('warning')) {
          result.issues.push({
            severity: 'WARNING',
            code: 'QPDF_WARNING',
            message: line.trim(),
          });
        }
      }
    }
    
    // Success message in stdout
    if (stdout && stdout.includes('No syntax or stream encoding errors')) {
      // PDF is structurally valid
    }
    
  } catch (error: any) {
    // qpdf failed to process the file
    result.valid = false;
    result.issues.push({
      severity: 'BLOCKER',
      code: 'QPDF_FAILED',
      message: `QPDF validation failed: ${error.message}`,
      meta: { stderr: error.stderr },
    });
  } finally {
    // Clean up temp file
    try {
      const fs = await import('fs/promises');
      await fs.unlink(tempInput);
    } catch {
      // Ignore cleanup errors
    }
  }
  
  return result;
}
