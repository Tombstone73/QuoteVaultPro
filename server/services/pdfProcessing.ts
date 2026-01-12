/**
 * PDF Processing Service
 * 
 * Processes PDF attachments to:
 * 1. Detect page count
 * 2. Generate thumbnail from page 1
 * 
 * States + Transitions:
 * - On upload: pageCountStatus='unknown' -> 'detecting', thumbStatus='uploaded' -> 'thumb_pending'
 * - During processing: thumbStatus='thumb_pending' -> 'thumb_pending' (or 'generating' if we set it immediately)
 * - Success: pageCountStatus='detecting' -> 'known', thumbStatus='thumb_pending' -> 'thumb_ready'
 * - Failure: pageCountStatus='detecting' -> 'failed', thumbStatus='thumb_pending' -> 'thumb_failed'
 * 
 * TEMP → PERMANENT boundaries:
 * - TEMP: File exists, attachment row exists, statuses pending
 * - PERMANENT: Attachment row updated with pageCount, thumbKey, statuses, timestamps
 */

import { db } from "../db";
import { orderAttachments, quoteAttachments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { fileExists, readFile } from "../utils/fileStorage";
import { resolveLocalStoragePath } from "./localStoragePath";
import { normalizeTenantObjectKey } from "../utils/orgKeys";
import path from "path";
import * as fsPromises from "fs/promises";

// Lazy-load dependencies with graceful failure
let pdfjsModule: any = null;
let pdfjsAvailable = false;
let canvasModule: any = null;
let canvasAvailable = false;
let sharpModule: any = null;
let sharpAvailable = false;
let dependencyWarningLogged = false;

/**
 * Load pdfjs-dist by trying known valid paths
 * Returns the first module that successfully loads
 */
async function loadPdfJs() {
  const candidates = [
    "pdfjs-dist/legacy/build/pdf.mjs",
    "pdfjs-dist/legacy/build/pdf.js",
    "pdfjs-dist/build/pdf.mjs",
    "pdfjs-dist/build/pdf.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      console.log(`[PdfProcessing] Loaded pdfjs from ${path}`);
      return mod.default ?? mod;
    } catch {}
  }

  throw new Error("pdfjs-dist not found in any known build paths");
}

async function ensurePdfjs(): Promise<boolean> {
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsModule = (mod as any).default ?? mod;
    pdfjsAvailable = true;
    console.log("[PdfProcessing] pdfjs loaded (esm)");
    return true;
  } catch (error) {
    pdfjsAvailable = false;
    console.warn("[PdfProcessing] pdfjs unavailable; skipping PDF processing");
    return false;
  }
}

async function ensureCanvas(): Promise<boolean> {
  if (canvasModule !== null) {
    return canvasAvailable;
  }

  try {
    // Dynamic import for @napi-rs/canvas (ESM-safe, Windows-compatible)
    const canvasImport = await import('@napi-rs/canvas');
    // @napi-rs/canvas exports createCanvas as a named export
    canvasModule = canvasImport;
    canvasAvailable = true;
    console.log("[PdfProcessing] @napi-rs/canvas loaded (esm, napi-rs backend)");
    return true;
  } catch (error) {
    canvasAvailable = false;
    if (!dependencyWarningLogged) {
      console.warn('[PdfProcessing] @napi-rs/canvas unavailable; PDF thumbnail generation disabled. Error:', error);
      dependencyWarningLogged = true;
    }
    return false;
  }
}

async function ensureSharp(): Promise<boolean> {
  if (sharpModule !== null) {
    return sharpAvailable;
  }

  try {
    // Dynamic import for sharp (ESM-safe)
    const sharpImport = await import('sharp');
    sharpModule = sharpImport.default || sharpImport;
    sharpAvailable = true;
    return true;
  } catch (error) {
    sharpAvailable = false;
    if (!dependencyWarningLogged) {
      console.warn('[PdfProcessing] sharp unavailable; PDF thumbnail generation disabled. Error:', error);
      dependencyWarningLogged = true;
    }
    return false;
  }
}

/**
 * Download PDF file from storage
 */
