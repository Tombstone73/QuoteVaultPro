/**
 * Thumbnail Generation Service
 * 
 * Generates thumbnails and previews for image attachments using sharp.
 * Gracefully handles missing sharp dependency and storage failures.
 * 
 * States:
 * - uploaded: fileKey set, thumbKey/previewKey null
 * - derivatives_ready: thumbKey and/or previewKey set
 * - derivatives_skipped: no derivatives (unsupported type OR sharp unavailable OR error)
 */

import { db } from "../db";
import { orderAttachments, quoteAttachments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { readFile } from "../utils/fileStorage";
import path from "path";
import * as fsPromises from "fs/promises";
import { createRequire } from "module";

// Load sharp once at module init (ESM-safe). Never throw: thumbnails stay fail-soft.
// Use 'any' type to avoid TypeScript errors when sharp is not installed.
const require = createRequire(import.meta.url);
let sharpModule: any = null;
let sharpAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharpImport = require('sharp');
  sharpModule = sharpImport?.default ?? sharpImport;
  sharpAvailable = true;
  console.log('[ThumbnailGenerator] sharp loaded OK');
} catch (error) {
  sharpModule = null;
  sharpAvailable = false;
  console.warn('[ThumbnailGenerator] sharp not installed/failed to load; thumbnails disabled. Error:', error);
}

export async function ensureSharp(): Promise<boolean> {
  return sharpAvailable;
}

// Feature flag: Check if thumbnail generation is enabled
// Default: true (enabled)
// Override: Set THUMBNAILS_ENABLED=false in environment
export function isThumbnailGenerationEnabled(): boolean {
  const envValue = process.env.THUMBNAILS_ENABLED;
  if (envValue === undefined || envValue === '') {
    return true; // Default enabled
  }
  return envValue.toLowerCase() === 'true';
}

// Supported image MIME types
const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'image/tif',
];

/**
 * Check if a MIME type is supported for thumbnail generation
 * Also supports filename-based detection for TIFF files
 */
