import { processOneJob } from "./processor";

/**
 * Prepress Worker Poller
 * 
 * Polling loop that continuously processes queued jobs.
 */

const DEFAULT_POLL_INTERVAL_MS = parseInt(process.env.PREPRESS_WORKER_POLL_INTERVAL_MS || '10000');
const DEFAULT_CONCURRENCY = parseInt(process.env.PREPRESS_WORKER_CONCURRENCY || '1');

let isRunning = false;
let pollTimeout: NodeJS.Timeout | null = null;

/**
 * Start polling for jobs
 * 
 * @param options - Polling configuration
 */
export function startPolling(options: {
  pollIntervalMs?: number;
  concurrency?: number;
} = {}): void {
  if (isRunning) {
    console.log('[Prepress Poller] Already running');
    return;
  }
  
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  
  isRunning = true;
  console.log(`[Prepress Poller] Starting with interval=${pollIntervalMs}ms, concurrency=${concurrency}`);
  
  const poll = async () => {
    if (!isRunning) return;
    
    try {
      // Process up to 'concurrency' jobs in parallel
      const promises: Promise<boolean>[] = [];
      for (let i = 0; i < concurrency; i++) {
        promises.push(processOneJob());
      }
      
      const results = await Promise.all(promises);
      const processedCount = results.filter(r => r).length;
      
      if (processedCount > 0) {
        console.log(`[Prepress Poller] Processed ${processedCount} job(s)`);
      }
      
    } catch (error) {
      console.error('[Prepress Poller] Error during poll:', error);
    }
    
    // Schedule next poll
    if (isRunning) {
      pollTimeout = setTimeout(poll, pollIntervalMs);
    }
  };
  
  // Start polling immediately
  poll();
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (!isRunning) {
    console.log('[Prepress Poller] Not running');
    return;
  }
  
  console.log('[Prepress Poller] Stopping...');
  isRunning = false;
  
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
  
  console.log('[Prepress Poller] Stopped');
}

/**
 * Check if poller is running
 */
export function isPolling(): boolean {
  return isRunning;
}
