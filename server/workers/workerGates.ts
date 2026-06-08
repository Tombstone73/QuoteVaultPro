/**
 * Worker Gating System
 * 
 * Centralized control for background workers to prevent Neon compute burn
 * in dev/preview environments while maintaining production behavior.
 * 
 * Key behaviors:
 * - Production: Workers default to ENABLED (unless explicitly disabled)
 * - Non-production: Workers default to DISABLED (unless explicitly enabled)
 * - Global kill switch: WORKERS_ENABLED=false disables ALL workers in any environment
 * - Per-worker control: WORKER_<NAME>_ENABLED overrides defaults
 * - Worker aliases: specific legacy/product env vars are also supported
 * - Interval overrides: WORKER_<NAME>_INTERVAL_MS
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const WORKER_ENABLED_ALIASES: Record<string, string[]> = {
  THUMBNAILS: ['THUMBNAIL_WORKER_ENABLED', 'ATTACHMENT_THUMBNAIL_WORKER_ENABLED'],
  ASSET_PREVIEW: ['ASSET_PREVIEW_WORKER_ENABLED'],
  QB_SYNC: ['QUICKBOOKS_WORKER_ENABLED', 'QUICKBOOKS_SYNC_WORKER_ENABLED'],
  QB_QUEUE: ['QUICKBOOKS_WORKER_ENABLED', 'QUICKBOOKS_SYNC_WORKER_ENABLED'],
  UPLOAD_CLEANUP: ['UPLOAD_CLEANUP_WORKER_ENABLED'],
};

function firstParsedBoolean(keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      return value.toLowerCase() === 'true';
    }
  }
  return undefined;
}

/**
 * Check if a specific worker should be enabled
 * 
 * @param name - Worker name in uppercase (e.g., 'THUMBNAILS', 'QB_SYNC')
 * @param defaultEnabledInProd - Whether this worker should default to enabled in production
 * @returns true if worker should start
 */
export function isWorkerEnabled(name: string, defaultEnabledInProd = true): boolean {
  // Global kill switch - overrides everything
  const globalEnabled = process.env.WORKERS_ENABLED;
  if (globalEnabled !== undefined && globalEnabled !== '') {
    const enabled = globalEnabled.toLowerCase() === 'true';
    if (!enabled) {
      return false; // Global disable trumps all
    }
  }

  const normalizedName = name.toUpperCase();
  const workerEnabled = firstParsedBoolean([
    `WORKER_${normalizedName}_ENABLED`,
    ...(WORKER_ENABLED_ALIASES[normalizedName] ?? []),
  ]);

  if (workerEnabled !== undefined) {
    return workerEnabled;
  }

  // Default behavior based on environment
  if (IS_PRODUCTION) {
    return defaultEnabledInProd;
  } else {
    // In dev/preview: workers are OFF by default to prevent Neon compute burn
    return false;
  }
}

/**
 * Get effective polling interval for a worker with environment-aware defaults
 * 
 * @param name - Worker name in uppercase (e.g., 'THUMBNAILS')
 * @param productionDefaultMs - Default interval for production
 * @param nonProductionDefaultMs - Default interval for non-production (typically slower)
 * @param legacyEnvVar - Optional legacy env var name for backwards compatibility
 * @returns effective interval in milliseconds
 */
export function getWorkerIntervalOverride(
  name: string,
  productionDefaultMs: number,
  nonProductionDefaultMs: number,
  legacyEnvVar?: string | string[]
): number {
  // Check per-worker interval override (new standard)
  const workerIntervalKey = `WORKER_${name.toUpperCase()}_INTERVAL_MS`;
  const workerInterval = process.env[workerIntervalKey];
  
  if (workerInterval !== undefined && workerInterval !== '') {
    const parsed = Number(workerInterval);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Check legacy env var if provided (backwards compatibility)
  const legacyEnvVars = Array.isArray(legacyEnvVar) ? legacyEnvVar : legacyEnvVar ? [legacyEnvVar] : [];
  for (const envVar of legacyEnvVars) {
    const legacyValue = process.env[envVar];
    if (legacyValue !== undefined && legacyValue !== '') {
      const parsed = Number(legacyValue);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  // Return environment-appropriate default
  return IS_PRODUCTION ? productionDefaultMs : nonProductionDefaultMs;
}

/**
 * Log worker status at startup
 * 
 * @param name - Worker display name
 * @param enabled - Whether worker is enabled
 * @param intervalMs - Effective polling interval (if enabled)
 * @param reason - Optional reason for state
 */
export function logWorkerStatus(
  name: string,
  enabled: boolean,
  intervalMs?: number,
  reason?: string
): void {
  const status = enabled ? 'ENABLED' : 'DISABLED';
  const intervalInfo = enabled && intervalMs ? ` (interval: ${Math.round(intervalMs / 1000)}s)` : '';
  const reasonInfo = reason ? ` - ${reason}` : '';
  
  console.log(`[WorkerGate] ${name}: ${status}${intervalInfo}${reasonInfo}`);
}

/**
 * Log a worker tick (for proving workers are gated correctly in dev)
 * Only logs in development to avoid production log spam
 */
let tickCounters: Record<string, number> = {};

export function logWorkerTick(
  name: string,
  durationMs: number,
  rowsProcessed?: number
): void {
  if (IS_PRODUCTION) return; // Don't log ticks in production
  
  if (!tickCounters[name]) {
    tickCounters[name] = 0;
  }
  tickCounters[name]++;
  
  const rowInfo = rowsProcessed !== undefined ? ` rows=${rowsProcessed}` : '';
  console.log(`[WorkerTick] ${name} poll ran (n=${tickCounters[name]}) durationMs=${durationMs}${rowInfo}`);
}
