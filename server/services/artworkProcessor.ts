/**
 * Artwork Processing Service
 * Handles async thumbnail generation and derived file creation for uploaded artwork
 */
import PQueue from 'p-queue';
import { createClient } from '@supabase/supabase-js';
import { db } from '../db';
import { sql } from 'drizzle-orm';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// In-process queue for async artwork processing
const processingQueue = new PQueue({ concurrency: 2 });

/**
 * Lazy-load sharp module with graceful error handling
 * Throws controlled error if sharp is unavailable
 */
function getSharpOrThrow(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharpModule = require('sharp');
    return sharpModule.default || sharpModule;
  } catch (error) {
    throw new Error('[ArtworkProcessor] sharp unavailable');
  }
}

interface ProcessingJob {
  fileId: string;
  orgId: string;
  quoteId: string;
  lineItemId: string;
  bucket: string;
  originalStorageKey: string;
  contentType: string;
}

/**
 * Enqueue artwork for async processing
 */
export function enqueueArtworkProcessing(job: ProcessingJob): void {
  processingQueue.add(() => processArtwork(job)).catch((error) => {
    console.error(`[ArtworkProcessor] Queue error for file ${job.fileId}:`, error);
  });
}

/**
 * Process artwork: generate thumbnails and previews
 */
async function processArtwork(job: ProcessingJob): Promise<void> {
  const { fileId, orgId, quoteId, lineItemId, bucket, originalStorageKey, contentType } = job;

  console.log(`[ArtworkProcessor] Processing file ${fileId}, type: ${contentType}`);

  try {
    // Update status to processing
    await db.execute(sql`
      UPDATE quote_attachments 
      SET processing_status = 'processing', updated_at = NOW()
      WHERE id = ${fileId}
    `);

    // Get Supabase client
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase not configured');
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Download original file
    const { data: originalData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(originalStorageKey);

    if (downloadError || !originalData) {
      throw new Error(`Failed to download original: ${downloadError?.message}`);
    }

    // Process based on content type
    if (contentType.startsWith('image/')) {
      await processImageFile(supabase, bucket, originalData, fileId, orgId, quoteId, lineItemId);
    } else if (contentType === 'application/pdf') {
      // TODO: PDF thumbnail generation (requires pdf-to-image library)
      console.log(`[ArtworkProcessor] PDF thumbnail generation not yet implemented for ${fileId}`);
    }

    // Mark as ready
    await db.execute(sql`
      UPDATE quote_attachments 
      SET processing_status = 'ready', updated_at = NOW()
      WHERE id = ${fileId}
    `);

    console.log(`[ArtworkProcessor] Successfully processed file ${fileId}`);
  } catch (error: any) {
    console.error(`[ArtworkProcessor] Error processing file ${fileId}:`, error);

    // Mark as error
    await db.execute(sql`
      UPDATE quote_attachments 
      SET processing_status = 'error', 
          processing_error = ${error.message}, 
          updated_at = NOW()
      WHERE id = ${fileId}
    `);
  }
}

/**
 * Process image files: generate thumbnails
 */
async function processImageFile(
  supabase: any,
  bucket: string,
  originalData: Blob,
  fileId: string,
  orgId: string,
  quoteId: string,
  lineItemId: string
): Promise<void> {
  const buffer = Buffer.from(await originalData.arrayBuffer());

  // Get sharp instance (throws if unavailable)
  const sharp = getSharpOrThrow();

  // Generate 256px thumbnail
  const thumbBuffer = await sharp(buffer)
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  const thumbKey = `org/${orgId}/quotes/${quoteId}/line-items/${lineItemId}/files/${fileId}/thumb_256.png`;

  const { error: thumbUploadError } = await supabase.storage
    .from(bucket)
    .upload(thumbKey, thumbBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (thumbUploadError) {
    throw new Error(`Failed to upload thumbnail: ${thumbUploadError.message}`);
  }

  // Generate 1024px preview
  const previewBuffer = await sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  const previewKey = `org/${orgId}/quotes/${quoteId}/line-items/${lineItemId}/files/${fileId}/preview_1024.png`;

  const { error: previewUploadError } = await supabase.storage
    .from(bucket)
    .upload(previewKey, previewBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (previewUploadError) {
    throw new Error(`Failed to upload preview: ${previewUploadError.message}`);
  }

  // Update DB with storage keys
  await db.execute(sql`
    UPDATE quote_attachments 
    SET thumb_storage_key = ${thumbKey},
        preview_storage_key = ${previewKey},
        updated_at = NOW()
    WHERE id = ${fileId}
  `);
}

/**
 * Get queue status (for monitoring)
 */
export function getQueueStatus(): { size: number; pending: number } {
  return {
    size: processingQueue.size,
    pending: processingQueue.pending,
  };
}

