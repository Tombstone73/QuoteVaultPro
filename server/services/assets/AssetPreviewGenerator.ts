import { assetRepository } from './AssetRepository';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import type { Asset } from '../../../shared/schema';
import { objectStorageClient } from '../../objectStorage';

/**
 * Asset Preview Generator
 * 
 * Generates thumbnail (320px) and preview (1600px) variants for assets.
 * Supports image files (PNG, JPG, GIF, WebP) and PDF files (first page).
 * 
 * Storage key doctrine:
 *   thumbs/org_{orgId}/asset/{assetId}/thumb.jpg
 *   thumbs/org_{orgId}/asset/{assetId}/preview.jpg
 * 
 * Phase 1: Works alongside existing thumbnail system.
 * Phase 2: Will replace server/services/thumbnailGenerator.ts.
 */
export class AssetPreviewGenerator {
  private readonly THUMB_SIZE = 320;
  private readonly PREVIEW_SIZE = 1600;
  private readonly JPEG_QUALITY = 85;

  /**
   * Generate previews for an asset
   * Updates asset.previewKey, asset.thumbKey, asset.previewStatus in database
   */
  async generatePreviews(asset: Asset): Promise<void> {
    console.log(`[AssetPreviewGenerator] Processing asset ${asset.id} (${asset.fileName})`);

    try {
      const mimeType = asset.mimeType?.toLowerCase() || '';

      // Determine if we can generate previews
      const isImage =
        mimeType.startsWith('image/') &&
        !mimeType.includes('svg') &&
        !mimeType.includes('tiff');
      const isPdf = mimeType === 'application/pdf';

      if (!isImage && !isPdf) {
        console.log(
          `[AssetPreviewGenerator] Unsupported type ${mimeType}, marking as failed`
        );
        await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
          previewStatus: 'failed',
          previewError: `Unsupported file type: ${mimeType}`,
        });
        return;
      }

      // Download original file to temp location
      const tempDir = path.join(process.cwd(), '.temp', 'asset-previews', asset.id);
      await fs.mkdir(tempDir, { recursive: true });
      const tempFilePath = path.join(tempDir, asset.fileName);

      console.log(`[AssetPreviewGenerator] Downloading ${asset.fileKey} to ${tempFilePath}`);
      await this.downloadFile(asset.fileKey, tempFilePath);

      let imageBuffer: Buffer;

      if (isPdf) {
        // PDF processing: Render first page to image
        imageBuffer = await this.renderPdfFirstPage(tempFilePath);
      } else {
        // Image processing: Load directly
        imageBuffer = await fs.readFile(tempFilePath);
      }

      // Generate thumbnail (320px)
      const thumbBuffer = await sharp(imageBuffer)
        .resize(this.THUMB_SIZE, this.THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: this.JPEG_QUALITY })
        .toBuffer();

      const thumbKey = `thumbs/org_${asset.organizationId}/asset/${asset.id}/thumb.jpg`;
      await this.uploadBuffer(thumbKey, thumbBuffer, 'image/jpeg');
      console.log(`[AssetPreviewGenerator] Uploaded thumbnail to ${thumbKey}`);

      // Generate preview (1600px)
      const previewBuffer = await sharp(imageBuffer)
        .resize(this.PREVIEW_SIZE, this.PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: this.JPEG_QUALITY })
        .toBuffer();

      const previewKey = `thumbs/org_${asset.organizationId}/asset/${asset.id}/preview.jpg`;
      await this.uploadBuffer(previewKey, previewBuffer, 'image/jpeg');
      console.log(`[AssetPreviewGenerator] Uploaded preview to ${previewKey}`);

      // Update asset record
      await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
        thumbKey,
        previewKey,
        previewStatus: 'ready',
      });

      // Create variant records
      await assetRepository.upsertVariant(
        asset.organizationId,
        asset.id,
        'thumb',
        thumbKey,
        'ready'
      );
      await assetRepository.upsertVariant(
        asset.organizationId,
        asset.id,
        'preview',
        previewKey,
        'ready'
      );

      // Cleanup temp files
      await fs.rm(tempDir, { recursive: true, force: true });

      console.log(`[AssetPreviewGenerator] Successfully processed asset ${asset.id}`);
    } catch (error) {
      console.error(`[AssetPreviewGenerator] Failed to process asset ${asset.id}:`, error);

      await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
        previewStatus: 'failed',
        previewError: error instanceof Error ? error.message : 'Unknown error',
      });

      // Try to cleanup temp files even on error
      try {
        const tempDir = path.join(process.cwd(), '.temp', 'asset-previews', asset.id);
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * Parse storage key into bucket and object name
   */
  private parseStorageKey(key: string): { bucketName: string; objectName: string } {
    let normalizedKey = key;
    if (!normalizedKey.startsWith('/')) {
      normalizedKey = `/${normalizedKey}`;
    }
    const parts = normalizedKey.split('/');
    if (parts.length < 3) {
      throw new Error('Invalid storage key: must contain at least bucket/object');
    }
    return {
      bucketName: parts[1],
      objectName: parts.slice(2).join('/'),
    };
  }

  /**
   * Download file from storage to local path
   */
  private async downloadFile(storageKey: string, localPath: string): Promise<void> {
    const { bucketName, objectName } = this.parseStorageKey(storageKey);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.download({ destination: localPath });
  }

  /**
   * Upload buffer to storage
   */
  private async uploadBuffer(storageKey: string, buffer: Buffer, contentType: string): Promise<void> {
    const { bucketName, objectName } = this.parseStorageKey(storageKey);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(buffer, { contentType });
  }

  /**
   * Render first page of PDF to image buffer
   * Uses pdfjs-dist + @napi-rs/canvas
   */
  private async renderPdfFirstPage(pdfPath: string): Promise<Buffer> {
    // Dynamic import to avoid loading heavy PDF.js if not needed
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');

    const data = new Uint8Array(await fs.readFile(pdfPath));
    const pdf = await getDocument({ data }).promise;
    const page = await pdf.getPage(1);

    // Render at 2x scale for better quality
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context as any,
      viewport,
    }).promise;

    return canvas.toBuffer('image/png');
  }

  /**
   * Process all pending assets for an organization
   */
  async processPendingAssetsForOrg(organizationId: string): Promise<void> {
    const pendingAssets = await assetRepository.listPendingPreviewAssets(organizationId);

    console.log(
      `[AssetPreviewGenerator] Found ${pendingAssets.length} pending assets for org ${organizationId}`
    );

    for (const asset of pendingAssets) {
      await this.generatePreviews(asset);
    }
  }

  /**
   * Process all pending assets across all organizations
   * Used by background worker
   */
  async processAllPendingAssets(): Promise<void> {
    const pendingAssets = await assetRepository.listAllPendingPreviewAssets();

    console.log(`[AssetPreviewGenerator] Found ${pendingAssets.length} pending assets globally`);

    for (const asset of pendingAssets) {
      await this.generatePreviews(asset);
    }
  }
}

// Singleton instance
export const assetPreviewGenerator = new AssetPreviewGenerator();
