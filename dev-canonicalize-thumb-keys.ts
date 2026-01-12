/**
 * Dev-only cleanup: canonicalize legacy thumbnail object keys by COPYING blobs in Supabase
 * from legacy org prefixes to canonical org prefixes, then repointing DB keys.
 *
 * Canonical org segment:
 *   org_<slug> (e.g. org_titan_001)
 * Legacy variants:
 *   org-org_<slug>, org_org_<slug>
 *
 * Scope:
 * - Only acts on keys under `thumbs/`
 * - assets.thumbKey / assets.previewKey
 * - quoteAttachments.thumbKey / quoteAttachments.previewKey
 * - orderAttachments.thumbKey / orderAttachments.previewKey
 *
 * Safety:
 * - Guarded by ALLOW_DEV_THUMB_KEY_CANONICALIZE=true
 * - DRY_RUN defaults true (set DRY_RUN=false to apply)
 * - ONLY_ORG_ID supported
 * - LIMIT supported
 * - Idempotent: safe to rerun
 * - Copy-only: never deletes Supabase objects
 *
 * Usage:
 *   ALLOW_DEV_THUMB_KEY_CANONICALIZE=true npx tsx dev-canonicalize-thumb-keys.ts
 */

import 'dotenv/config';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from './server/db';
import { assets, orderAttachments, orders, quoteAttachments } from './shared/schema';
import { SupabaseStorageService, isSupabaseConfigured } from './server/supabaseStorage';
import { toCanonicalThumbsObjectKey } from './server/utils/orgKeys';

function isTruthyEnv(value: string | undefined): boolean {
  const v = (value ?? '').toString().toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isThumbsKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('thumbs/');
}

function looksLikeLegacyOrgVariant(key: string): boolean {
  return key.includes('/org-org_') || key.includes('/org_org_') || key.startsWith('org-org_') || key.startsWith('org_org_');
}

async function canonicalizeKey(args: {
  supabase: SupabaseStorageService;
  key: string;
  kind: 'thumb' | 'preview';
  counts: {
    copiedThumb: number;
    copiedPreview: number;
    skippedMissingSource: number;
  };
  dryRun: boolean;
}): Promise<string | null> {
  const { supabase, key, kind, counts, dryRun } = args;

  if (!isThumbsKey(key)) return null;
  if (!looksLikeLegacyOrgVariant(key)) return null;

  const canonical = toCanonicalThumbsObjectKey(key);
  if (!canonical || canonical === key) return null;

  const [destExists, srcExists] = await Promise.all([
    supabase.fileExists(canonical).catch(() => false),
    supabase.fileExists(key).catch(() => false),
  ]);

  if (destExists) {
    return canonical;
  }

  if (!srcExists) {
    counts.skippedMissingSource++;
    return null;
  }

  if (dryRun) {
    // Pretend success for reporting; DB update will also be skipped in dry-run.
    if (kind === 'thumb') counts.copiedThumb++;
    else counts.copiedPreview++;
    return canonical;
  }

  const copied = await supabase.copyFile(key, canonical);
  if (!copied) {
    // Copy failed; leave DB untouched.
    counts.skippedMissingSource++;
    return null;
  }

  if (kind === 'thumb') counts.copiedThumb++;
  else counts.copiedPreview++;

  return canonical;
}

