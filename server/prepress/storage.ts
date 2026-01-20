import * as path from "path";
import * as fs from "fs/promises";
import type { PrepressPaths } from "./types";

/**
 * Prepress Temp File Storage
 * 
 * All file paths are derived from jobId + configured temp root.
 * NEVER store absolute paths in the database.
 * 
 * File lifecycle:
 * - Input: Written by API, read by Worker
 * - Scratch: Created and deleted immediately by Worker
 * - Output: Created by Worker, retained until expiresAt, then deleted by TTL cleanup
 */

/**
 * Get temp root directory from env or use default
 */
export function getTempRoot(): string {
  return process.env.PREPRESS_TEMP_DIR || path.join(process.cwd(), 'tmp', 'prepress');
}

/**
 * Get all paths for a job derived from jobId
 * NEVER store these paths in the database - always compute at runtime
 */
export function getJobPaths(jobId: string): PrepressPaths {
  const tempRoot = getTempRoot();
  const jobDir = path.join(tempRoot, jobId);
  const outputDir = path.join(jobDir, 'output');
  
  return {
    tempRoot,
    jobDir,
    inputFile: path.join(jobDir, 'input.pdf'),
    outputDir,
    reportJson: path.join(outputDir, 'report.json'),
    proofPng: path.join(outputDir, 'proof.png'),
    fixedPdf: path.join(outputDir, 'fixed.pdf'),
  };
}

/**
 * Ensure a directory exists, creating it recursively if needed
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write buffer to file, creating parent directories if needed
 */
export async function writeFile(filePath: string, buffer: Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, buffer);
}

/**
 * Read file as buffer
 */
export async function readFile(filePath: string): Promise<Buffer> {
  return await fs.readFile(filePath);
}

/**
 * Delete a file (no-op if doesn't exist)
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Delete entire job directory recursively
 * Used for cleanup after job completion or TTL expiration
 */
export async function deleteJobDirectory(jobId: string): Promise<void> {
  const paths = getJobPaths(jobId);
  try {
    await fs.rm(paths.jobDir, { recursive: true, force: true });
  } catch (error: any) {
    // Ignore if directory doesn't exist
    if (error.code !== 'ENOENT') {
      console.error(`[Prepress Storage] Failed to delete job directory ${jobId}:`, error);
    }
  }
}

/**
 * Delete scratch/intermediate files immediately after job completion
 * Retains only downloadable outputs in /output directory
 */
export async function cleanupScratchFiles(jobId: string): Promise<void> {
  const paths = getJobPaths(jobId);
  
  // Delete input file (no longer needed after processing)
  await deleteFile(paths.inputFile);
  
  // Any other scratch files would be deleted here
  // (currently we only have input.pdf as scratch)
}

/**
 * Create initial directory structure for a new job
 */
export async function initializeJobDirectory(jobId: string): Promise<void> {
  const paths = getJobPaths(jobId);
  await ensureDir(paths.jobDir);
  await ensureDir(paths.outputDir);
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}
