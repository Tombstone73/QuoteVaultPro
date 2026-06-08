import { assetPreviewGenerator } from '../services/assets/AssetPreviewGenerator';
import { getWorkerIntervalOverride, isWorkerEnabled, logWorkerTick } from './workerGates';

export const ASSET_PREVIEW_FALLBACK_INTERVAL_PROD_MS = 6 * 60 * 60 * 1000;
export const ASSET_PREVIEW_FALLBACK_INTERVAL_NON_PROD_MS = 6 * 60 * 60 * 1000;

/**
 * Asset Preview Worker
 * 
 * Background job that polls for assets with previewStatus='pending'
 * and generates thumbnail + preview images for them.
 * 
 * Production default fallback sweep: 6 hours.
 * Non-production default fallback sweep: 6 hours (gate keeps it off unless explicitly enabled).
 * 
 * Phase 1: Runs alongside existing thumbnailWorker.
 * Phase 2: Will replace thumbnailWorker entirely.
 */
export class AssetPreviewWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  private getFallbackInterval(): number {
    return getAssetPreviewFallbackIntervalMs();
  }

  start(): void {
    if (this.interval) {
      console.log('[AssetPreviewWorker] Already running');
      return;
    }

    const intervalMs = this.getFallbackInterval();
    const intervalSeconds = Math.round(intervalMs / 1000);
    console.log(`[AssetPreviewWorker] Starting worker (event triggers enabled, fallback sweep every ${intervalSeconds}s)`);

    this.interval = setInterval(() => {
      this.processQueue();
    }, intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[AssetPreviewWorker] Stopped');
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isRunning) {
      console.log('[AssetPreviewWorker] Previous run still in progress, skipping');
      return;
    }

    const startTime = Date.now();
    this.isRunning = true;

    try {
      await assetPreviewGenerator.processAllPendingAssets();
    } catch (error) {
      console.error('[AssetPreviewWorker] Error processing queue:', error);
      if (process.env.NODE_ENV === 'development') {
        console.error('[AssetPreviewWorker][DEV] Queue failure details:',
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error)
        );
      }
    } finally {
      this.isRunning = false;
      const duration = Date.now() - startTime;
      logWorkerTick('asset_preview', duration);
    }
  }
}

export function getAssetPreviewFallbackIntervalMs(): number {
  return getWorkerIntervalOverride(
    'ASSET_PREVIEW',
    ASSET_PREVIEW_FALLBACK_INTERVAL_PROD_MS,
    ASSET_PREVIEW_FALLBACK_INTERVAL_NON_PROD_MS,
    'ASSET_PREVIEW_WORKER_FALLBACK_INTERVAL_MS'
  );
}

export function isAssetPreviewWorkerEnabled(): boolean {
  return isWorkerEnabled('ASSET_PREVIEW', true);
}

export function triggerAssetPreviewGeneration(asset: any, reason = 'asset-created'): void {
  if (!asset?.id || !isAssetPreviewWorkerEnabled()) return;

  const handle = setImmediate(() => {
    assetPreviewGenerator.generatePreviews(asset).catch((err) => {
      console.error('[AssetPreviewGenerator] async generatePreviews failed', {
        assetId: asset.id,
        reason,
        error: err,
      });
    });
  });
  handle.unref?.();
}

// Singleton instance
export const assetPreviewWorker = new AssetPreviewWorker();
