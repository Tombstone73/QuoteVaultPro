/**
 * QuickBooks Sync Job Processor
 * Background worker that polls accounting_sync_jobs table and executes pending jobs
 */

import { db } from '../db';
import { accountingSyncJobs } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import * as qbService from '../quickbooksService';
import { getWorkerIntervalOverride, logWorkerTick } from './workerGates';

// Track if worker is running to prevent multiple instances
let isRunning = false;
let workerInterval: NodeJS.Timeout | null = null;

// Configuration
// Production: 30s, Non-production: 5min (to prevent Neon compute burn)
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_NON_PROD_POLL_INTERVAL_MS = 300_000;
const MAX_RETRIES = 3;

function getPollIntervalMs(): number {
  return getWorkerIntervalOverride(
    'QB_SYNC',
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_NON_PROD_POLL_INTERVAL_MS
  );
}

/**
 * Process a single sync job based on resource type and direction
 */
async function processSyncJob(job: any): Promise<void> {
  console.log(`[Sync Worker] Processing job ${job.id}: ${job.direction} ${job.resourceType}`);

  try {
    // Route to appropriate processor based on resource type and direction
    if (job.resourceType === 'customers') {
      if (job.direction === 'pull') {
        await qbService.processPullCustomers(job.id);
      } else if (job.direction === 'push') {
        await qbService.processPushCustomers(job.id);
      }
    } else if (job.resourceType === 'invoices') {
      if (job.direction === 'pull') {
        await qbService.processPullInvoices(job.id);
      } else if (job.direction === 'push') {
        await qbService.processPushInvoices(job.id);
      }
    } else if (job.resourceType === 'orders') {
      if (job.direction === 'pull') {
        await qbService.processPullOrders(job.id);
      } else if (job.direction === 'push') {
        await qbService.processPushOrders(job.id);
      }
    } else {
      throw new Error(`Unknown resource type: ${job.resourceType}`);
    }

    console.log(`[Sync Worker] Job ${job.id} completed successfully`);
  } catch (error: any) {
    console.error(`[Sync Worker] Job ${job.id} failed:`, error);
    
    // Update job with error status (processor should have already done this, but as fallback)
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'error',
        error: error.message || 'Unknown error',
        updatedAt: new Date(),
      })
      .where(eq(accountingSyncJobs.id, job.id));
    
    throw error;
  }
}

/**
 * Poll for pending sync jobs and process them
 */
async function pollAndProcessJobs(): Promise<void> {
  if (isRunning) {
    console.log('[Sync Worker] Already processing jobs, skipping poll');
    return;
  }

  const startTime = Date.now();
  isRunning = true;
  let jobsProcessed = 0;

  try {
    // Fetch pending jobs
    const pendingJobs = await db
      .select()
      .from(accountingSyncJobs)
      .where(eq(accountingSyncJobs.status, 'pending'))
      .limit(10); // Process up to 10 jobs per poll

    if (pendingJobs.length === 0) {
      return;
    }

    console.log(`[Sync Worker] Found ${pendingJobs.length} pending job(s)`);

    // Process jobs sequentially to avoid overwhelming QB API
    for (const job of pendingJobs) {
      try {
        await processSyncJob(job);
        jobsProcessed++;
      } catch (error: any) {
        console.error(`[Sync Worker] Error processing job ${job.id}:`, error);
        // Continue with next job even if this one failed
      }
    }
  } catch (error: any) {
    console.error('[Sync Worker] Error in poll cycle:', error);
  } finally {
    isRunning = false;
    const duration = Date.now() - startTime;
    logWorkerTick('qb_sync', duration, jobsProcessed);
  }
}

/**
 * Start the background worker
 */
export function startSyncWorker(): void {
  if (workerInterval) {
    console.log('[Sync Worker] Worker already running');
    return;
  }

  const intervalMs = getPollIntervalMs();
  console.log(`[Sync Worker] Starting worker (poll interval: ${intervalMs}ms)`);

  // Run immediately on start
  pollAndProcessJobs().catch((error) => {
    console.error('[Sync Worker] Error in initial poll:', error);
  });

  // Then poll on interval
  workerInterval = setInterval(() => {
    pollAndProcessJobs().catch((error) => {
      console.error('[Sync Worker] Error in scheduled poll:', error);
    });
  }, intervalMs);

  console.log('[Sync Worker] Worker started successfully');
}

/**
 * Stop the background worker
 */
export function stopSyncWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[Sync Worker] Worker stopped');
  }
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  running: boolean;
  pollIntervalMs: number;
  isProcessing: boolean;
} {
  return {
    running: workerInterval !== null,
    pollIntervalMs: getPollIntervalMs(),
    isProcessing: isRunning,
  };
}

/**
 * Manually trigger job processing (useful for testing or manual triggers)
 */
export async function triggerJobProcessing(): Promise<void> {
  console.log('[Sync Worker] Manual trigger requested');
  await pollAndProcessJobs();
}
