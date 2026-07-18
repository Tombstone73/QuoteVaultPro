import { assetRepository } from './AssetRepository';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import type { Asset } from '../../../shared/schema';
import { objectStorageClient, ObjectStorageService } from '../../objectStorage';
import { isSupabaseConfigured, SupabaseStorageService } from '../../supabaseStorage';
import { normalizeObjectKeyForDb, tryExtractSupabaseObjectKeyFromUrl } from '../../lib/supabaseObjectHelpers';
import { resolveLocalStoragePath } from '../localStoragePath';
import { normalizeTenantObjectKey } from '../../utils/orgKeys';
import { persistReadyFileDerivative } from '../storage/persistFileDerivative';
import { canonicalFileReadResolver } from '../storage/CanonicalFileReadResolver';
import { storageProviderConfigRepository } from '../../storage/storageProviderConfig.repo';
import { storagePlacementRepository } from '../../storage/storagePlacement.repo';
import { storageRegistry } from '../storage/StorageRegistry';
import { fileDerivativeRepository } from '../../storage/fileDerivative.repo';

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
  private readonly SOURCE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
  private readonly sourceRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly sourceRetryAttempts = new Map<string, number>();

  private resetSourceRetry(assetId: string): void {
    const existingTimer = this.sourceRetryTimers.get(assetId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.sourceRetryTimers.delete(assetId);
    }
    this.sourceRetryAttempts.delete(assetId);
  }

  private scheduleSourceRetry(asset: Asset, reason: string): void {
    if (this.sourceRetryTimers.has(asset.id)) {
      return;
    }

    const attempt = this.sourceRetryAttempts.get(asset.id) ?? 0;
    if (attempt >= this.SOURCE_RETRY_DELAYS_MS.length) {
      console.log(`[AssetPreviewGenerator] Source not ready for asset ${asset.id}; leaving pending for worker retry (${reason})`);
      return;
    }

    const delayMs = this.SOURCE_RETRY_DELAYS_MS[attempt];
    this.sourceRetryAttempts.set(asset.id, attempt + 1);

    const timer = setTimeout(() => {
      this.sourceRetryTimers.delete(asset.id);
      void this.generatePreviews(asset).catch((retryError) => {
        console.error(`[AssetPreviewGenerator] Scheduled retry failed for asset ${asset.id}:`, retryError);
      });
    }, delayMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    this.sourceRetryTimers.set(asset.id, timer);
    console.log(`[AssetPreviewGenerator] Scheduled source retry ${attempt + 1}/${this.SOURCE_RETRY_DELAYS_MS.length} for asset ${asset.id} in ${delayMs}ms`);
  }

  /**
   * Generate previews for an asset
   * Updates asset.previewStatus in database while canonical derivative metadata remains source of truth
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
        this.resetSourceRetry(asset.id);
        console.log(
          `[AssetPreviewGenerator] Unsupported type ${mimeType}, marking as failed`
        );
        await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
          previewStatus: 'failed',
          previewError: `Unsupported file type: ${mimeType}`,
        });
        return;
      }

      const sourceDescriptor = await this.resolveAssetSource(asset);
      if (process.env.NODE_ENV === 'development') {
        const storageRoot = process.env.STORAGE_ROOT || './storage';
        const debugKey = sourceDescriptor.objectKey ?? sourceDescriptor.localPathRef ?? '';
        const storageCandidate = debugKey ? this.resolveStorageRootPath(storageRoot, debugKey) : null;
        const uploadCandidate = debugKey ? this.safeResolveFileStoragePath(debugKey) : null;
        console.log('[AssetPreviewGenerator][DEV] preview start', {
          assetId: asset.id,
          orgId: asset.organizationId,
          key: debugKey || null,
          storageRoot,
          storageCandidate,
          fileStorageCandidate: uploadCandidate,
          fileRecordId: asset.fileRecordId ?? null,
        });
      }

      console.log(`[AssetPreviewGenerator] Reading source bytes asset=${asset.id} fileRecordId=${asset.fileRecordId ?? 'none'} key=${sourceDescriptor.objectKey ?? sourceDescriptor.localPathRef ?? 'none'}`);

      const sourceBytes = await this.readSourceBytes({
        assetId: asset.id,
        organizationId: asset.organizationId,
        fileRecordId: asset.fileRecordId ?? null,
        objectKey: sourceDescriptor.objectKey,
        localPathRef: sourceDescriptor.localPathRef,
      });

      const imageBuffer = isPdf
        ? await this.renderPdfFirstPageFromBuffer(sourceBytes)
        : sourceBytes;

      // Generate thumbnail (320px)
      const thumbBuffer = await sharp(imageBuffer)
        .resize(this.THUMB_SIZE, this.THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: this.JPEG_QUALITY })
        .toBuffer();

      const thumbKey = normalizeTenantObjectKey(`thumbs/${asset.organizationId}/asset/${asset.id}/thumb.jpg`);
      await this.uploadBuffer(thumbKey, thumbBuffer, 'image/jpeg');
      console.log(`[AssetPreviewGenerator] Uploaded thumbnail to ${thumbKey}`);

      // Generate preview (1600px)
      const previewBuffer = await sharp(imageBuffer)
        .resize(this.PREVIEW_SIZE, this.PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: this.JPEG_QUALITY })
        .toBuffer();

      const previewKey = normalizeTenantObjectKey(`thumbs/${asset.organizationId}/asset/${asset.id}/preview.jpg`);
      await this.uploadBuffer(previewKey, previewBuffer, 'image/jpeg');
      console.log(`[AssetPreviewGenerator] Uploaded preview to ${previewKey}`);

      await Promise.all([
        persistReadyFileDerivative({
          fileRecordId: asset.fileRecordId,
          derivativeType: 'thumbnail',
          objectKey: thumbKey,
          mimeType: 'image/jpeg',
          sizeBytes: thumbBuffer.length,
        }),
        persistReadyFileDerivative({
          fileRecordId: asset.fileRecordId,
          derivativeType: 'preview',
          objectKey: previewKey,
          mimeType: 'image/jpeg',
          sizeBytes: previewBuffer.length,
        }),
      ]);

      // Update asset record
      await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
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

      this.resetSourceRetry(asset.id);
      console.log(`[AssetPreviewGenerator] Successfully processed asset ${asset.id}`);
    } catch (error) {
      // Common in signed-URL uploads: asset row exists before the object becomes readable.
      // Keep it pending so the worker retries on the next poll.
      if (error instanceof AssetSourceNotReadyError) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AssetPreviewGenerator][DEV] source not ready, will retry', {
            assetId: asset.id,
            orgId: asset.organizationId,
            key: this.safeNormalizeForLog(asset.fileKey ?? null),
            reason: error.message,
          });
        }
        await assetRepository.setAssetPreviewKeys(asset.organizationId, asset.id, {
          previewStatus: 'pending',
          previewError: null,
        });
        this.scheduleSourceRetry(asset, error.message);
        return;
      }

      this.resetSourceRetry(asset.id);
      console.error(`[AssetPreviewGenerator] Failed to process asset ${asset.id}:`, error);

      if (process.env.NODE_ENV === 'development') {
        console.error('[AssetPreviewGenerator][DEV] failure context', {
          assetId: asset.id,
          orgId: asset.organizationId,
          rawFileKey: asset.fileKey ?? null,
          normalizedFileKey: this.safeNormalizeForLog(asset.fileKey ?? null),
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
   * Generate canonical derivatives for a file that is not represented by an asset row.
   * Prepress final files use this path so Production can resolve previews from file_records.
   */
  async generateCanonicalFilePreviews(args: {
    organizationId: string;
    fileRecordId: string;
    fileName: string;
    mimeType?: string | null;
  }): Promise<"ready" | "unsupported" | "failed"> {
    const mimeType = String(args.mimeType || "").toLowerCase();
    const isPdf = mimeType === "application/pdf" || args.fileName.toLowerCase().endsWith(".pdf");
    const isImage = mimeType.startsWith("image/") && !mimeType.includes("svg");

    if (!isPdf && !isImage) return "unsupported";

    const source = await canonicalFileReadResolver.resolveOriginal(args.fileRecordId);
    const sourcePlacement = await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(args.fileRecordId);
    const providerConfig = source.providerConfigId
      ? await storageProviderConfigRepository.getById(source.providerConfigId)
      : null;

    if (
      source.status !== "available"
      || (!source.objectKey && !source.localPathRef)
      || !sourcePlacement
      || !providerConfig
    ) {
      const reason = source.status !== "available"
        ? `canonical source is ${source.status}`
        : !sourcePlacement
          ? "canonical storage placement is missing"
          : !providerConfig
            ? "canonical storage provider configuration is missing"
            : "canonical source location is missing";
      console.error("[AssetPreviewGenerator] Cannot generate canonical production-file preview", {
        fileRecordId: args.fileRecordId,
        fileName: args.fileName,
        reason,
      });
      if (sourcePlacement) {
        await Promise.all(["thumbnail", "preview"].map((derivativeType) =>
          fileDerivativeRepository.setState({
            fileRecordId: args.fileRecordId,
            derivativeType: derivativeType as "thumbnail" | "preview",
            state: "failed",
            sourcePlacementId: sourcePlacement.id,
            errorText: reason,
          })
        )).catch(() => undefined);
      }
      return "failed";
    }

    const existing = await Promise.all([
      fileDerivativeRepository.getPreferredByFileRecordIdAndType(args.fileRecordId, "thumbnail"),
      fileDerivativeRepository.getPreferredByFileRecordIdAndType(args.fileRecordId, "preview"),
    ]);
    if (existing.every((derivative) => derivative?.state === "ready" && derivative.objectKey)) {
      return "ready";
    }
    const needsThumbnail = !(existing[0]?.state === "ready" && existing[0].objectKey);
    const needsPreview = !(existing[1]?.state === "ready" && existing[1].objectKey);

    await Promise.all([
      needsThumbnail ? fileDerivativeRepository.setState({
        fileRecordId: args.fileRecordId,
        derivativeType: "thumbnail",
        state: "pending",
        sourcePlacementId: sourcePlacement.id,
      }) : Promise.resolve(),
      needsPreview ? fileDerivativeRepository.setState({
        fileRecordId: args.fileRecordId,
        derivativeType: "preview",
        state: "pending",
        sourcePlacementId: sourcePlacement.id,
      }) : Promise.resolve(),
    ]);

    try {
      const adapter = storageRegistry.getAdapter(providerConfig.providerType);
      const downloadHandle = await adapter.getDownloadHandle({
        providerConfig,
        objectKey: source.objectKey,
        localPathRef: source.localPathRef,
      });
      const sourceBytes = downloadHandle.kind === "signed_url"
        ? await fetch(downloadHandle.value).then(async (response) => {
            if (!response.ok) throw new Error(`Canonical source download failed (${response.status})`);
            return Buffer.from(await response.arrayBuffer());
          })
        : await fs.readFile(downloadHandle.value);
      const imageBuffer = isPdf ? await this.renderPdfFirstPageFromBuffer(sourceBytes) : sourceBytes;
      const baseKey = normalizeTenantObjectKey(`thumbs/${args.organizationId}/file/${args.fileRecordId}`);
      const thumbKey = `${baseKey}/thumb.jpg`;
      const previewKey = `${baseKey}/preview.jpg`;
      const [thumbBuffer, previewBuffer] = await Promise.all([
        sharp(imageBuffer)
          .resize(this.THUMB_SIZE, this.THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: this.JPEG_QUALITY })
          .toBuffer(),
        sharp(imageBuffer)
          .resize(this.PREVIEW_SIZE, this.PREVIEW_SIZE, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: this.JPEG_QUALITY })
          .toBuffer(),
      ]);

      const [storedThumb, storedPreview] = await Promise.all([
        adapter.putObject({
          buffer: thumbBuffer,
          originalFilename: `${args.fileName}.thumb.jpg`,
          mimeType: "image/jpeg",
          requestedTarget: thumbKey,
          providerConfig,
          resource: { organizationId: args.organizationId, resourceType: "order", resourceId: args.fileRecordId },
        }),
        adapter.putObject({
          buffer: previewBuffer,
          originalFilename: `${args.fileName}.preview.jpg`,
          mimeType: "image/jpeg",
          requestedTarget: previewKey,
          providerConfig,
          resource: { organizationId: args.organizationId, resourceType: "order", resourceId: args.fileRecordId },
        }),
      ]);
      const storedThumbKey = storedThumb.objectKey ?? storedThumb.localPathRef;
      const storedPreviewKey = storedPreview.objectKey ?? storedPreview.localPathRef;
      if (!storedThumbKey || !storedPreviewKey) throw new Error("Derivative storage returned no location");

      const [thumbVerification, previewVerification] = await Promise.all([
        adapter.verifyObject({ providerConfig, objectKey: storedThumb.objectKey, localPathRef: storedThumb.localPathRef }),
        adapter.verifyObject({ providerConfig, objectKey: storedPreview.objectKey, localPathRef: storedPreview.localPathRef }),
      ]);
      if (!thumbVerification.exists || !previewVerification.exists) {
        throw new Error("Derivative verification failed after storage write");
      }
      await Promise.all([
        persistReadyFileDerivative({
          fileRecordId: args.fileRecordId,
          derivativeType: "thumbnail",
          objectKey: storedThumbKey,
          mimeType: "image/jpeg",
          sizeBytes: thumbBuffer.length,
        }),
        persistReadyFileDerivative({
          fileRecordId: args.fileRecordId,
          derivativeType: "preview",
          objectKey: storedPreviewKey,
          mimeType: "image/jpeg",
          sizeBytes: previewBuffer.length,
        }),
      ]);
      return "ready";
    } catch (error) {
      console.error("[AssetPreviewGenerator] Failed to generate canonical production-file preview", {
        fileRecordId: args.fileRecordId,
        fileName: args.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      await Promise.all([
        needsThumbnail ? fileDerivativeRepository.setState({
          fileRecordId: args.fileRecordId,
          derivativeType: "thumbnail",
          state: "failed",
          sourcePlacementId: sourcePlacement.id,
          errorText: error instanceof Error ? error.message : String(error),
        }) : Promise.resolve(),
        needsPreview ? fileDerivativeRepository.setState({
          fileRecordId: args.fileRecordId,
          derivativeType: "preview",
          state: "failed",
          sourcePlacementId: sourcePlacement.id,
          errorText: error instanceof Error ? error.message : String(error),
        }) : Promise.resolve(),
      ]).catch(() => undefined);
      return "failed";
    }
  }

  /**
   * Normalize asset file key into canonical object key format (relative to /objects/*)
   */
  private normalizeAssetFileKey(raw: string | null | undefined): string {
    let key = (raw || '').toString().trim();
    if (!key) throw new AssetSourceNotReadyError('Asset source key missing');

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

  private safeNormalizeForLog(raw: string | null | undefined): string | null {
    try {
      return this.normalizeAssetFileKey(raw);
    } catch {
      const fallback = (raw || '').toString();
      return fallback || null;
    }
  }

  private async resolveAssetSource(asset: Asset): Promise<{ objectKey: string | null; localPathRef: string | null }> {
    if (asset.fileRecordId) {
      const resolved = await canonicalFileReadResolver.resolveOriginal(String(asset.fileRecordId));
      if (resolved.status === 'available' && (resolved.objectKey || resolved.localPathRef)) {
        return {
          objectKey: resolved.objectKey ?? null,
          localPathRef: resolved.localPathRef ?? null,
        };
      }
    }

    const normalizedKey = asset.fileKey ? this.normalizeAssetFileKey(asset.fileKey) : null;
    if (!normalizedKey) {
      throw new AssetSourceNotReadyError('Asset source unavailable: missing canonical original and legacy fileKey');
    }

    return {
      objectKey: normalizedKey,
      localPathRef: null,
    };
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
    fileRecordId?: string | null;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<Buffer> {
    const { assetId, organizationId, objectKey, localPathRef } = args;
    const fileKey = objectKey ?? localPathRef ?? null;

    if (!fileKey) {
      throw new AssetSourceNotReadyError('Asset source unavailable: no canonical storage path');
    }

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

    if (pendingAssets.length > 0) {
      console.log(`[AssetPreviewGenerator] Found ${pendingAssets.length} pending assets globally`);
    }

    for (const asset of pendingAssets) {
      await this.generatePreviews(asset);
    }
  }
}

// Singleton instance
export const assetPreviewGenerator = new AssetPreviewGenerator();
