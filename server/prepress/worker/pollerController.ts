export type ProcessOneJob = (canClaim?: () => boolean) => Promise<boolean>;

export interface PrepressPollerOptions {
  pollIntervalMs?: number;
  concurrency?: number;
}

export interface PrepressPollerStopOptions {
  drainTimeoutMs: number;
}

export interface PrepressPollerDrainResult {
  drained: boolean;
  activeJobs: number;
}

export interface PrepressPoller {
  start(options?: PrepressPollerOptions): void;
  stop(options: PrepressPollerStopOptions): Promise<PrepressPollerDrainResult>;
  isPolling(): boolean;
  activeJobCount(): number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Owns polling admission and bounded draining. It deliberately has no database
 * dependency so shutdown semantics can be verified without connecting anywhere.
 */
export function createPrepressPoller(processOneJob: ProcessOneJob): PrepressPoller {
  let running = false;
  let pollTimeout: NodeJS.Timeout | null = null;
  let drainPromise: Promise<PrepressPollerDrainResult> | null = null;
  const activeJobs = new Set<Promise<boolean>>();

  const runOne = (): Promise<boolean> => {
    const task = Promise.resolve().then(async () => {
      // A stopped worker must not make a new claim, even if this task was
      // scheduled just before shutdown began.
      if (!running) return false;
      return processOneJob(() => running);
    });
    activeJobs.add(task);
    void task.then(
      () => activeJobs.delete(task),
      () => activeJobs.delete(task),
    );
    return task;
  };

  const waitForDrain = async (drainTimeoutMs: number): Promise<PrepressPollerDrainResult> => {
    const pending = [...activeJobs];
    if (pending.length === 0) return { drained: true, activeJobs: 0 };

    let timeout: NodeJS.Timeout | null = null;
    const timedOut = await Promise.race([
      Promise.allSettled(pending).then(() => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(true), drainTimeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);

    return { drained: !timedOut, activeJobs: activeJobs.size };
  };

  const poll = async (pollIntervalMs: number, concurrency: number): Promise<void> => {
    if (!running) return;

    const tasks: Promise<boolean>[] = [];
    for (let index = 0; index < concurrency && running; index += 1) {
      tasks.push(runOne());
    }

    try {
      const results = await Promise.all(tasks);
      const processedCount = results.filter(Boolean).length;
      if (processedCount > 0) console.log(`[Prepress Poller] Processed ${processedCount} job(s)`);
    } catch (error) {
      console.error("[Prepress Poller] Error during poll:", error);
    }

    if (running) {
      pollTimeout = setTimeout(() => void poll(pollIntervalMs, concurrency), pollIntervalMs);
    }
  };

  return {
    start(options = {}): void {
      if (running) {
        console.log("[Prepress Poller] Already running");
        return;
      }
      const pollIntervalMs = positiveInteger(options.pollIntervalMs, 10_000);
      const concurrency = positiveInteger(options.concurrency, 1);
      running = true;
      drainPromise = null;
      console.log(`[Prepress Poller] Starting with interval=${pollIntervalMs}ms, concurrency=${concurrency}`);
      void poll(pollIntervalMs, concurrency);
    },

    stop({ drainTimeoutMs }): Promise<PrepressPollerDrainResult> {
      if (drainPromise) return drainPromise;

      running = false;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
      }
      console.log("[Prepress Poller] Stopping new claims and draining active jobs...");
      drainPromise = waitForDrain(positiveInteger(drainTimeoutMs, 30_000));
      return drainPromise;
    },

    isPolling(): boolean {
      return running;
    },

    activeJobCount(): number {
      return activeJobs.size;
    },
  };
}
