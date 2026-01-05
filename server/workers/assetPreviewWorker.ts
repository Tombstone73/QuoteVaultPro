import { assetPreviewGenerator } from '../services/assets/AssetPreviewGenerator';

/**
 * Asset Preview Worker
 * 
 * Background job that polls for assets with previewStatus='pending'
 * and generates thumbnail + preview images for them.
 * 
 * Runs every 10 seconds (same interval as legacy thumbnailWorker).
 * 
 * Phase 1: Runs alongside existing thumbnailWorker.
 * Phase 2: Will replace thumbnailWorker entirely.
 */
export class AssetPreviewWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL = 10000; // 10 seconds

  start(): void {
    if (this.interval) {
      console.log('[AssetPreviewWorker] Already running');
      return;
    }

    console.log('[AssetPreviewWorker] Starting worker (10s interval)');

    this.interval = setInterval(() => {
      this.processQueue();
    }, this.POLL_INTERVAL);

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
    }
  }
}

// Singleton instance
export const assetPreviewWorker = new AssetPreviewWorker();
