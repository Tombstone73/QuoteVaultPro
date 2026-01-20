import { db } from "../../db";
import { prepressJobs } from "../schema";
import { sql } from "drizzle-orm";
import { deleteJobDirectory } from "../storage";

/**
 * Prepress TTL Cleanup
 * 
 * Deletes expired jobs and their temp files.
 * Runs periodically to recover from crashes and enforce TTL.
 */

const DEFAULT_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_BATCH_SIZE = 100;

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Clean up expired jobs
 * 
 * Deletes both database records and temp directories for jobs past their expiresAt.
 * 
 * @returns Number of jobs cleaned up
 */
export async function cleanupExpiredJobs(): Promise<number> {
  try {
    // Find expired jobs
    const expiredJobs = await db
      .select()
      .from(prepressJobs)
      .where(sql`${prepressJobs.expiresAt} < NOW()`)
      .limit(CLEANUP_BATCH_SIZE);
    
    if (expiredJobs.length === 0) {
      return 0;
    }
    
    console.log(`[Prepress Cleanup] Found ${expiredJobs.length} expired job(s)`);
    
    let cleanedCount = 0;
    
    for (const job of expiredJobs) {
      try {
        // Delete temp directory
        await deleteJobDirectory(job.id);
        
        // Delete database record
        await db
          .delete(prepressJobs)
          .where(sql`${prepressJobs.id} = ${job.id}`);
        
        cleanedCount++;
        console.log(`[Prepress Cleanup] Deleted expired job ${job.id}`);
        
      } catch (error) {
        console.error(`[Prepress Cleanup] Failed to cleanup job ${job.id}:`, error);
        // Continue with next job
      }
    }
    
    return cleanedCount;
    
  } catch (error) {
    console.error('[Prepress Cleanup] Cleanup sweep failed:', error);
    return 0;
  }
}

/**
 * Start periodic cleanup
 * 
 * @param intervalMs - Interval between cleanup runs (default 30 minutes)
 */
export function startCleanup(intervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS): void {
  if (cleanupInterval) {
    console.log('[Prepress Cleanup] Already running');
    return;
  }
  
  console.log(`[Prepress Cleanup] Starting with interval=${intervalMs}ms (${intervalMs / 60000} minutes)`);
  
  // Run cleanup immediately
  cleanupExpiredJobs();
  
  // Then run periodically
  cleanupInterval = setInterval(async () => {
    const cleaned = await cleanupExpiredJobs();
    if (cleaned > 0) {
      console.log(`[Prepress Cleanup] Cleaned ${cleaned} expired job(s)`);
    }
  }, intervalMs);
}

/**
 * Stop periodic cleanup
 */
export function stopCleanup(): void {
  if (!cleanupInterval) {
    console.log('[Prepress Cleanup] Not running');
    return;
  }
  
  console.log('[Prepress Cleanup] Stopping...');
  clearInterval(cleanupInterval);
  cleanupInterval = null;
  console.log('[Prepress Cleanup] Stopped');
}
