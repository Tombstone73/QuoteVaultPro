/**
 * Dev utility: Fix legacy tenant object keys that were written with a double org prefix.
 *
 * Observed bug:
 * - Keys were generated as `org-${organizationId}/...` even though organizationId already contains `org_`.
 * - This produced keys like `org-org_titan_001/orders/...`.
 *
 * This script performs a SAFE rewrite:
 * - Only rewrites when the normalized key exists in storage AND the legacy key does NOT.
 * - Does NOT move/copy blobs; it only updates DB pointers.
 *
 * Usage:
 *   npx tsx fix-object-keys-org-prefix.ts
 */

import 'dotenv/config';
import { eq, or, sql } from 'drizzle-orm';
import { db } from './server/db';
import { orderAttachments, quoteAttachments } from './shared/schema';
import { normalizeTenantObjectKey } from './server/utils/orgKeys';
import { SupabaseStorageService, isSupabaseConfigured } from './server/supabaseStorage';
import { resolveLocalStoragePath } from './server/services/localStoragePath';
import { promises as fsPromises } from 'fs';

function looksLikeLegacyOrgPrefix(key: unknown): key is string {
  return typeof key === 'string' && (key.startsWith('org-org_') || key.startsWith('org-org'));
}

async function localExists(key: string): Promise<boolean> {
  try {
    const abs = resolveLocalStoragePath(key);
    await fsPromises.access(abs, fsPromises.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function maybeRewriteKey(args: {
  storageProvider: string | null;
  bucket?: string | null;
  key: string;
}): Promise<{ original: string; rewritten: string } | null> {
  const { storageProvider, bucket, key } = args;
  if (!looksLikeLegacyOrgPrefix(key)) return null;

  const rewritten = normalizeTenantObjectKey(key);
  if (!rewritten || rewritten === key) return null;

  // Only rewrite when we can prove the rewritten key is the real one.
  if (storageProvider === 'supabase') {
    if (!isSupabaseConfigured()) return null;
    const supabase = new SupabaseStorageService(bucket ?? undefined);

    const [existsLegacy, existsNew] = await Promise.all([
      supabase.fileExists(key).catch(() => false),
      supabase.fileExists(rewritten).catch(() => false),
    ]);

    if (existsNew && !existsLegacy) {
      return { original: key, rewritten };
    }

    return null;
  }

  if (storageProvider === 'local') {
    const [existsLegacy, existsNew] = await Promise.all([localExists(key), localExists(rewritten)]);
    if (existsNew && !existsLegacy) {
      return { original: key, rewritten };
    }
    return null;
  }

  // Unknown provider; don't touch.
  return null;
}

async function main() {
  console.log('[FixOrgObjectKeys] Starting');

  // Pull a bounded set; rerun if needed.
  const quoteRows = await db
    .select({
      id: quoteAttachments.id,
      storageProvider: quoteAttachments.storageProvider,
      bucket: quoteAttachments.bucket,
      fileUrl: quoteAttachments.fileUrl,
      relativePath: quoteAttachments.relativePath,
      thumbKey: quoteAttachments.thumbKey,
      previewKey: quoteAttachments.previewKey,
    })
    .from(quoteAttachments)
    .where(
      or(
        sql`${quoteAttachments.fileUrl} like 'org-org_%'`,
        sql`${quoteAttachments.relativePath} like 'org-org_%'`,
        sql`${quoteAttachments.thumbKey} like 'org-org_%'`,
        sql`${quoteAttachments.previewKey} like 'org-org_%'`
      )
    )
    .limit(2000);

  const orderRows = await db
    .select({
      id: orderAttachments.id,
      storageProvider: orderAttachments.storageProvider,
      fileUrl: orderAttachments.fileUrl,
      relativePath: orderAttachments.relativePath,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey,
    })
    .from(orderAttachments)
    .where(
      or(
        sql`${orderAttachments.fileUrl} like 'org-org_%'`,
        sql`${orderAttachments.relativePath} like 'org-org_%'`,
        sql`${orderAttachments.thumbKey} like 'org-org_%'`,
        sql`${orderAttachments.previewKey} like 'org-org_%'`
      )
    )
    .limit(2000);

  let updatedQuotes = 0;
  let updatedOrders = 0;
  let skipped = 0;

  for (const row of quoteRows) {
    const updates: Record<string, any> = {};

    const rewriteFileUrl = row.fileUrl
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: row.bucket ?? null, key: row.fileUrl })
      : null;
    if (rewriteFileUrl) updates.fileUrl = rewriteFileUrl.rewritten;

    const rewriteRelative = row.relativePath
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: row.bucket ?? null, key: row.relativePath })
      : null;
    if (rewriteRelative) updates.relativePath = rewriteRelative.rewritten;

    const rewriteThumb = row.thumbKey
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: row.bucket ?? null, key: row.thumbKey })
      : null;
    if (rewriteThumb) updates.thumbKey = rewriteThumb.rewritten;

    const rewritePreview = row.previewKey
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: row.bucket ?? null, key: row.previewKey })
      : null;
    if (rewritePreview) updates.previewKey = rewritePreview.rewritten;

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    await db.update(quoteAttachments).set(updates).where(eq(quoteAttachments.id, row.id));
    updatedQuotes++;
  }

  for (const row of orderRows) {
    const updates: Record<string, any> = {};

    const rewriteFileUrl = row.fileUrl
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: null, key: row.fileUrl })
      : null;
    if (rewriteFileUrl) updates.fileUrl = rewriteFileUrl.rewritten;

    const rewriteRelative = row.relativePath
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: null, key: row.relativePath })
      : null;
    if (rewriteRelative) updates.relativePath = rewriteRelative.rewritten;

    const rewriteThumb = row.thumbKey
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: null, key: row.thumbKey })
      : null;
    if (rewriteThumb) updates.thumbKey = rewriteThumb.rewritten;

    const rewritePreview = row.previewKey
      ? await maybeRewriteKey({ storageProvider: row.storageProvider ?? null, bucket: null, key: row.previewKey })
      : null;
    if (rewritePreview) updates.previewKey = rewritePreview.rewritten;

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    await db.update(orderAttachments).set(updates).where(eq(orderAttachments.id, row.id));
    updatedOrders++;
  }

  console.log('[FixOrgObjectKeys] Done');
  console.log(`- quote candidates: ${quoteRows.length}`);
  console.log(`- order candidates: ${orderRows.length}`);
  console.log(`- updatedQuotes: ${updatedQuotes}`);
  console.log(`- updatedOrders: ${updatedOrders}`);
  console.log(`- skipped: ${skipped}`);
}

main().catch((err) => {
  console.error('[FixOrgObjectKeys] Failed', err);
  process.exit(1);
});
