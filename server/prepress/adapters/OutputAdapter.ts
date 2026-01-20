import { writeFile, getJobPaths } from "../storage";

/**
 * Output Adapter Interface
 * 
 * Abstracts where prepress jobs store output files.
 * Current: temp dir for download
 * Future: signed PUT URLs to TitanOS storage
 */
export interface OutputAdapter {
  /**
   * Store output file for a job
   * @param jobId - Job identifier
   * @param kind - Output type (proof_png, fixed_pdf, report_json)
   * @param buffer - File content as Buffer
   * @throws Error if output cannot be stored
   */
  storeOutput(jobId: string, kind: OutputKind, buffer: Buffer): Promise<void>;
}

export type OutputKind = 'proof_png' | 'fixed_pdf' | 'report_json';

/**
 * Local Output Adapter
 * 
 * Writes outputs to temp directory for download via API.
 * Path: {tempRoot}/{jobId}/output/{filename}
 * 
 * Files are retained until expiresAt, then deleted by TTL cleanup.
 */
export class LocalOutputAdapter implements OutputAdapter {
  async storeOutput(jobId: string, kind: OutputKind, buffer: Buffer): Promise<void> {
    const paths = getJobPaths(jobId);
    
    let targetPath: string;
    switch (kind) {
      case 'proof_png':
        targetPath = paths.proofPng;
        break;
      case 'fixed_pdf':
        targetPath = paths.fixedPdf;
        break;
      case 'report_json':
        targetPath = paths.reportJson;
        break;
      default:
        throw new Error(`Unknown output kind: ${kind}`);
    }
    
    await writeFile(targetPath, buffer);
  }
}

/**
 * Signed URL Output Adapter (Future)
 * 
 * Uploads outputs to signed PUT URLs provided by TitanOS.
 * Not implemented yet - placeholder for future integration.
 */
export class SignedUrlOutputAdapter implements OutputAdapter {
  async storeOutput(jobId: string, kind: OutputKind, buffer: Buffer): Promise<void> {
    // Future implementation:
    // 1. Look up signed PUT URL for this output kind from job metadata
    // 2. Upload via HTTP PUT
    // 3. Verify upload success
    throw new Error("SignedUrlOutputAdapter not yet implemented");
  }
}

/**
 * Create default output adapter
 * Currently always returns LocalOutputAdapter
 * Future: may select based on job config or env
 */
export function createOutputAdapter(): OutputAdapter {
  return new LocalOutputAdapter();
}
