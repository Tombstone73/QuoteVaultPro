/**
 * Dev-only utility: Backfill attachments that were incorrectly persisted as storageProvider='local'
 * even though the underlying object key exists in Supabase.
 *
 * Why:
 * - Thumbnail worker chooses resolver based on storageProvider.
 * - If a Supabase-backed key is mislabeled as local, thumbnail generation will look on disk and fail.
 *
 * Safety:
 * - Only flips rows where Supabase reports the object key exists.
 * - Does NOT modify truly-local files.
 *
 * Usage:
 *   ALLOW_DEV_BACKFILL_ATTACHMENTS=true npx tsx backfill-mislabeled-local-attachments.ts
 *
 * Optional env:
 *   DRY_RUN=true      (default true)
 *   LIMIT=500
 *   ONLY_ORG_ID=org_titan_001
 */

import 'dotenv/config';
import { and, eq, isNull, not, or, sql } from 'drizzle-orm';
import { db } from './server/db';
import { orderAttachments, orders, quoteAttachments } from './shared/schema';
import { SupabaseStorageService, isSupabaseConfigured } from './server/supabaseStorage';

const DEFAULT_SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'titan-private';

function isTruthyEnv(value: string | undefined): boolean {
  const v = (value ?? '').toString().toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

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

async function main() {
  const allow = isTruthyEnv(process.env.ALLOW_DEV_BACKFILL_ATTACHMENTS);
  const dryRun = process.env.DRY_RUN == null ? true : isTruthyEnv(process.env.DRY_RUN);
  const limit = process.env.LIMIT != null ? Number(process.env.LIMIT) : 500;
  const onlyOrgId = process.env.ONLY_ORG_ID ? String(process.env.ONLY_ORG_ID) : null;

  if (!allow) {
    throw new Error(
      'Refusing to run: set ALLOW_DEV_BACKFILL_ATTACHMENTS=true to acknowledge this is a one-time dev utility.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run in production (NODE_ENV=production).');
  }

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured; cannot safely backfill by existence check.');
  }

  const supabase = new SupabaseStorageService();

  console.log('[BackfillMislabeledLocalAttachments] Starting');
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- limit: ${limit}`);
  console.log(`- onlyOrgId: ${onlyOrgId ?? '(all orgs)'}`);
  console.log(`- bucket (legacy prefix stripping): ${DEFAULT_SUPABASE_BUCKET}`);

  let updatedQuotes = 0;
  let updatedOrders = 0;
  let skippedMissingInSupabase = 0;
  let skippedHttp = 0;

  // Quote attachments
  const quoteCandidates = await db
    .select({
      id: quoteAttachments.id,
      organizationId: quoteAttachments.organizationId,
      fileUrl: quoteAttachments.fileUrl,
      relativePath: quoteAttachments.relativePath,
      storageProvider: quoteAttachments.storageProvider,
      mimeType: quoteAttachments.mimeType,
    })
    .from(quoteAttachments)
    .where(
      and(
        // target rows that are currently treated as local
        or(isNull(quoteAttachments.storageProvider), eq(quoteAttachments.storageProvider, 'local')),
        not(sql`${quoteAttachments.fileUrl} like 'http%'`),
        onlyOrgId ? eq(quoteAttachments.organizationId, onlyOrgId) : sql`true`
      )
    )
    .limit(limit);

  for (const row of quoteCandidates) {
    const raw = row.fileUrl;
    if (!raw) continue;
    if (isHttpUrl(raw)) {
      skippedHttp++;
      continue;
    }

    const key = normalizeObjectKeyForDb(raw);
    const exists = await supabase.fileExists(key).catch(() => false);
    if (!exists) {
      skippedMissingInSupabase++;
      continue;
    }

    if (!dryRun) {
      await db
        .update(quoteAttachments)
        .set({
          storageProvider: 'supabase',
          fileUrl: key,
          relativePath: key,
          thumbStatus: 'uploaded',
          thumbKey: null,
          previewKey: null,
          thumbError: null,
          thumbnailRelativePath: null,
          thumbnailGeneratedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(quoteAttachments.id, row.id));
    }

    updatedQuotes++;
  }

  // Order attachments (join orders to get org scope)
  const orderCandidates = await db
    .select({
      id: orderAttachments.id,
      orderId: orderAttachments.orderId,
      organizationId: orders.organizationId,
      fileUrl: orderAttachments.fileUrl,
      relativePath: orderAttachments.relativePath,
      storageProvider: orderAttachments.storageProvider,
      mimeType: orderAttachments.mimeType,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
    .where(
      and(
        or(isNull(orderAttachments.storageProvider), eq(orderAttachments.storageProvider, 'local')),
        not(sql`${orderAttachments.fileUrl} like 'http%'`),
        onlyOrgId ? eq(orders.organizationId, onlyOrgId) : sql`true`
      )
    )
    .limit(limit);

  for (const row of orderCandidates) {
    const raw = row.fileUrl;
    if (!raw) continue;
    if (isHttpUrl(raw)) {
      skippedHttp++;
      continue;
    }

    const key = normalizeObjectKeyForDb(raw);
    const exists = await supabase.fileExists(key).catch(() => false);
    if (!exists) {
      skippedMissingInSupabase++;
      continue;
    }

    if (!dryRun) {
      await db
        .update(orderAttachments)
        .set({
          storageProvider: 'supabase',
          fileUrl: key,
          relativePath: key,
          thumbStatus: 'uploaded',
          thumbKey: null,
          previewKey: null,
          thumbError: null,
          thumbnailRelativePath: null,
          thumbnailGeneratedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(orderAttachments.id, row.id));
    }

    updatedOrders++;
  }

  console.log('[BackfillMislabeledLocalAttachments] Done');
  console.log(`- quote candidates: ${quoteCandidates.length}`);
  console.log(`- order candidates: ${orderCandidates.length}`);
  console.log(`- updatedQuotes: ${updatedQuotes}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`- updatedOrders: ${updatedOrders}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`- skippedMissingInSupabase: ${skippedMissingInSupabase}`);
  console.log(`- skippedHttp: ${skippedHttp}`);
  console.log('Next: the thumbnail worker should pick up these rows on its next poll (default ~10s).');
}

main().catch((err) => {
  console.error('[BackfillMislabeledLocalAttachments] Failed', err);
  process.exit(1);
});