async function downloadPdfFile(fileKey: string, storageProvider: string): Promise<Buffer | null> {
  try {
    if (storageProvider === 'supabase') {
      // Supabase storage
      console.log(`[PdfProcessing] Downloading from Supabase storage: ${fileKey}`);
      const supabaseService = new SupabaseStorageService();
      const signedUrl = await supabaseService.getSignedDownloadUrl(fileKey, 3600);
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`Failed to download from Supabase: ${response.statusText} (status=${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log(`[PdfProcessing] Downloaded from Supabase: ${fileKey}, size=${buffer.length} bytes`);
      return buffer;
    } else if (storageProvider === 'local') {
      // Local file storage - resolve path and read directly
      const normalizedFileKey = normalizeTenantObjectKey(fileKey.replace(/\\/g, '/'));
      const resolvedPath = resolveLocalStoragePath(normalizedFileKey);
      console.log(`[PdfProcessing] 📂 Source file path: fileKey=${fileKey}, resolvedPath=${resolvedPath}`);
      
      // PACK 2: Retry logic for local files (handle timing issues after upload finalize)
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const buffer = await fsPromises.readFile(resolvedPath);
          console.log(`[PdfProcessing] ✅ Read from local storage: size=${buffer.length} bytes (attempt ${attempt})`);
          return buffer;
        } catch (readError: any) {
          lastError = readError;
          if (readError.code === 'ENOENT') {
            if (attempt < 2) {
              // File not found on first attempt - wait and retry (may still be flushing)
              console.log(`[PdfProcessing] File not found on attempt ${attempt}, retrying after 200ms...`);
              await new Promise(resolve => setTimeout(resolve, 200));
              continue;
            }
            throw new Error(`File not found after ${attempt} attempts: fileKey=${fileKey}, resolvedPath=${resolvedPath}`);
          }
          throw readError;
        }
      }
      throw lastError || new Error('Unexpected retry loop exit');
    } else {
      // Unknown or legacy storage provider
      throw new Error(`Unsupported storage provider: ${storageProvider || 'none'}`);
    }
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`[PdfProcessing] Failed to download PDF file ${fileKey} (storageProvider=${storageProvider}):`, errorMsg);
    return null;
  }
}

/**
 * Upload thumbnail file to storage
 */
async function uploadThumbnailFile(
  thumbKey: string,
  buffer: Buffer,
  storageProvider: string,
  organizationId: string
): Promise<boolean> {
  try {
    if (storageProvider === 'supabase') {
      // Supabase storage
      const supabaseService = new SupabaseStorageService();
      await supabaseService.uploadFile(thumbKey, buffer, 'image/jpeg');
      return true;
    } else if (storageProvider === 'local') {
      // Local file storage - MUST use FILE_STORAGE_ROOT to match /objects route
      const storageRoot = process.env.FILE_STORAGE_ROOT || path.join(process.cwd(), 'uploads');
      const fullPath = path.resolve(storageRoot, thumbKey);
      
      // DEBUG_THUMBNAILS logging
      if (process.env.DEBUG_THUMBNAILS) {
        console.log(`[PdfProcessing] Writing PDF thumbnail to filesystem:`, {
          thumbKey,
          storageRoot,
          fullPath,
          bufferSize: buffer.length,
        });
      }
      
      // Ensure directory exists
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file
      await fsPromises.writeFile(fullPath, buffer);
      
      if (process.env.DEBUG_THUMBNAILS) {
        console.log(`[PdfProcessing] Successfully wrote PDF thumbnail ${thumbKey} to ${fullPath}`);
      }
      
      return true;
    } else {
      console.error(`[PdfProcessing] Unsupported storage provider for thumbnail upload: ${storageProvider}`);
      return false;
    }
  } catch (error) {
    console.error(`[PdfProcessing] Failed to upload thumbnail ${thumbKey}:`, error);
    return false;
  }
}

/**
 * Generate storage key for thumbnail.
 * Format: thumbs/{orgId}/{attachmentType}/{attachmentId}.thumb.jpg
 */
function generateThumbnailKey(args: {
  orgId: string;
  attachmentType: 'quote' | 'order';
  attachmentId: string;
}): string {
  const { orgId, attachmentType, attachmentId } = args;
  return normalizeTenantObjectKey(`thumbs/${orgId}/${attachmentType}/${attachmentId}.thumb.jpg`);
}

async function verifyDerivativeExists(args: {
  storageProvider: string;
  thumbKey: string;
}): Promise<boolean> {
  const { storageProvider, thumbKey } = args;
  if (isSupabaseConfigured() && storageProvider === 'supabase') {
    const svc = new SupabaseStorageService();
    return await svc.fileExists(thumbKey);
  }
  return await fileExists(thumbKey);
}

/**
 * Process PDF attachment: detect page count and generate thumbnail
 * This is a fire-and-forget function that should not block the upload request
 */
export async function processPdfAttachmentDerivedData(args: {
  orgId: string;
  attachmentId: string;
  storageKey: string;
  storageProvider: string;
  mimeType?: string | null;
  attachmentType?: 'quote' | 'order';
}): Promise<void> {
  const { orgId, attachmentId, storageKey, storageProvider, mimeType } = args;
  const attachmentType = args.attachmentType ?? 'quote';

  const lowerMimeType = (mimeType ?? '').toLowerCase();
  const isPdfMime = lowerMimeType.includes('pdf');
  const isAiCandidate = !isPdfMime && /(illustrator|postscript)/i.test(lowerMimeType);

  console.log(`[PdfProcessing] PDF processing started for attachmentId=${attachmentId}, storageKey=${storageKey}, orgId=${orgId}`);

  if (isAiCandidate) {
    console.log(`[PdfProcessing] AI detected; attempting PDF-compatible processing for attachmentId=${attachmentId}`);
  }

  // Early exit if dependencies are unavailable
  const hasPdfjs = await ensurePdfjs();
  const hasCanvas = await ensureCanvas();
  const hasSharp = await ensureSharp();

  if (!hasPdfjs) {
    if (isAiCandidate) {
      console.log(`[PdfProcessing] Skipping ${attachmentId}: pdfjs unavailable (AI processing is best-effort)`);
      return;
    }
    console.log(`[PdfProcessing] Skipping ${attachmentId}: pdfjs unavailable`);
    
    // Mark as failed
    try {
      if (attachmentType === 'quote') {
        await db
          .update(quoteAttachments)
          .set({
            pageCountStatus: 'failed',
            pageCountError: 'PDF processing dependencies unavailable (pdfjs-dist)',
            pageCountUpdatedAt: new Date(),
            thumbStatus: 'thumb_failed',
            thumbError: 'PDF thumbnail generation dependencies unavailable',
            updatedAt: new Date(),
          })
          .where(and(
            eq(quoteAttachments.id, attachmentId),
            eq(quoteAttachments.organizationId, orgId)
          ));
      } else {
        await db
          .update(orderAttachments)
          .set({
            thumbStatus: 'thumb_failed',
            thumbError: 'PDF thumbnail generation dependencies unavailable',
            updatedAt: new Date(),
          })
          .where(eq(orderAttachments.id, attachmentId));
      }
      console.log(`[PdfProcessing] Marked ${attachmentId} as failed due to missing pdfjs`);
    } catch (dbError: any) {
      console.error(`[PdfProcessing] DB update failed while setting status to failed for ${attachmentId}:`, dbError?.message || dbError);
    }
    return;
  }

  if (!hasCanvas) {
    console.log(`[PdfProcessing] canvas unavailable; skipping thumbnail`);
    // Still proceed with page count detection
  }

  if (!hasSharp) {
    console.log(`[PdfProcessing] sharp unavailable; thumbnail resizing will fail`);
    // Canvas might still work, but sharp is needed for final thumbnail
  }

  try {
    // Load attachment row to verify it exists and get current state
    const [attachment] = await (attachmentType === 'quote'
      ? db
          .select()
          .from(quoteAttachments)
          .where(and(
            eq(quoteAttachments.id, attachmentId),
            eq(quoteAttachments.organizationId, orgId)
          ))
          .limit(1)
      : db
          .select()
          .from(orderAttachments)
          .where(eq(orderAttachments.id, attachmentId))
          .limit(1));

    if (!attachment) {
      console.log(`[PdfProcessing] Attachment ${attachmentId} not found, skipping`);
      return;
    }

    // Verify this is still the same file (stale task guard)
    if (attachment.fileUrl !== storageKey) {
      console.log(`[PdfProcessing] Skipping ${attachmentId}: fileUrl mismatch (expected ${storageKey}, got ${attachment.fileUrl})`);
      return;
    }

    // Status should already be set to 'thumb_pending' by upload route for PDFs.
    // For AI attempts, do not change status up-front (fail-soft).
    if (!isAiCandidate) {
      try {
        const anyAttachment: any = attachment as any;

        if (attachmentType === 'quote') {
          if (anyAttachment.pageCountStatus !== 'detecting' || anyAttachment.thumbStatus !== 'thumb_pending') {
            await db
              .update(quoteAttachments)
              .set({
                pageCountStatus: 'detecting',
                thumbStatus: 'thumb_pending',
                updatedAt: new Date(),
              })
              .where(eq(quoteAttachments.id, attachmentId));
            console.log(`[PdfProcessing] Updated ${attachmentId} status to detecting/pending`);
          }
        } else {
          if (anyAttachment.thumbStatus !== 'thumb_pending') {
            await db
              .update(orderAttachments)
              .set({
                thumbStatus: 'thumb_pending',
                updatedAt: new Date(),
              })
              .where(eq(orderAttachments.id, attachmentId));
            console.log(`[PdfProcessing] Updated ${attachmentId} status to pending`);
          }
        }
      } catch (dbError: any) {
        console.error(`[PdfProcessing] DB update failed while setting status to pending for ${attachmentId}:`, dbError?.message || dbError);
      }
    }

    // Download PDF file
    console.log(`[PdfProcessing] Attempting to read PDF file: storageKey=${storageKey}, storageProvider=${storageProvider}`);
    const pdfBuffer = await downloadPdfFile(storageKey, storageProvider);
    if (!pdfBuffer) {
      const errorMsg = `Failed to download PDF file from storageKey=${storageKey}`;
      console.error(`[PdfProcessing] ${errorMsg}`);
      if (isAiCandidate) {
        console.warn('[PdfProcessing] AI not PDF-compatible; skipping thumbnail');
        return;
      }
      throw new Error(errorMsg);
    }
    console.log(`[PdfProcessing] Successfully read PDF file, size=${pdfBuffer.length} bytes`);

    // Load PDF document
    console.log(`[PdfProcessing] Starting pdfjs getDocument for ${attachmentId}`);
    const getDocument = pdfjsModule.getDocument;
    if (!getDocument) {
      throw new Error('pdfjs-dist getDocument not available');
    }
    // pdfjs legacy build rejects Node Buffer; pass a real Uint8Array view
    const pdfData =
      pdfBuffer instanceof Buffer
        ? new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength)
        : (pdfBuffer as Uint8Array);
    let pdfDocument: any;
    try {
      const loadingTask = getDocument({ data: pdfData });
      pdfDocument = await loadingTask.promise;
    } catch (error: any) {
      if (isAiCandidate) {
        console.warn('[PdfProcessing] AI not PDF-compatible; skipping thumbnail');
        return;
      }
      throw error;
    }
    console.log(`[PdfProcessing] pdfjs getDocument success for ${attachmentId}`);

    // Get page count
    const pageCount = pdfDocument.numPages;
    console.log(`[PdfProcessing] PDF has ${pageCount} pages`);

    // Update page count status to 'known' (PERMANENT) - quote attachments only
    if (attachmentType === 'quote') {
      try {
        await db
          .update(quoteAttachments)
          .set({
            pageCount: pageCount,
            pageCountStatus: 'known',
            pageCountError: null,
            pageCountUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(quoteAttachments.id, attachmentId));
        console.log(`[PdfProcessing] Updated pageCountStatus=known`);
      } catch (dbError: any) {
        console.error(`[PdfProcessing] DB update failed while setting pageCount for ${attachmentId}:`, dbError?.message || dbError);
        throw new Error(`Failed to update pageCount in database: ${dbError?.message || dbError}`);
      }
    }

    // Generate thumbnail from page 1 if canvas and sharp are available
    if (hasCanvas && hasSharp) {
      console.log(`[PdfProcessing] Starting thumbnail generation for ${attachmentId}`);
      
      // Get first page
      console.log(`[PdfProcessing] Getting page 1 for ${attachmentId}`);
      const page = await pdfDocument.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality
      console.log(`[PdfProcessing] Page 1 viewport: width=${viewport.width}, height=${viewport.height}`);

      // Create canvas
      console.log(`[PdfProcessing] Creating canvas for ${attachmentId}`);
      const Canvas = canvasModule.createCanvas;
      const canvas = Canvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      // Render PDF page to canvas
      console.log(`[PdfProcessing] Rendering page 1 to canvas for ${attachmentId}`);
      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;
      console.log(`[PdfProcessing] Page 1 render success for ${attachmentId}`);

      // Convert canvas to buffer
      console.log(`[PdfProcessing] Converting canvas to buffer for ${attachmentId}`);
      const pageImageBuffer = canvas.toBuffer('image/png');
      console.log(`[PdfProcessing] Canvas to buffer success, size=${pageImageBuffer.length} bytes`);

      // Use sharp to generate thumbnail (320px width, maintain aspect ratio)
      console.log(`[PdfProcessing] Resizing thumbnail with sharp for ${attachmentId}`);
      const sharp = sharpModule.default || sharpModule;
      const thumbBuffer = await sharp(pageImageBuffer)
        .resize(320, undefined, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      console.log(`[PdfProcessing] Sharp resize success, thumbnail size=${thumbBuffer.length} bytes`);

      // Generate storage key for thumbnail
      const thumbKey = generateThumbnailKey({
        orgId,
        attachmentType,
        attachmentId,
      });
      console.log(`[PdfProcessing] Generated thumbnail key: ${thumbKey} for ${attachmentId}`);

      // Upload thumbnail
      console.log(`[PdfProcessing] Uploading thumbnail to storage for ${attachmentId}`);
      const thumbUploaded = await uploadThumbnailFile(thumbKey, thumbBuffer, storageProvider, orgId);

      if (thumbUploaded) {
        console.log(`[PdfProcessing] Thumbnail stored successfully for ${attachmentId}`);

        // Enforce invariant: do not claim thumb_ready unless the derivative actually exists.
        const thumbExists = await verifyDerivativeExists({ storageProvider, thumbKey });
        if (!thumbExists) {
          console.warn(`[PdfProcessing] Derivative existence check failed for ${attachmentId}; not marking thumb_ready`, {
            storageProvider,
            thumbKey,
          });

          const baseTable = attachmentType === 'quote' ? quoteAttachments : orderAttachments;
          await db
            .update(baseTable)
            .set({
              thumbKey: null,
              thumbStatus: 'thumb_failed',
              thumbError: 'derivative_missing_after_write',
              updatedAt: new Date(),
            })
            .where(eq(baseTable.id, attachmentId));
          return;
        }
        
        // Update database with thumbnail key (PERMANENT - final state)
        try {
          const baseTable = attachmentType === 'quote' ? quoteAttachments : orderAttachments;
          
          await db
            .update(baseTable)
            .set({
              thumbKey: thumbKey,
              thumbStatus: 'thumb_ready',
              thumbError: null,
              thumbnailGeneratedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(baseTable.id, attachmentId));

          // Defensive invariant: Verify all success conditions are met
          const verification = await db
            .select({
              thumbKey: baseTable.thumbKey,
              thumbStatus: baseTable.thumbStatus,
              thumbnailGeneratedAt: baseTable.thumbnailGeneratedAt,
              thumbError: baseTable.thumbError,
            })
            .from(baseTable)
            .where(eq(baseTable.id, attachmentId))
            .limit(1);

          const record = verification[0];
          const debugEnabled = process.env.DEBUG_THUMBNAILS === '1' || process.env.DEBUG_THUMBNAILS === 'true';
          
          if (!record || !record.thumbKey || record.thumbStatus !== 'thumb_ready' || !record.thumbnailGeneratedAt || record.thumbError !== null) {
            const issues: string[] = [];
            if (!record) issues.push('record not found');
            else {
              if (!record.thumbKey) issues.push('thumbKey is null');
              if (record.thumbStatus !== 'thumb_ready') issues.push(`thumbStatus is '${record.thumbStatus}' not 'thumb_ready'`);
              if (!record.thumbnailGeneratedAt) issues.push('thumbnailGeneratedAt is null');
              if (record.thumbError !== null) issues.push('thumbError is not null');
            }
            console.error(`[PdfProcessing] ❌ INVARIANT VIOLATION for ${attachmentId}: ${issues.join(', ')}`);
            throw new Error(`Thumbnail success invariant violated: ${issues.join(', ')}`);
          }

          if (debugEnabled) {
            console.log(`[PdfProcessing] ✅ Thumbnail persisted to DB: attachmentId=${attachmentId}, thumbKey=${thumbKey}, thumbStatus=thumb_ready`);
          }
        } catch (dbError: any) {
          console.error(`[PdfProcessing] DB update failed while setting thumbKey for ${attachmentId}:`, dbError?.message || dbError);
          throw new Error(`Failed to update thumbKey in database: ${dbError?.message || dbError}`);
        }
      } else {
        throw new Error('Failed to upload thumbnail to storage');
      }
    } else {
      // Canvas or sharp unavailable, mark thumbnail as failed but page count succeeded
      const reason = !hasCanvas ? 'canvas unavailable' : 'sharp unavailable';
      console.log(`[PdfProcessing] Thumbnail failed: ${reason}`);
      try {
        if (attachmentType === 'quote') {
          await db
            .update(quoteAttachments)
            .set({
              thumbStatus: 'thumb_failed',
              thumbError: `${reason} for thumbnail generation`,
              updatedAt: new Date(),
            })
            .where(eq(quoteAttachments.id, attachmentId));
        } else {
          await db
            .update(orderAttachments)
            .set({
              thumbStatus: 'thumb_failed',
              thumbError: `${reason} for thumbnail generation`,
              updatedAt: new Date(),
            })
            .where(eq(orderAttachments.id, attachmentId));
        }
      } catch (dbError: any) {
        console.error(`[PdfProcessing] DB update failed while setting thumbStatus to failed for ${attachmentId}:`, dbError?.message || dbError);
      }
    }
  } catch (error: any) {
    const errorMessage = error.message?.substring(0, 500) || 'PDF processing failed';
    console.error(`[PdfProcessing] PDF processing failed for ${attachmentId}: ${errorMessage}`, error);
    
    // Update database with error status (PERMANENT - finalize failure state)
    try {
      // Determine which operations failed by checking current state
      const [currentAttachment] = await (attachmentType === 'quote'
        ? db
            .select()
            .from(quoteAttachments)
            .where(and(
              eq(quoteAttachments.id, attachmentId),
              eq(quoteAttachments.organizationId, orgId)
            ))
            .limit(1)
        : db
            .select()
            .from(orderAttachments)
            .where(eq(orderAttachments.id, attachmentId))
            .limit(1));

      if (currentAttachment) {
        const updateData: any = {
          updatedAt: new Date(),
        };

        // If page count is still 'detecting' or 'unknown', mark it as failed (quote only)
        if (attachmentType === 'quote') {
          const anyAttachment: any = currentAttachment as any;
          if (anyAttachment.pageCountStatus === 'detecting' || anyAttachment.pageCountStatus === 'unknown') {
            updateData.pageCountStatus = 'failed';
            updateData.pageCountError = errorMessage;
            updateData.pageCountUpdatedAt = new Date();
          }
        }

        // If thumbnail is still 'thumb_pending' or 'uploaded', mark it as failed
        const anyAttachment: any = currentAttachment as any;
        if (anyAttachment.thumbStatus === 'thumb_pending' || anyAttachment.thumbStatus === 'uploaded') {
          updateData.thumbStatus = 'thumb_failed';
          updateData.thumbError = errorMessage;
        }

        if (Object.keys(updateData).length > 1) { // More than just updatedAt
          if (attachmentType === 'quote') {
            await db
              .update(quoteAttachments)
              .set(updateData)
              .where(eq(quoteAttachments.id, attachmentId));
          } else {
            await db
              .update(orderAttachments)
              .set(updateData)
              .where(eq(orderAttachments.id, attachmentId));
          }
          console.log(`[PdfProcessing] Marked ${attachmentId} as failed in database: ${errorMessage}`);
        }
      } else {
        console.error(`[PdfProcessing] Cannot update error status for ${attachmentId}: attachment not found`);
      }
    } catch (dbError: any) {
      console.error(`[PdfProcessing] DB update failed while setting error status for ${attachmentId}:`, dbError?.message || dbError);
      // Don't throw - we've already logged the error
    }
  }
}

