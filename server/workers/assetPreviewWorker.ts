import { assetPreviewGenerator } from '../services/assets/AssetPreviewGenerator';
import { getWorkerIntervalOverride, logWorkerTick, isAssetProcessingEnabled } from './workerGates';
import { logger } from '../logger';

/**
 * Asset Preview Worker
 * 
 * Background job that polls for assets with previewStatus='pending'
 * and generates thumbnail + preview images for them.
 * 
 * Production default: 10 minutes (600s)
 * Non-production default: 5 minutes (300s) - to prevent Neon compute burn
 * 
 * Phase 1: Runs alongside existing thumbnailWorker.
 * Phase 2: Will replace thumbnailWorker entirely.
 */
export class AssetPreviewWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  // Production: 10min, Non-prod: 5min
  private readonly DEFAULT_PROD_INTERVAL = 600_000;
  private readonly DEFAULT_NON_PROD_INTERVAL = 300_000;

  private getPollInterval(): number {
    return getWorkerIntervalOverride(
      'ASSET_PREVIEW',
      this.DEFAULT_PROD_INTERVAL,
      this.DEFAULT_NON_PROD_INTERVAL
    );
  }

  start(): void {
    if (this.interval) {
      console.log('[AssetPreviewWorker] Already running');
      return;
    }

    const intervalMs = this.getPollInterval();
    const intervalSeconds = Math.round(intervalMs / 1000);
    console.log(`[AssetPreviewWorker] Starting worker (${intervalSeconds}s interval)`);

    this.interval = setInterval(() => {
      this.processQueue();
    }, intervalMs);

    // Run immediately on start
    this.processQueue();
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

    // Operational kill switch: disable asset processing during storage outages, CPU/memory incidents
    if (!isAssetProcessingEnabled()) {
      logger.debug('Asset processing disabled - skipping queue processing', { feature: 'FEATURE_ASSET_PROCESSING_ENABLED' });
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

// Singleton instance
export const assetPreviewWorker = new AssetPreviewWorker();
