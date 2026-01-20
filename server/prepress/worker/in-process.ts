import { startPolling, stopPolling } from "./poller";
import { startCleanup, stopCleanup } from "./cleanup";

/**
 * In-Process Prepress Worker
 * 
 * Optional dev convenience mode that runs the worker in the same process as the API server.
 * Enabled via PREPRESS_WORKER_IN_PROCESS=true env var.
 * 
 * Primary/production mode should use the separate worker process (main.ts).
 */

const CLEANUP_INTERVAL_MS = parseInt(process.env.PREPRESS_CLEANUP_INTERVAL_MS || String(30 * 60 * 1000));

let isStarted = false;

/**
 * Start in-process worker
 */
export function startInProcessWorker(): void {
  if (isStarted) {
    console.log('[Prepress In-Process Worker] Already started');
    return;
  }
  
  console.log('[Prepress In-Process Worker] Starting (dev mode)...');
  
  // Start job polling
  startPolling();
  
  // Start TTL cleanup
  startCleanup(CLEANUP_INTERVAL_MS);
  
  isStarted = true;
  console.log('[Prepress In-Process Worker] Running');
}

/**
 * Stop in-process worker
 */
export function stopInProcessWorker(): void {
  if (!isStarted) {
    console.log('[Prepress In-Process Worker] Not running');
    return;
  }
  
  console.log('[Prepress In-Process Worker] Stopping...');
  
  stopPolling();
  stopCleanup();
  
  isStarted = false;
  console.log('[Prepress In-Process Worker] Stopped');
}

/**
 * Check if in-process worker should be enabled
 */
export function shouldStartInProcess(): boolean {
  const envValue = process.env.PREPRESS_WORKER_IN_PROCESS;
  return envValue === 'true' || envValue === '1';
}
