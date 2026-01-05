import { assetRepository } from './AssetRepository';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import type { Asset } from '../../../shared/schema';
import { objectStorageClient, ObjectStorageService } from '../../objectStorage';
import { isSupabaseConfigured, SupabaseStorageService } from '../../supabaseStorage';
import { normalizeObjectKeyForDb, tryExtractSupabaseObjectKeyFromUrl } from '../../lib/supabaseObjectHelpers';
import { resolveLocalStoragePath } from '../localStoragePath';

class AssetSourceNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetSourceNotReadyError';
    Object.setPrototypeOf(this, AssetSourceNotReadyError.prototype);
  }
}

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

      const normalizedKey = this.normalizeAssetFileKey(asset.fileKey);
      if (process.env.NODE_ENV === 'development') {
        const storageRoot = process.env.STORAGE_ROOT || './storage';
        const storageCandidate = this.resolveStorageRootPath(storageRoot, normalizedKey);
        const uploadCandidate = this.safeResolveFileStoragePath(normalizedKey);
        console.log('[AssetPreviewGenerator][DEV] preview start', {
          assetId: asset.id,
          orgId: asset.organizationId,
          key: normalizedKey,
          storageRoot,
          storageCandidate,
          fileStorageCandidate: uploadCandidate,
        });
      }

      console.log(`[AssetPreviewGenerator] Reading source bytes key=${normalizedKey}`);

      const sourceBytes = await this.readSourceBytes({
        assetId: asset.id,
        organizationId: asset.organizationId,
        fileKey: normalizedKey,
      });

      const imageBuffer = isPdf
        ? await this.renderPdfFirstPageFromBuffer(sourceBytes)
        : sourceBytes;

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

      console.log(`[AssetPreviewGenerator] Successfully processed asset ${asset.id}`);
    } catch (error) {
      // Common in signed-URL uploads: asset row exists before the object becomes readable.
      // Keep it pending so the worker retries on the next poll.
      if (error instanceof AssetSourceNotReadyError) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AssetPreviewGenerator][DEV] source not ready, will retry', {
            assetId: asset.id,
            orgId: asset.organizationId,
            key: this.safeNormalizeForLog(asset.fileKey),
            reason: error.message,
          });
        }
        await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
          previewStatus: 'pending',
          previewError: null,
        });
        return;
      }

      console.error(`[AssetPreviewGenerator] Failed to process asset ${asset.id}:`, error);

      if (process.env.NODE_ENV === 'development') {
        console.error('[AssetPreviewGenerator][DEV] failure context', {
          assetId: asset.id,
          orgId: asset.organizationId,
          rawFileKey: asset.fileKey,
          normalizedFileKey: this.safeNormalizeForLog(asset.fileKey),
          error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        });
      }

      await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
        previewStatus: 'failed',
        previewError: error instanceof Error ? error.message : 'Unknown error',
      });

    }
  }

  /**
   * Normalize asset file key into canonical object key format (relative to /objects/*)
   */
  private normalizeAssetFileKey(raw: string): string {
    let key = (raw || '').toString().trim();

    // If a URL got persisted accidentally, strip it down to a key.
    if (key.startsWith('http://') || key.startsWith('https://')) {
      if (isSupabaseConfigured()) {
        const extracted = tryExtractSupabaseObjectKeyFromUrl(key, 'titan-private');
        if (extracted) return normalizeObjectKeyForDb(extracted);
      }

      try {
        const url = new URL(key);
        key = url.pathname || key;
      } catch {
        // ignore
      }
    }

    key = key.replace(/^\/+/, '');
    if (key.startsWith('objects/')) key = key.slice('objects/'.length);

    // Remove accidental bucket prefix
    key = normalizeObjectKeyForDb(key);

    return key;
  }

  private safeNormalizeForLog(raw: string): string {
    try {
      return this.normalizeAssetFileKey(raw);
    } catch {
      return (raw || '').toString();
    }
  }

  private parseObjectPath(fullPath: string): { bucketName: string; objectName: string } {
    let p = fullPath;
    if (!p.startsWith('/')) p = `/${p}`;
    const parts = p.split('/');
    if (parts.length < 3) throw new Error('Invalid path: must contain at least bucket/object');
    return { bucketName: parts[1], objectName: parts.slice(2).join('/') };
  }

  private async readSourceBytes(args: {
    assetId: string;
    organizationId: string;
    fileKey: string;
  }): Promise<Buffer> {
    const { assetId, organizationId, fileKey } = args;

    let sawNotFound = false;

    // 1) Local filesystem (STORAGE_ROOT), used by /objects proxy local fallback
    // This MUST NOT use HTTP (no localhost fetch) for local storage.
    try {
      const storageRoot = process.env.STORAGE_ROOT || './storage';
      const abs = this.resolveStorageRootPath(storageRoot, fileKey);
      await fs.access(abs);
      if (process.env.NODE_ENV === 'development') {
        console.log('[AssetPreviewGenerator][DEV] local STORAGE_ROOT hit', { assetId, organizationId, abs });
      }
      return await fs.readFile(abs);
    } catch {
      // ignore
      sawNotFound = true;
    }

    // 2) Local filesystem (FILE_STORAGE_ROOT), used by fileStorage.ts
    try {
      const abs = this.safeResolveFileStoragePath(fileKey);
      await fs.access(abs);
      if (process.env.NODE_ENV === 'development') {
        console.log('[AssetPreviewGenerator][DEV] local fileStorage hit', { assetId, organizationId, abs });
      }
      return await fs.readFile(abs);
    } catch {
      // ignore
      sawNotFound = true;
    }

    // 3) Supabase (when configured). Only attempt after local disk checks to avoid
    // unnecessary localhost/network requests for local storage keys like "uploads/<uuid>".
    if (isSupabaseConfigured()) {
      const looksLikeSupabaseKey =
        fileKey.startsWith('uploads/') ||
        fileKey.startsWith('titan-private/uploads/') ||
        fileKey.includes('/storage/v1/object/');

      if (looksLikeSupabaseKey) {
        try {
          const supabase = new SupabaseStorageService('titan-private');
          const normalized = normalizeObjectKeyForDb(fileKey);
          const signedUrl = await supabase.getSignedDownloadUrl(normalized, 3600);
          const resp = await fetch(signedUrl);
          if (!resp.ok) {
            // Treat 404-ish as transient (object may not be uploaded yet)
            if (resp.status === 404) {
              sawNotFound = true;
              throw new AssetSourceNotReadyError(`Supabase object not found yet key=${normalized}`);
            }
            throw new Error(`[AssetPreviewGenerator] Supabase download failed status=${resp.status} ${resp.statusText} key=${normalized}`);
          }
          return Buffer.from(await resp.arrayBuffer());
        } catch (e: any) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[AssetPreviewGenerator][DEV] Supabase source miss, falling back', {
              assetId,
              organizationId,
              fileKey,
              error: e?.message || String(e),
            });
          }

          // If we explicitly detected "not ready", bubble it up to retry.
          if (e instanceof AssetSourceNotReadyError) throw e;
        }
      }
    }

    // 4) Replit Object Storage (GCS) using PRIVATE_OBJECT_DIR
    // IMPORTANT: This storage client requires the Replit sidecar. Do not attempt it in local dev.
    const replitId = process.env.REPL_ID;
    const isLocalDev = !replitId || replitId === 'local-dev-repl-id';
    if (isLocalDev) {
      if (sawNotFound) {
        throw new AssetSourceNotReadyError('Source not found in local storage roots');
      }
      throw new Error('Source not readable from local storage roots');
    }

    try {
      const objectStorageService = new ObjectStorageService();
      let privateDir = objectStorageService.getPrivateObjectDir();
      if (!privateDir.endsWith('/')) privateDir = `${privateDir}/`;
      const fullPath = `${privateDir}${fileKey}`;
      const { bucketName, objectName } = this.parseObjectPath(fullPath);

      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (!exists) {
        throw new AssetSourceNotReadyError(`Object not found in ObjectStorage yet bucket=${bucketName} object=${objectName}`);
      }
      const [buf] = await file.download();
      return buf;
    } catch (e: any) {
      if (e instanceof AssetSourceNotReadyError) throw e;
      throw new Error(
        `[AssetPreviewGenerator] Unable to read source bytes assetId=${assetId} key=${fileKey} (local+supabase+objectStorage attempts failed): ${
          e?.message || String(e)
        }`
      );
    }
  }

  /**
   * Download file from storage to local path
   */
  private async uploadBuffer(storageKey: string, buffer: Buffer, contentType: string): Promise<void> {
    const key = storageKey.replace(/^\/+/, '');

    // Supabase preferred when configured
    if (isSupabaseConfigured()) {
      const supabase = new SupabaseStorageService('titan-private');
      await supabase.uploadFile(key, buffer, contentType);
      return;
    }

    // Replit Object Storage if available
    try {
      const replitId = process.env.REPL_ID;
      const isLocalDev = !replitId || replitId === 'local-dev-repl-id';
      if (isLocalDev) {
        throw new Error('skip replit object storage in local dev');
      }
      const objectStorageService = new ObjectStorageService();
      let privateDir = objectStorageService.getPrivateObjectDir();
      if (!privateDir.endsWith('/')) privateDir = `${privateDir}/`;
      const fullPath = `${privateDir}${key}`;
      const { bucketName, objectName } = this.parseObjectPath(fullPath);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      await file.save(buffer, { contentType });
      return;
    } catch {
      // fall through to local
    }

    // Local filesystem (STORAGE_ROOT)
    const storageRoot = process.env.STORAGE_ROOT || './storage';
    const abs = this.resolveStorageRootPath(storageRoot, key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
  }

  private safeResolveFileStoragePath(storageKey: string): string {
    // resolveLocalStoragePath already guards against traversal outside FILE_STORAGE_ROOT
    return resolveLocalStoragePath(storageKey);
  }

  private resolveStorageRootPath(storageRoot: string, storageKey: string): string {
    const root = path.resolve(storageRoot);
    const abs = path.resolve(path.join(root, storageKey));
    const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (!abs.startsWith(normalizedRoot)) {
      throw new Error('Invalid storage key (path traversal)');
    }
    return abs;
  }

  /**
   * Render first page of PDF to image buffer
   * Uses pdfjs-dist + @napi-rs/canvas
   */
  private async renderPdfFirstPageFromBuffer(pdfBytes: Buffer): Promise<Buffer> {
    // Dynamic import to avoid loading heavy PDF.js if not needed
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');

    const data = new Uint8Array(pdfBytes);
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