export function isSupportedImageType(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (mimeType) {
    const mimeTypeLower = mimeType.toLowerCase();
    if (SUPPORTED_IMAGE_TYPES.includes(mimeTypeLower)) {
      return true;
    }
  }
  
  // Fallback: filename-based detection for TIFF
  if (fileName) {
    const fileNameLower = fileName.toLowerCase();
    if (fileNameLower.endsWith('.tif') || fileNameLower.endsWith('.tiff')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generate storage key for thumbnail/preview.
 * Format: thumbs/{orgId}/{attachmentType}/{attachmentId}.{thumb|preview}.jpg
 */
function generateDerivativeKey(args: {
  organizationId: string;
  attachmentType: 'quote' | 'order';
  attachmentId: string;
  variant: 'thumb' | 'preview';
}): string {
  const { organizationId, attachmentType, attachmentId, variant } = args;
  return `thumbs/${organizationId}/${attachmentType}/${attachmentId}.${variant}.jpg`;
}

/**
 * Download original file from storage
 */
async function downloadOriginalFile(fileKey: string, storageProvider: string): Promise<Buffer | null> {
  try {
    if (isSupabaseConfigured() && storageProvider === 'supabase') {
      // Supabase storage (preferred for supabase provider)
      const supabaseService = new SupabaseStorageService();
      const signedUrl = await supabaseService.getSignedDownloadUrl(fileKey, 3600);
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`Failed to download from Supabase: status=${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Local file storage
    const localBuffer = await readFile(fileKey);
    if (localBuffer) return localBuffer;

    // Fail-soft: some legacy rows may have storageProvider='local' but a Supabase-style key.
    // If so, attempt Supabase download before giving up.
    const looksLikeSupabaseKey =
      fileKey.startsWith('uploads/') ||
      fileKey.startsWith('titan-private/uploads/') ||
      fileKey.includes('/storage/v1/object/');

    if (isSupabaseConfigured() && looksLikeSupabaseKey) {
      try {
        const supabaseService = new SupabaseStorageService();
        const signedUrl = await supabaseService.getSignedDownloadUrl(fileKey, 3600);
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to download from Supabase: status=${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        console.warn(`[ThumbnailGenerator] Local read returned null; Supabase fallback succeeded for ${fileKey}`);
        return Buffer.from(arrayBuffer);
      } catch (error) {
        console.warn(`[ThumbnailGenerator] Local read returned null; Supabase fallback failed for ${fileKey}:`, error);
      }
    }

    console.error(`[ThumbnailGenerator] Local read returned null for ${fileKey} (storageProvider=${storageProvider})`);
    return null;
  } catch (error) {
    // Fail-soft fallback: Some legacy order attachments may have local file keys but incorrect storageProvider.
    // If Supabase download failed, try local read before giving up.
    if (storageProvider === 'supabase') {
      try {
        const buffer = await readFile(fileKey);
        if (buffer) {
          console.warn(`[ThumbnailGenerator] Supabase download failed; local fallback succeeded for ${fileKey}`);
          return buffer;
        }
      } catch {
        // ignore and report original error below
      }
    }

    console.error(`[ThumbnailGenerator] Failed to download original file ${fileKey} (storageProvider=${storageProvider}):`, error);
    return null;
  }
}

/**
 * Upload derivative file to storage
 */
async function uploadDerivativeFile(
  derivativeKey: string,
  buffer: Buffer,
  storageProvider: string,
  organizationId: string
): Promise<boolean> {
  try {
    if (isSupabaseConfigured() && storageProvider !== 'local') {
      // Supabase storage
      const supabaseService = new SupabaseStorageService();
      await supabaseService.uploadFile(derivativeKey, buffer, 'image/jpeg');
      return true;
    } else {
      // Local file storage - save to same directory structure
      const storageRoot = process.env.STORAGE_ROOT || './storage';
      const fullPath = path.join(storageRoot, derivativeKey);
      
      // Ensure directory exists
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file
      await fsPromises.writeFile(fullPath, buffer);
      return true;
    }
  } catch (error) {
    console.error(`[ThumbnailGenerator] Failed to upload derivative ${derivativeKey}:`, error);
    return false;
  }
}

/**
 * Generate thumbnails and previews for an image attachment
 * This is a fire-and-forget function that should not block the upload request
 * Idempotent: skips if thumbKey and previewKey already exist
 */
export async function generateImageDerivatives(
  attachmentId: string,
  attachmentType: 'quote' | 'order',
  fileKey: string,
  mimeType: string | null,
  storageProvider: string,
  organizationId: string,
  fileName?: string | null
): Promise<void> {
  // Early exit if sharp is unavailable
  if (!sharpAvailable) return;

  try {
    // Load attachment row to check idempotency and get fileName if needed
    const baseTable = attachmentType === 'quote' ? quoteAttachments : orderAttachments;

    const [attachment] = await db
      .select({
        id: baseTable.id,
        fileUrl: baseTable.fileUrl,
        fileName: baseTable.fileName,
        originalFilename: baseTable.originalFilename,
        thumbKey: baseTable.thumbKey,
        previewKey: baseTable.previewKey,
      })
      .from(baseTable)
      .where(eq(baseTable.id, attachmentId))
      .limit(1);

    if (!attachment) {
      console.log(`[ThumbnailGenerator] Attachment ${attachmentId} not found, skipping`);
      return;
    }

    // Use fileName from attachment if not provided (for filename-based detection)
    const effectiveFileName = fileName || attachment.originalFilename || attachment.fileName || null;

    // Check supported type using effective fileName (supports both mimeType and filename-based detection)
    if (!isSupportedImageType(mimeType, effectiveFileName)) {
      console.log(`[ThumbnailGenerator] Skipping ${attachmentId}: unsupported type ${mimeType}${effectiveFileName ? ` (filename: ${effectiveFileName})` : ''}`);
      return;
    }

    // Idempotency check: if both thumbKey and previewKey exist, skip
    if (attachment.thumbKey && attachment.previewKey) {
      console.log(`[ThumbnailGenerator] Skipping ${attachmentId}: derivatives already exist (thumbKey=${attachment.thumbKey}, previewKey=${attachment.previewKey})`);
      return;
    }

    // Stale task guard: if fileUrl has changed, skip (attachment was replaced)
    if (attachment.fileUrl !== fileKey) {
      console.log(`[ThumbnailGenerator] Skipping ${attachmentId}: fileUrl mismatch (expected ${fileKey}, got ${attachment.fileUrl})`);
      return;
    }
    // Download original file
    const originalBuffer = await downloadOriginalFile(fileKey, storageProvider);
    if (!originalBuffer) {
      console.error(`[ThumbnailGenerator] Failed to download original for ${attachmentId}`);
      return;
    }

    // Generate thumbnail (320px width, maintain aspect ratio)
    const sharp = sharpModule;
    const thumbBuffer = await sharp(originalBuffer)
      .resize(320, undefined, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Generate preview (1600px width, maintain aspect ratio)
    const previewBuffer = await sharp(originalBuffer)
      .resize(1600, undefined, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    // Generate storage keys
    const thumbKey = generateDerivativeKey({
      organizationId,
      attachmentType,
      attachmentId,
      variant: 'thumb',
    });
    const previewKey = generateDerivativeKey({
      organizationId,
      attachmentType,
      attachmentId,
      variant: 'preview',
    });

    // Upload both derivatives (all-or-nothing approach)
    const thumbUploaded = await uploadDerivativeFile(thumbKey, thumbBuffer, storageProvider, organizationId);
    const previewUploaded = await uploadDerivativeFile(previewKey, previewBuffer, storageProvider, organizationId);

    if (!thumbUploaded || !previewUploaded) {
      console.error(`[ThumbnailGenerator] Failed to upload derivatives for ${attachmentId}`);
      // Clean up partial uploads if needed
      if (thumbUploaded) {
        // Could delete thumbKey here, but skip for now to avoid complexity
      }
      if (previewUploaded) {
        // Could delete previewKey here, but skip for now
      }
      return;
    }

    // Update database with derivative keys (all-or-nothing)
    await db
      .update(baseTable)
      .set({
        thumbKey,
        previewKey,
        thumbStatus: 'thumb_ready',
        thumbError: null,
        updatedAt: new Date(),
      })
      .where(eq(baseTable.id, attachmentId));

    console.log(`[ThumbnailGenerator] Successfully generated derivatives for ${attachmentId}`);
  } catch (error: any) {
    console.error(`[ThumbnailGenerator] Error generating derivatives for ${attachmentId}:`, error);
    
    // Update database with error status (fail-soft)
    try {
      const baseTable = attachmentType === 'quote' ? quoteAttachments : orderAttachments;
      await db
        .update(baseTable)
        .set({
          thumbStatus: 'thumb_failed',
          thumbError: error.message?.substring(0, 500) || 'Thumbnail generation failed',
          updatedAt: new Date(),
        })
        .where(eq(baseTable.id, attachmentId));
    } catch (dbError) {
      console.error(`[ThumbnailGenerator] Failed to update error status for ${attachmentId}:`, dbError);
    }
  }
}

