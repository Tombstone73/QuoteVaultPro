/**
 * Dev utility: Backfill Order attachment storage metadata.
 *
 * Normalizes attachments that accidentally persisted Supabase signed/public URLs as `fileUrl`
 * and/or have an incorrect `storageProvider`.
 *
 * Usage:
 *   npx tsx backfill-order-attachment-storage.ts
 */

import 'dotenv/config';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from './server/db';
import { orderAttachments } from './shared/schema';

const DEFAULT_SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'titan-private';

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function normalizeObjectKeyForDb(input: string): string {
  // Keep DB-stored keys stable: no leading slash.
  let key = input.trim().replace(/^\/+/, '');

  // Some legacy rows accidentally included the bucket prefix.
  const bucketsToStrip = new Set([DEFAULT_SUPABASE_BUCKET, 'titan-private']);
  for (const bucket of bucketsToStrip) {
    if (bucket && key.startsWith(`${bucket}/`)) {
      key = key.slice(bucket.length + 1);
    }
  }

  return key;
}

function tryExtractSupabaseObjectKeyFromUrl(inputUrl: string): string | null {
  try {
    const url = new URL(inputUrl);
    const parts = url.pathname.split('/').filter(Boolean);

    // Expect .../storage/v1/object/...
    const storageIdx = parts.indexOf('storage');
    if (storageIdx < 0) return null;
    if (parts[storageIdx + 1] !== 'v1') return null;
    if (parts[storageIdx + 2] !== 'object') return null;

    const afterObject = parts.slice(storageIdx + 3);
    if (!afterObject.length) return null;

    // Supported Supabase patterns:
    // /storage/v1/object/public/<bucket>/<key>
    // /storage/v1/object/sign/<bucket>/<key>
    // /storage/v1/object/download/<bucket>/<key>
    // /storage/v1/object/<bucket>/<key>
    // /storage/v1/object/upload/sign/<bucket>/<key>
    let keyParts: string[] = [];

    if (afterObject[0] === 'upload' && afterObject[1] === 'sign') {
      // upload/sign/<bucket>/<key>
      keyParts = afterObject.slice(3);
    } else if (['public', 'sign', 'download'].includes(afterObject[0])) {
      // public|sign|download/<bucket>/<key>
      keyParts = afterObject.slice(2);
    } else {
      // <bucket>/<key>
      keyParts = afterObject.slice(1);
    }

    if (!keyParts.length) return null;
    return decodeURIComponent(keyParts.join('/'));
  } catch {
    return null;
  }
}

async function main() {
  console.log('[BackfillOrderAttachmentStorage] Starting');
  console.log(`- supabase bucket (for legacy prefix stripping): ${DEFAULT_SUPABASE_BUCKET}`);

  // Pull a bounded set to avoid loading the world.
  const candidates = await db
    .select({
      id: orderAttachments.id,
      fileUrl: orderAttachments.fileUrl,
      storageProvider: orderAttachments.storageProvider,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey
    })
    .from(orderAttachments)
    .where(
      and(
        // only rows that look suspicious
        or(
          isNull(orderAttachments.storageProvider),
          eq(orderAttachments.storageProvider, 'local'),
          // fileUrl persisted as full URL
          sql`${orderAttachments.fileUrl} like 'http%'`
        ),
        // ignore obviously external URLs that are not Supabase storage
        // (we'll filter precisely below)
        sql`${orderAttachments.fileUrl} is not null`
      )
    )
    .limit(2000);

  let updated = 0;
  let skippedExternal = 0;
  let skippedNoKey = 0;

  for (const row of candidates) {
    const fileUrl = row.fileUrl;
    if (!fileUrl) continue;

    if (!isHttpUrl(fileUrl)) {
      // Not a URL. If it already looks like a stable uploads key, ensure provider/bucket.
      const key = normalizeObjectKeyForDb(fileUrl);
      if (!key.startsWith('uploads/')) continue;

      await db
        .update(orderAttachments)
        .set({
          fileUrl: key,
          storageProvider: 'supabase',
          // Force worker to regenerate if missing.
          thumbKey: null,
          previewKey: null,
          thumbError: null,
          thumbStatus: 'uploaded'
        })
        .where(eq(orderAttachments.id, row.id));

      updated++;
      continue;
    }

    // HTTP URL: extract Supabase key if this is a Supabase storage URL.
    const extractedKey = tryExtractSupabaseObjectKeyFromUrl(fileUrl);
    if (!extractedKey) {
      skippedExternal++;
      continue;
    }

    const normalizedKey = normalizeObjectKeyForDb(extractedKey);
    if (!normalizedKey.startsWith('uploads/')) {
      // Don't touch non-standard keys; safer to skip.
      skippedNoKey++;
      continue;
    }

    await db
      .update(orderAttachments)
      .set({
        fileUrl: normalizedKey,
        storageProvider: 'supabase',
        thumbKey: null,
        previewKey: null,
        thumbError: null,
        thumbStatus: 'uploaded'
      })
      .where(eq(orderAttachments.id, row.id));

    updated++;
  }

  console.log('[BackfillOrderAttachmentStorage] Done');
  console.log(`- candidates: ${candidates.length}`);
  console.log(`- updated: ${updated}`);
  console.log(`- skippedExternal: ${skippedExternal}`);
  console.log(`- skippedNoKey: ${skippedNoKey}`);
}

main().catch((err) => {
  console.error('[BackfillOrderAttachmentStorage] Failed', err);
  process.exit(1);
});
