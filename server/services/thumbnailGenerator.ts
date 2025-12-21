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
import { quoteAttachments, orderAttachments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { readFile } from "../utils/fileStorage";
import path from "path";
import * as fsPromises from "fs/promises";

// Lazy-load sharp with graceful failure
// Use 'any' type to avoid TypeScript errors when sharp is not installed
let sharpModule: any = null;
let sharpAvailable = false;
let sharpWarningLogged = false;

export async function ensureSharp(): Promise<boolean> {
  if (sharpModule !== null) {
    return sharpAvailable;
  }

  try {
    // Dynamic import using string to avoid TypeScript compile-time errors when sharp is not installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharpImport = await Promise.resolve().then(() => require('sharp'));
    sharpModule = sharpImport.default || sharpImport;
    sharpAvailable = true;
    return true;
  } catch (error) {
    sharpAvailable = false;
    if (!sharpWarningLogged) {
      console.warn('[ThumbnailGenerator] sharp unavailable; image thumbnails disabled. Error:', error);
      sharpWarningLogged = true;
    }
    return false;
  }
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
 * Generate storage key for thumbnail/preview from original fileKey
 * Format: {fileKey}.thumb.jpg or {fileKey}.preview.jpg
 */
function generateDerivativeKey(fileKey: string, type: 'thumb' | 'preview'): string {
  // If fileKey has extension, insert suffix before extension
  const extMatch = fileKey.match(/^(.+)(\.[^.]+)$/);
  if (extMatch) {
    return `${extMatch[1]}.${type}.jpg`;
  }
  // Otherwise append suffix
  return `${fileKey}.${type}.jpg`;
}

/**
 * Download original file from storage
 */
async function downloadOriginalFile(fileKey: string, storageProvider: string): Promise<Buffer | null> {
  try {
    if (isSupabaseConfigured() && storageProvider !== 'local') {
      // Supabase storage
      const supabaseService = new SupabaseStorageService();
      const signedUrl = await supabaseService.getSignedDownloadUrl(fileKey, 3600);
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`Failed to download from Supabase: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else {
      // Local file storage
      const buffer = await readFile(fileKey);
      return buffer;
    }
  } catch (error) {
    console.error(`[ThumbnailGenerator] Failed to download original file ${fileKey}:`, error);
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
  const hasSharp = await ensureSharp();
  if (!hasSharp) {
    console.log(`[ThumbnailGenerator] Skipping ${attachmentId}: sharp unavailable`);
    return;
  }

  try {
    // Load attachment row to check idempotency and get fileName if needed
    const table = attachmentType === 'quote' ? quoteAttachments : orderAttachments;
    const [attachment] = await db
      .select()
      .from(table)
      .where(eq(table.id, attachmentId))
      .limit(1);

    if (!attachment) {
      console.log(`[ThumbnailGenerator] Attachment ${attachmentId} not found, skipping`);
      return;
    }

    // Use fileName from attachment if not provided (for filename-based detection)
    const effectiveFileName = fileName || (attachment as any).originalFilename || (attachment as any).fileName || null;

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
    const sharp = sharpModule.default || sharpModule;
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
    const thumbKey = generateDerivativeKey(fileKey, 'thumb');
    const previewKey = generateDerivativeKey(fileKey, 'preview');

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
    if (attachmentType === 'quote') {
      await db
        .update(quoteAttachments)
        .set({
          thumbKey,
          previewKey,
          thumbStatus: 'thumb_ready',
          thumbError: null,
          updatedAt: new Date(),
        })
        .where(eq(quoteAttachments.id, attachmentId));
    } else {
      // Order attachments: update thumbKey/previewKey
      await db
        .update(orderAttachments)
        .set({
          thumbKey,
          previewKey,
          updatedAt: new Date(),
        })
        .where(eq(orderAttachments.id, attachmentId));
    }

    console.log(`[ThumbnailGenerator] Successfully generated derivatives for ${attachmentId}`);
  } catch (error: any) {
    console.error(`[ThumbnailGenerator] Error generating derivatives for ${attachmentId}:`, error);
    
    // Update database with error status (only for quote attachments, order attachments don't have thumbStatus)
    try {
      if (attachmentType === 'quote') {
        await db
          .update(quoteAttachments)
          .set({
            thumbStatus: 'thumb_failed',
            thumbError: error.message?.substring(0, 500) || 'Thumbnail generation failed',
            updatedAt: new Date(),
          })
          .where(eq(quoteAttachments.id, attachmentId));
      }
      // Order attachments don't have thumbStatus field, so we just log the error
    } catch (dbError) {
      console.error(`[ThumbnailGenerator] Failed to update error status for ${attachmentId}:`, dbError);
    }
  }
}

