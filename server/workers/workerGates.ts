/**
 * Worker Gating System
 * 
 * Centralized control for background workers to prevent Neon compute burn
 * in dev/preview environments while maintaining production behavior.
 * 
 * Also provides operational kill switches for risky/heavy workflows that can be
 * disabled instantly during incidents without redeploying code.
 * 
 * Key behaviors:
 * - Production: Workers default to ENABLED (unless explicitly disabled)
 * - Non-production: Workers default to DISABLED (unless explicitly enabled)
 * - Global kill switch: WORKERS_ENABLED=false disables ALL workers in any environment
 * - Per-worker control: WORKER_<NAME>_ENABLED overrides defaults
 * - Interval overrides: WORKER_<NAME>_INTERVAL_MS
 * - Feature kill switches: FEATURE_<NAME>_ENABLED for operational safety
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Parse boolean from environment variable
 * Treats "0", "false", "off" (case-insensitive) as false
 * Everything else (including undefined) as true by default
 */
function parseEnvBoolean(value: string | undefined, defaultValue: boolean = true): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  const normalized = value.toLowerCase().trim();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

/**
 * Operational Kill Switches
 * 
 * These are fail-safe controls that can instantly disable risky subsystems
 * during incidents, rate limit exhaustion, or maintenance windows.
 * 
 * Default: ENABLED (true) in all environments to preserve current behavior
 * To disable: Set env var to "0", "false", or "off"
 */

/**
 * Check if QuickBooks sync is enabled
 * 
 * Operational use: Disable during QB API outages, rate limit issues, or data quality incidents
 * Default: ENABLED (to preserve current production behavior)
 * 
 * @returns true if QB sync operations should proceed
 */
export function isQuickBooksSyncEnabled(): boolean {
  return parseEnvBoolean(process.env.FEATURE_QB_SYNC_ENABLED, true);
}

/**
 * Check if email sending is enabled
 * 
 * Operational use: Disable during email provider outages, bounce storms, or template issues
 * Default: ENABLED (to preserve current production behavior)
 * 
 * @returns true if email operations should proceed
 */
export function isEmailEnabled(): boolean {
  return parseEnvBoolean(process.env.FEATURE_EMAIL_ENABLED, true);
}

/**
 * Check if asset/file processing is enabled
 * 
 * Operational use: Disable during storage outages, CPU/memory incidents, or processing errors
 * Default: ENABLED (to preserve current production behavior)
 * 
 * @returns true if asset derivation/processing should proceed
 */
export function isAssetProcessingEnabled(): boolean {
  return parseEnvBoolean(process.env.FEATURE_ASSET_PROCESSING_ENABLED, true);
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

  // Check per-worker override
  const workerEnvKey = `WORKER_${name.toUpperCase()}_ENABLED`;
  const workerEnabled = process.env[workerEnvKey];
  
  if (workerEnabled !== undefined && workerEnabled !== '') {
    return workerEnabled.toLowerCase() === 'true';
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
  legacyEnvVar?: string
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
  if (legacyEnvVar) {
    const legacyValue = process.env[legacyEnvVar];
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
