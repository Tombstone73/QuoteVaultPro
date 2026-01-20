import { db } from "../../db";
import { prepressJobs } from "../schema";
import type { PrepressJob } from "../schema";
import { eq, sql } from "drizzle-orm";
import { runPreflightPipeline, buildReportSummary, buildOutputManifest } from "../pipeline";
import { cleanupScratchFiles } from "../storage";

/**
 * Prepress Job Processor
 * 
 * Core worker logic for processing prepress jobs.
 * Handles job claiming, pipeline execution, and completion.
 */

/**
 * Claim a queued job atomically
 * 
 * @returns Claimed job or null if no jobs available or already claimed
 */
export async function claimJob(): Promise<PrepressJob | null> {
  try {
    // Atomic UPDATE ... WHERE status='queued' ... RETURNING *
    // If no row is returned, the job was already claimed by another worker
    const [claimed] = await db
      .update(prepressJobs)
      .set({
        status: 'running',
        startedAt: new Date(),
        progressMessage: 'Processing...',
      })
      .where(eq(prepressJobs.status, 'queued'))
      .returning();
    
    if (!claimed) {
      return null; // No queued jobs available
    }
    
    console.log(`[Prepress Worker] Claimed job ${claimed.id}`);
    return claimed;
    
  } catch (error) {
    console.error('[Prepress Worker] Failed to claim job:', error);
    return null;
  }
}

/**
 * Process a claimed job
 * 
 * Runs the preflight pipeline and updates the job record with results.
 * 
 * @param job - Claimed job to process
 */
export async function processJob(job: PrepressJob): Promise<void> {
  try {
    console.log(`[Prepress Worker] Processing job ${job.id} (${job.mode})`);
    
    // Run preflight pipeline
    const report = await runPreflightPipeline(job);
    
    // Build summary and manifest
    const reportSummary = buildReportSummary(report);
    const outputManifest = buildOutputManifest(report);
    
    // Update job as succeeded
    await db
      .update(prepressJobs)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        reportSummary,
        outputManifest,
        progressMessage: 'Completed successfully',
      })
      .where(eq(prepressJobs.id, job.id));
    
    console.log(`[Prepress Worker] Job ${job.id} completed successfully. Score: ${reportSummary.score}`);
    
    // Clean up scratch files (keep outputs until TTL)
    await cleanupScratchFiles(job.id);
    
  } catch (error: any) {
    console.error(`[Prepress Worker] Job ${job.id} failed:`, error);
    
    // Update job as failed
    await db
      .update(prepressJobs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: {
          message: error.message,
          code: error.code || 'PROCESSING_ERROR',
          details: { stack: error.stack },
        },
        progressMessage: `Failed: ${error.message}`,
      })
      .where(eq(prepressJobs.id, job.id));
    
    // Still clean up scratch files even on failure
    try {
      await cleanupScratchFiles(job.id);
    } catch (cleanupError) {
      console.error(`[Prepress Worker] Failed to cleanup scratch files for job ${job.id}:`, cleanupError);
    }
  }
}

/**
 * Process one job (claim and execute)
 * 
 * @returns True if a job was processed, false if no jobs available
 */
export async function processOneJob(): Promise<boolean> {
  const job = await claimJob();
  
  if (!job) {
    return false; // No jobs available
  }
  
  await processJob(job);
  return true;
}
