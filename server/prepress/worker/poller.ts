import { processOneJob } from "./processor";
import {
  createPrepressPoller,
  type PrepressPollerDrainResult,
} from "./pollerController";

/**
 * Prepress Worker Poller
 * 
 * Polling loop that continuously processes queued jobs.
 */

const DEFAULT_POLL_INTERVAL_MS = parseInt(process.env.PREPRESS_WORKER_POLL_INTERVAL_MS || '10000');
const DEFAULT_CONCURRENCY = parseInt(process.env.PREPRESS_WORKER_CONCURRENCY || '1');

const poller = createPrepressPoller(processOneJob);

/**
 * Start polling for jobs
 * 
 * @param options - Polling configuration
 */
export function startPolling(options: {
  pollIntervalMs?: number;
  concurrency?: number;
} = {}): void {
  poller.start({
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
  });
}

/**
 * Stop polling
 */
export function stopPolling(options: { drainTimeoutMs?: number } = {}): Promise<PrepressPollerDrainResult> {
  return poller.stop({ drainTimeoutMs: options.drainTimeoutMs ?? 30_000 });
}

/**
 * Check if poller is running
 */
export function isPolling(): boolean {
  return poller.isPolling();
}
