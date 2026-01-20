import { readFile, getJobPaths, fileExists } from "../storage";

/**
 * Input Adapter Interface
 * 
 * Abstracts how prepress jobs fetch PDF inputs.
 * Current: upload to temp dir
 * Future: signed GET URLs from TitanOS
 */
export interface InputAdapter {
  /**
   * Fetch input PDF for a job
   * @param jobId - Job identifier
   * @returns PDF file as Buffer
   * @throws Error if input cannot be fetched
   */
  fetchInput(jobId: string): Promise<Buffer>;
}

/**
 * Upload Input Adapter
 * 
 * Reads PDF from temp directory where API uploaded it.
 * Path: {tempRoot}/{jobId}/input.pdf
 */
export class UploadInputAdapter implements InputAdapter {
  async fetchInput(jobId: string): Promise<Buffer> {
    const paths = getJobPaths(jobId);
    
    const exists = await fileExists(paths.inputFile);
    if (!exists) {
      throw new Error(`Input file not found for job ${jobId} at ${paths.inputFile}`);
    }
    
    return await readFile(paths.inputFile);
  }
}

/**
 * Signed URL Input Adapter (Future)
 * 
 * Fetches PDF from a signed GET URL provided by TitanOS.
 * Not implemented yet - placeholder for future integration.
 */
export class SignedUrlInputAdapter implements InputAdapter {
  async fetchInput(jobId: string): Promise<Buffer> {
    // Future implementation:
    // 1. Look up signed URL from job metadata
    // 2. Fetch via HTTP GET
    // 3. Stream to buffer
    // 4. Return buffer
    throw new Error("SignedUrlInputAdapter not yet implemented");
  }
}

/**
 * Create default input adapter
 * Currently always returns UploadInputAdapter
 * Future: may select based on job config or env
 */
export function createInputAdapter(): InputAdapter {
  return new UploadInputAdapter();
}