async function main() {
  const allow = isTruthyEnv(process.env.ALLOW_DEV_THUMB_KEY_CANONICALIZE);
  const dryRun = process.env.DRY_RUN == null ? true : isTruthyEnv(process.env.DRY_RUN);
  const limit = process.env.LIMIT != null ? Number(process.env.LIMIT) : 500;
  const onlyOrgId = process.env.ONLY_ORG_ID ? String(process.env.ONLY_ORG_ID) : null;

  if (!allow) {
    throw new Error(
      'Refusing to run: set ALLOW_DEV_THUMB_KEY_CANONICALIZE=true to acknowledge this is a one-time dev utility.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run in production (NODE_ENV=production).');
  }

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured; cannot copy thumbs safely.');
  }

  const supabase = new SupabaseStorageService();

  console.log('[DevCanonicalizeThumbKeys] Starting');
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- limit: ${limit}`);
  console.log(`- onlyOrgId: ${onlyOrgId ?? '(all orgs)'}`);

  const counts = {
    candidates: 0,
    copiedThumb: 0,
    copiedPreview: 0,
    updatedRows: 0,
    skippedMissingSource: 0,
  };

  // ─────────────────────────────────────────────────────────────
  // Assets
  // ─────────────────────────────────────────────────────────────
  const assetRows = await db
    .select({
      id: assets.id,
      organizationId: assets.organizationId,
      thumbKey: assets.thumbKey,
      previewKey: assets.previewKey,
    })
    .from(assets)
    .where(
      and(
        onlyOrgId ? eq(assets.organizationId, onlyOrgId) : sql`true`,
        or(
          sql`${assets.thumbKey} like 'thumbs/%org-org_%'`,
          sql`${assets.thumbKey} like 'thumbs/%org_org_%'`,
          sql`${assets.previewKey} like 'thumbs/%org-org_%'`,
          sql`${assets.previewKey} like 'thumbs/%org_org_%'`
        )
      )
    )
    .limit(limit);

  for (const row of assetRows) {
    counts.candidates++;
    const updates: Record<string, any> = {};

    if (row.thumbKey) {
      const canonicalThumb = await canonicalizeKey({
        supabase,
        key: row.thumbKey,
        kind: 'thumb',
        counts,
        dryRun,
      });
      if (canonicalThumb) updates.thumbKey = canonicalThumb;
    }

    if (row.previewKey) {
      const canonicalPreview = await canonicalizeKey({
        supabase,
        key: row.previewKey,
        kind: 'preview',
        counts,
        dryRun,
      });
      if (canonicalPreview) updates.previewKey = canonicalPreview;
    }

    if (Object.keys(updates).length === 0) continue;

    if (!dryRun) {
      await db
        .update(assets)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, row.id));
    }

    counts.updatedRows++;
  }

  // ─────────────────────────────────────────────────────────────
  // Quote attachments
  // ─────────────────────────────────────────────────────────────
  const quoteRows = await db
    .select({
      id: quoteAttachments.id,
      organizationId: quoteAttachments.organizationId,
      thumbKey: quoteAttachments.thumbKey,
      previewKey: quoteAttachments.previewKey,
    })
    .from(quoteAttachments)
    .where(
      and(
        onlyOrgId ? eq(quoteAttachments.organizationId, onlyOrgId) : sql`true`,
        or(
          sql`${quoteAttachments.thumbKey} like 'thumbs/%org-org_%'`,
          sql`${quoteAttachments.thumbKey} like 'thumbs/%org_org_%'`,
          sql`${quoteAttachments.previewKey} like 'thumbs/%org-org_%'`,
          sql`${quoteAttachments.previewKey} like 'thumbs/%org_org_%'`
        )
      )
    )
    .limit(limit);

  for (const row of quoteRows) {
    counts.candidates++;
    const updates: Record<string, any> = {};

    if (row.thumbKey) {
      const canonicalThumb = await canonicalizeKey({
        supabase,
        key: row.thumbKey,
        kind: 'thumb',
        counts,
        dryRun,
      });
      if (canonicalThumb) updates.thumbKey = canonicalThumb;
    }

    if (row.previewKey) {
      const canonicalPreview = await canonicalizeKey({
        supabase,
        key: row.previewKey,
        kind: 'preview',
        counts,
        dryRun,
      });
      if (canonicalPreview) updates.previewKey = canonicalPreview;
    }

    if (Object.keys(updates).length === 0) continue;

    if (!dryRun) {
      await db
        .update(quoteAttachments)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(quoteAttachments.id, row.id));
    }

    counts.updatedRows++;
  }

  // ─────────────────────────────────────────────────────────────
  // Order attachments (join orders for org scoping)
  // ─────────────────────────────────────────────────────────────
  const orderRows = await db
    .select({
      id: orderAttachments.id,
      orderId: orderAttachments.orderId,
      organizationId: orders.organizationId,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
    .where(
      and(
        onlyOrgId ? eq(orders.organizationId, onlyOrgId) : sql`true`,
        or(
          sql`${orderAttachments.thumbKey} like 'thumbs/%org-org_%'`,
          sql`${orderAttachments.thumbKey} like 'thumbs/%org_org_%'`,
          sql`${orderAttachments.previewKey} like 'thumbs/%org-org_%'`,
          sql`${orderAttachments.previewKey} like 'thumbs/%org_org_%'`
        )
      )
    )
    .limit(limit);

  for (const row of orderRows) {
    counts.candidates++;
    const updates: Record<string, any> = {};

    if (row.thumbKey) {
      const canonicalThumb = await canonicalizeKey({
        supabase,
        key: row.thumbKey,
        kind: 'thumb',
        counts,
        dryRun,
      });
      if (canonicalThumb) updates.thumbKey = canonicalThumb;
    }

    if (row.previewKey) {
      const canonicalPreview = await canonicalizeKey({
        supabase,
        key: row.previewKey,
        kind: 'preview',
        counts,
        dryRun,
      });
      if (canonicalPreview) updates.previewKey = canonicalPreview;
    }

    if (Object.keys(updates).length === 0) continue;

    if (!dryRun) {
      await db
        .update(orderAttachments)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(orderAttachments.id, row.id));
    }

    counts.updatedRows++;
  }

  console.log('[DevCanonicalizeThumbKeys] Done');
  console.log(`- candidates: ${counts.candidates}`);
  console.log(`- copiedThumb: ${counts.copiedThumb}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`- copiedPreview: ${counts.copiedPreview}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`- updatedRows: ${counts.updatedRows}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`- skippedMissingSource: ${counts.skippedMissingSource}`);
}

main().catch((err) => {
  console.error('[DevCanonicalizeThumbKeys] Failed', err);
  process.exit(1);
});
